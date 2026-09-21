package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/shaunhickson/legible-links/backend/resolvers"
	"github.com/shaunhickson/legible-links/backend/transport"
)

func setupTestServer(t *testing.T) *httptest.Server {
	t.Helper()

	cache := NewInMemoryCache(100, time.Hour)
	manager := resolvers.NewResolverManager(cache)

	// The generic OpenGraph resolver makes raw HTTP calls, so it exercises
	// the safe transport end to end.
	manager.Register(resolvers.NewOpenGraphResolver())

	handler := NewHandler(manager)
	handler.MaxItems = 10
	handler.MaxBodyBytes = 10240

	ts := httptest.NewServer(handler)
	t.Cleanup(ts.Close)
	return ts
}

func postResolve(t *testing.T, apiURL string, urls []string) map[string]string {
	t.Helper()

	reqBody, _ := json.Marshal(map[string][]string{"urls": urls})
	resp, err := http.Post(apiURL+"/resolve", "application/json", bytes.NewBuffer(reqBody))
	if err != nil {
		t.Fatalf("Failed to make request: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("Expected status 200, got %d", resp.StatusCode)
	}
	if got := resp.Header.Get("Cache-Control"); got != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store", got)
	}
	if got := resp.Header.Get("X-Content-Type-Options"); got != "nosniff" {
		t.Errorf("X-Content-Type-Options = %q, want nosniff", got)
	}

	var result struct {
		Titles map[string]string `json:"titles"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}
	return result.Titles
}

func TestIntegration_ResolveOpenGraph(t *testing.T) {
	transport.SetAllowLocalIPs(true) // Allow test to hit local mock server
	t.Cleanup(func() { transport.SetAllowLocalIPs(false) })

	// Create a mock target server that returns a valid OpenGraph HTML response
	mockTarget := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if ua := r.Header.Get("User-Agent"); ua != resolvers.UserAgent {
			t.Errorf("User-Agent = %q, want %q", ua, resolvers.UserAgent)
		}
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte(`
			<html>
			<head>
				<meta property="og:title" content="Integration Test Title">
			</head>
			<body></body>
			</html>
		`))
	}))
	defer mockTarget.Close()

	apiServer := setupTestServer(t)

	titles := postResolve(t, apiServer.URL, []string{mockTarget.URL})

	title, ok := titles[mockTarget.URL]
	if !ok {
		t.Fatalf("Expected title for URL %s, but not found in response", mockTarget.URL)
	}
	if title != "Integration Test Title" {
		t.Errorf("Expected title 'Integration Test Title', got '%s'", title)
	}
}

func TestIntegration_NonHTMLIsIgnored(t *testing.T) {
	transport.SetAllowLocalIPs(true)
	t.Cleanup(func() { transport.SetAllowLocalIPs(false) })

	mockTarget := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"title": "<title>Not HTML</title>"}`))
	}))
	defer mockTarget.Close()

	apiServer := setupTestServer(t)
	titles := postResolve(t, apiServer.URL, []string{mockTarget.URL})
	if len(titles) != 0 {
		t.Errorf("Expected no titles for a JSON response, got %v", titles)
	}
}

func TestIntegration_SSRFProtection(t *testing.T) {
	// Ensure the SSRF checks are on (default behavior)
	transport.SetAllowLocalIPs(false)

	apiServer := setupTestServer(t)

	// List of URLs that should be blocked by SSRF protection
	ssrfURLs := []string{
		"http://127.0.0.1:8080/admin",
		"http://127.0.0.1/admin",
		"http://169.254.169.254/latest/meta-data/",
		"http://[::ffff:169.254.169.254]/latest/meta-data/",
		"http://localhost/secret",
		"http://0.0.0.0/",
		"http://[::]/",
		"http://10.0.0.1/",
		"http://example.com:8443/",
	}

	titles := postResolve(t, apiServer.URL, ssrfURLs)

	// Because all URLs were SSRF attempts, none should have resolved successfully.
	for _, u := range ssrfURLs {
		if _, ok := titles[u]; ok {
			t.Errorf("Expected URL %s to be blocked by SSRF protection, but it was resolved", u)
		}
	}
}

func TestIntegration_InvalidURL(t *testing.T) {
	apiServer := setupTestServer(t)

	titles := postResolve(t, apiServer.URL, []string{"not-a-valid-url", "ftp://example.com/file", "javascript:alert(1)"})

	if len(titles) != 0 {
		t.Errorf("Expected 0 resolved titles for invalid URLs, got %d", len(titles))
	}
}
