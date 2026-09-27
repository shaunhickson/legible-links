package resolvers

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/shaunhickson/legible-links/backend/transport"
)

func TestUnshortenerResolver(t *testing.T) {
	transport.SetAllowLocalIPs(true)
	t.Cleanup(func() { transport.SetAllowLocalIPs(false) })

	mux := http.NewServeMux()

	// 1. Simple redirect
	mux.HandleFunc("/short", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/final", http.StatusFound)
	})
	mux.HandleFunc("/final", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		if _, err := w.Write([]byte("<html><head><title>Final Destination</title></head></html>")); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
	})

	// 2. Loop
	mux.HandleFunc("/loop1", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/loop2", http.StatusFound)
	})
	mux.HandleFunc("/loop2", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/loop1", http.StatusFound)
	})

	// 3. Redirect (twice) to a page with OpenGraph metadata: the destination
	// is resolved by the generic resolver and the full result comes back.
	mux.HandleFunc("/to-og", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/to-og-2", http.StatusMovedPermanently)
	})
	mux.HandleFunc("/to-og-2", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/og-page?ref=short", http.StatusFound)
	})
	mux.HandleFunc("/og-page", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(`<html><head>
			<meta property="og:title" content="OpenGraph Destination">
			<meta property="og:description" content="Found through two hops">
			<title>Ignored Title</title>
		</head></html>`))
	})

	// 4. Redirect to a non-web scheme
	mux.HandleFunc("/to-js", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Location", "javascript:alert(1)")
		w.WriteHeader(http.StatusFound)
	})

	// 5. Redirect without a Location header ends the chain here.
	mux.HandleFunc("/no-location", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodHead {
			w.WriteHeader(http.StatusFound)
			return
		}
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte("<html><head><title>Stayed Put</title></head></html>"))
	})

	// 6. Redirect to a page that is not HTML: nothing to show.
	mux.HandleFunc("/to-json", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/json", http.StatusFound)
	})
	mux.HandleFunc("/json", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"title":"not a page"}`))
	})

	ts := httptest.NewServer(mux)
	defer ts.Close()

	cache := newMockCache()
	manager := NewResolverManager(cache)

	unshortener := NewUnshortenerResolver(manager)
	// Override domains for testing
	u, _ := url.Parse(ts.URL)
	unshortener.domains = []string{u.Host}

	manager.Register(unshortener)
	manager.Register(NewOpenGraphResolver())

	ctx := context.Background()

	t.Run("CanHandle", func(t *testing.T) {
		r := NewUnshortenerResolver(manager)
		for _, tc := range []struct {
			url  string
			want bool
		}{
			{"https://bit.ly/abc", true},
			{"https://www.bit.ly/abc", true},
			{"https://T.CO/abc", true},
			{"https://bit.ly.evil.example/abc", false},
			{"https://example.com/bit.ly", false},
		} {
			pu, _ := url.Parse(tc.url)
			if got := r.CanHandle(pu); got != tc.want {
				t.Errorf("CanHandle(%s) = %v, want %v", tc.url, got, tc.want)
			}
		}
	})

	t.Run("Simple Redirect", func(t *testing.T) {
		u, _ := url.Parse(ts.URL + "/short")
		res, err := unshortener.Resolve(ctx, u)
		if err != nil {
			t.Fatalf("Expected no error, got %v", err)
		}
		if res.Title != "Final Destination" {
			t.Errorf("Expected 'Final Destination', got '%s'", res.Title)
		}
	})

	t.Run("Redirect Loop", func(t *testing.T) {
		u, _ := url.Parse(ts.URL + "/loop1")
		_, err := unshortener.Resolve(ctx, u)
		if err == nil {
			t.Fatal("Expected error for redirect loop, got nil")
		}
		if strings.Contains(err.Error(), "/loop") {
			t.Errorf("loop error must not contain the URL path: %v", err)
		}
		if !strings.Contains(err.Error(), u.Host) {
			t.Errorf("loop error should name the host: %v", err)
		}
	})

	t.Run("Redirect to OpenGraph page", func(t *testing.T) {
		u, _ := url.Parse(ts.URL + "/to-og")
		res, err := unshortener.Resolve(ctx, u)
		if err != nil {
			t.Fatalf("Expected no error, got %v", err)
		}
		if res.Title != "OpenGraph Destination" {
			t.Errorf("Expected og:title of the destination, got %q", res.Title)
		}
		if res.Description != "Found through two hops" {
			t.Errorf("Expected og:description of the destination, got %q", res.Description)
		}
		if res.Platform != "Generic" {
			t.Errorf("Expected platform Generic, got %q", res.Platform)
		}
		if want := ts.URL + "/og-page?ref=short"; res.FinalURL != want {
			t.Errorf("FinalURL = %q, want %q", res.FinalURL, want)
		}
	})

	t.Run("Redirect to non-web scheme", func(t *testing.T) {
		u, _ := url.Parse(ts.URL + "/to-js")
		_, err := unshortener.Resolve(ctx, u)
		if !errors.Is(err, ErrUnsupportedScheme) {
			t.Errorf("got %v, want ErrUnsupportedScheme", err)
		}
	})

	t.Run("Redirect without Location", func(t *testing.T) {
		u, _ := url.Parse(ts.URL + "/no-location")
		res, err := unshortener.Resolve(ctx, u)
		if err != nil {
			t.Fatalf("Expected no error, got %v", err)
		}
		if res.Title != "Stayed Put" {
			t.Errorf("Expected 'Stayed Put', got %q", res.Title)
		}
	})

	t.Run("Redirect to non-HTML destination", func(t *testing.T) {
		u, _ := url.Parse(ts.URL + "/to-json")
		res, err := unshortener.Resolve(ctx, u)
		if err != nil {
			t.Fatalf("Expected no error, got %v", err)
		}
		// The destination cannot be titled here, but where the link lands is
		// still reported so the client can show or resolve it.
		if res == nil || res.Title != "" || !strings.HasSuffix(res.FinalURL, "/json") {
			t.Fatalf("Expected a title-less result carrying the final URL, got %+v", res)
		}
	})
}
