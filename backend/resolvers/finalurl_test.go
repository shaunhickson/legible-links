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

// TestUnshortenerReportsFinalURLWithoutTitle: when the destination cannot be
// titled by this server (a platform page, a binary), the unshortener still
// returns where the link lands so the client can resolve it locally.
func TestUnshortenerReportsFinalURLWithoutTitle(t *testing.T) {
	transport.SetAllowLocalIPs(true)
	t.Cleanup(func() { transport.SetAllowLocalIPs(false) })

	mux := http.NewServeMux()
	mux.HandleFunc("/short", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/video", http.StatusFound)
	})
	mux.HandleFunc("/video", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		_, _ = w.Write([]byte("not html"))
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
	if err != nil || res == nil {
		t.Fatalf("expected a result carrying the final URL, got %+v (err %v)", res, err)
	}
	if res.Title != "" || res.FinalURL != ts.URL+"/video" {
		t.Fatalf("got %+v", res)
	}
	// Through the manager a FinalURL-only answer survives, since it alone is useful.
	m2 := NewResolverManager(newMockCache())
	m2.Register(finalOnlyResolver{final: "https://video.example/watch?v=1"})
	results := m2.ResolveMulti(context.Background(), []string{"https://sho.rt/abc"})
	if r := results["https://sho.rt/abc"]; r == nil || r.FinalURL != "https://video.example/watch?v=1" || r.Title != "" {
		t.Fatalf("manager dropped or altered the finalUrl-only result: %+v", r)
	}
}

// finalOnlyResolver stands in for the unshortener landing on a page this
// server cannot title.
type finalOnlyResolver struct{ final string }

func (finalOnlyResolver) Name() string            { return "final-only" }
func (finalOnlyResolver) CanHandle(*url.URL) bool { return true }
func (f finalOnlyResolver) Resolve(context.Context, *url.URL) (*Result, error) {
	return &Result{FinalURL: f.final}, nil
}
