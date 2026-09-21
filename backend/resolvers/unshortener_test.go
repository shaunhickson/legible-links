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

	// 3. YouTube link
	mux.HandleFunc("/to-yt", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "https://www.youtube.com/watch?v=dQw4w9WgXcQ", http.StatusFound)
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

	// YouTube oEmbed stand-in
	mux.HandleFunc("/oembed", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"title":"Never Gonna Give You Up","author_name":"Rick Astley"}`))
	})

	ts := httptest.NewServer(mux)
	defer ts.Close()

	cache := newMockCache()
	manager := NewResolverManager(cache)

	unshortener := NewUnshortenerResolver(manager)
	// Override domains for testing
	u, _ := url.Parse(ts.URL)
	unshortener.domains = []string{u.Host}

	og := NewOpenGraphResolver()
	yt := NewYouTubeResolver()
	yt.oembedURL = ts.URL + "/oembed"

	manager.Register(yt)
	manager.Register(unshortener)
	manager.Register(og)

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

	t.Run("Redirect to YouTube", func(t *testing.T) {
		u, _ := url.Parse(ts.URL + "/to-yt")
		res, err := unshortener.Resolve(ctx, u)
		if err != nil {
			t.Fatalf("Expected no error, got %v", err)
		}
		if res.Title != "Never Gonna Give You Up" {
			t.Errorf("Expected YouTube oEmbed title, got '%s'", res.Title)
		}
		if res.Platform != "YouTube" {
			t.Errorf("Expected platform YouTube, got %q", res.Platform)
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
}
