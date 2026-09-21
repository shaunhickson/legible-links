package resolvers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/shaunhickson/legible-links/backend/transport"
)

// TestUnshortenerSetsFinalURL: a shortened link resolves to the destination's
// title AND reports the destination URL, so the extension can show the real
// host as the headline and the shortener as "via".
func TestUnshortenerSetsFinalURL(t *testing.T) {
	transport.SetAllowLocalIPs(true)
	t.Cleanup(func() { transport.SetAllowLocalIPs(false) })

	mux := http.NewServeMux()
	mux.HandleFunc("/short", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/page?x=1", http.StatusFound)
	})
	mux.HandleFunc("/page", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte(`<html><head><title>Destination</title></head></html>`))
	})
	ts := httptest.NewServer(mux)
	defer ts.Close()

	manager := NewResolverManager(newMockCache())
	unshortener := NewUnshortenerResolver(manager)
	tsURL, _ := url.Parse(ts.URL)
	unshortener.domains = []string{tsURL.Host}
	manager.Register(unshortener)
	manager.Register(NewOpenGraphResolver())

	shortURL, _ := url.Parse(ts.URL + "/short")
	res, err := unshortener.Resolve(context.Background(), shortURL)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if res.Title != "Destination" {
		t.Fatalf("title = %q, want Destination", res.Title)
	}
	if want := ts.URL + "/page?x=1"; res.FinalURL != want {
		t.Fatalf("FinalURL = %q, want %q", res.FinalURL, want)
	}

	// A direct (non-shortened) resolution carries no FinalURL, and the field
	// is omitted from JSON when empty.
	pageURL, _ := url.Parse(ts.URL + "/page")
	direct, err := NewOpenGraphResolver().Resolve(context.Background(), pageURL)
	if err != nil || direct == nil || direct.FinalURL != "" {
		t.Fatalf("direct resolution should not set FinalURL, got %+v (err %v)", direct, err)
	}
	if b, _ := json.Marshal(direct); strings.Contains(string(b), "finalUrl") {
		t.Fatalf("empty finalUrl must be omitted from JSON: %s", b)
	}
	if b, _ := json.Marshal(res); !strings.Contains(string(b), `"finalUrl":"`) {
		t.Fatalf("finalUrl missing from JSON: %s", b)
	}
}
