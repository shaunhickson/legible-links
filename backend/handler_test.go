package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/shaunhickson/legible-links/backend/resolvers"
)

// stubResolver resolves every URL to a fixed title and counts calls.
type stubResolver struct {
	calls atomic.Int32
}

func (s *stubResolver) Name() string            { return "stub" }
func (s *stubResolver) CanHandle(*url.URL) bool { return true }
func (s *stubResolver) Resolve(_ context.Context, u *url.URL) (*resolvers.Result, error) {
	s.calls.Add(1)
	return &resolvers.Result{Title: "Stub Title for " + u.Path, Platform: "stub"}, nil
}

func newTestHandler() (*Handler, *stubResolver) {
	cache := NewInMemoryCache(100, time.Hour)
	manager := resolvers.NewResolverManager(cache)
	stub := &stubResolver{}
	manager.Register(stub)
	return NewHandler(manager), stub
}

func post(h http.Handler, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/resolve", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	return w
}

func decodeTitles(t *testing.T, w *httptest.ResponseRecorder) map[string]string {
	t.Helper()
	var resp ResolveResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v (body: %s)", err, w.Body.String())
	}
	return resp.Titles
}

func assertSecurityHeaders(t *testing.T, w *httptest.ResponseRecorder) {
	t.Helper()
	if got := w.Header().Get("Cache-Control"); got != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store", got)
	}
	if got := w.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Errorf("X-Content-Type-Options = %q, want nosniff", got)
	}
}

func TestHandler_Limits(t *testing.T) {
	h, _ := newTestHandler()

	// Configure limits for test
	h.MaxItems = 2
	h.MaxBodyBytes = 100 // Small limit for testing

	t.Run("Valid Request with URLs", func(t *testing.T) {
		w := post(h, `{"urls": ["https://example.com/a"]}`)
		if w.Code != http.StatusOK {
			t.Errorf("Expected 200, got %d", w.Code)
		}
		titles := decodeTitles(t, w)
		if titles["https://example.com/a"] != "Stub Title for /a" {
			t.Errorf("unexpected titles: %v", titles)
		}
		assertSecurityHeaders(t, w)
	})

	t.Run("Empty Request", func(t *testing.T) {
		w := post(h, `{}`)
		if w.Code != http.StatusOK {
			t.Errorf("Expected 200, got %d", w.Code)
		}
		if titles := decodeTitles(t, w); len(titles) != 0 {
			t.Errorf("Expected empty titles, got %v", titles)
		}
	})

	t.Run("Legacy videoIds field is ignored", func(t *testing.T) {
		w := post(h, `{"videoIds": ["1", "2", "3"]}`)
		if w.Code != http.StatusOK {
			t.Errorf("Expected 200, got %d", w.Code)
		}
		if titles := decodeTitles(t, w); len(titles) != 0 {
			t.Errorf("Expected empty titles for legacy field, got %v", titles)
		}
	})

	t.Run("Too Many Items", func(t *testing.T) {
		w := post(h, `{"urls": ["https://a.example", "https://b.example", "https://c.example"]}`) // 3 > MaxItems 2
		if w.Code != http.StatusRequestEntityTooLarge {
			t.Errorf("Expected 413, got %d", w.Code)
		}
		assertSecurityHeaders(t, w)
	})

	t.Run("Body Too Large", func(t *testing.T) {
		largePath := strings.Repeat("a", 150)
		w := post(h, `{"urls": ["https://example.com/`+largePath+`"]}`)
		if w.Code != http.StatusRequestEntityTooLarge {
			t.Errorf("Expected 413, got %d", w.Code)
		}
	})

	t.Run("Invalid JSON", func(t *testing.T) {
		w := post(h, `{"urls": [`)
		if w.Code != http.StatusBadRequest {
			t.Errorf("Expected 400, got %d", w.Code)
		}
		assertSecurityHeaders(t, w)
	})

	t.Run("Method Not Allowed", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/resolve", nil)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		if w.Code != http.StatusMethodNotAllowed {
			t.Errorf("Expected 405, got %d", w.Code)
		}
		assertSecurityHeaders(t, w)
	})

	t.Run("OPTIONS preflight", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodOptions, "/resolve", nil)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		if w.Code != http.StatusNoContent {
			t.Errorf("Expected 204, got %d", w.Code)
		}
		if w.Header().Get("Access-Control-Allow-Origin") != "*" {
			t.Error("Expected CORS allow-origin header")
		}
		assertSecurityHeaders(t, w)
	})
}

func TestHandler_ValidatesURLs(t *testing.T) {
	h, stub := newTestHandler()
	h.MaxItems = 20

	invalid := []string{
		"ftp://example.com/file",
		"not-a-valid-url",
		"javascript:alert(1)",
		"http://",
		"https:///path-only",
		"mailto:someone@example.com",
		"file:///etc/passwd",
		"",
		"https://example.com/" + strings.Repeat("x", MaxURLLength), // over the cap
		"http://exa mple.com/",
	}
	body, _ := json.Marshal(map[string][]string{"urls": invalid})

	w := post(h, string(body))
	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if titles := decodeTitles(t, w); len(titles) != 0 {
		t.Errorf("Expected no titles for invalid URLs, got %v", titles)
	}
	if n := stub.calls.Load(); n != 0 {
		t.Errorf("resolver was called %d times for invalid URLs", n)
	}

	// Mixed: only the valid ones reach the resolver.
	mixed := []string{"ftp://x", "https://example.com/ok", "HTTPS://EXAMPLE.COM/upper", "not-a-url"}
	body, _ = json.Marshal(map[string][]string{"urls": mixed})
	w = post(h, string(body))
	titles := decodeTitles(t, w)
	if len(titles) != 2 {
		t.Errorf("Expected 2 titles, got %v", titles)
	}
	if _, ok := titles["https://example.com/ok"]; !ok {
		t.Error("valid URL missing from response")
	}
	if _, ok := titles["HTTPS://EXAMPLE.COM/upper"]; !ok {
		t.Error("uppercase-scheme URL should be accepted and keyed verbatim")
	}
}

func TestHandler_DedupesURLs(t *testing.T) {
	h, stub := newTestHandler()
	h.MaxItems = 20

	w := post(h, `{"urls": ["https://example.com/a", "https://example.com/a", "https://example.com/b", "https://example.com/a"]}`)
	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200, got %d", w.Code)
	}
	titles := decodeTitles(t, w)
	if len(titles) != 2 {
		t.Errorf("Expected 2 titles, got %v", titles)
	}
	if n := stub.calls.Load(); n != 2 {
		t.Errorf("resolver called %d times, want 2 (one per distinct URL)", n)
	}
}

func TestHandler_MaxURLLengthBoundary(t *testing.T) {
	h, _ := newTestHandler()
	h.MaxBodyBytes = 10 * 1024

	prefix := "https://example.com/"
	exact := prefix + strings.Repeat("x", MaxURLLength-len(prefix))
	if len(exact) != MaxURLLength {
		t.Fatalf("test setup: len = %d", len(exact))
	}
	body, _ := json.Marshal(map[string][]string{"urls": {exact, exact + "x"}})
	w := post(h, string(body))
	titles := decodeTitles(t, w)
	if _, ok := titles[exact]; !ok {
		t.Error("URL of exactly MaxURLLength should be accepted")
	}
	if _, ok := titles[exact+"x"]; ok {
		t.Error("URL of MaxURLLength+1 should be dropped")
	}
}

func TestIsValidResolveURL(t *testing.T) {
	tests := []struct {
		in   string
		want bool
	}{
		{"https://example.com", true},
		{"http://example.com/path?q=1#frag", true},
		{"https://[2001:db8::1]/x", true},
		{"https://user:pass@example.com/", true},
		{"", false},
		{"example.com", false},
		{"//example.com", false},
		{"https://", false},
		{"ftp://example.com", false},
		{"javascript:alert(1)", false},
		{"data:text/html,hi", false},
	}
	for _, tc := range tests {
		if got := isValidResolveURL(tc.in); got != tc.want {
			t.Errorf("isValidResolveURL(%q) = %v, want %v", tc.in, got, tc.want)
		}
	}
}
