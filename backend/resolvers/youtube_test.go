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

func TestYouTubeResolver_CanHandle(t *testing.T) {
	r := NewYouTubeResolver()
	tests := []struct {
		urlStr string
		want   bool
	}{
		{"https://youtube.com/watch?v=123", true},
		{"https://www.youtube.com/watch?v=123", true},
		{"https://m.youtube.com/watch?v=123", true},
		{"https://youtu.be/123", true},
		{"https://youtube.com/shorts/123", true},
		{"https://www.youtube-nocookie.com/embed/123", true},
		{"https://youtube-nocookie.com/embed/123", true},
		{"https://WWW.YOUTUBE.COM/watch?v=123", true},
		{"https://google.com", false},
		{"https://notyoutube.com/watch?v=123", false},
		{"https://youtube.com.evil.example/watch?v=123", false},
	}

	for _, tt := range tests {
		u, _ := url.Parse(tt.urlStr)
		if got := r.CanHandle(u); got != tt.want {
			t.Errorf("CanHandle(%s) = %v, want %v", tt.urlStr, got, tt.want)
		}
	}
}

func TestExtractVideoID(t *testing.T) {
	tests := []struct {
		urlStr string
		want   string
	}{
		{"https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"},
		{"https://www.youtube.com/watch?feature=share&v=dQw4w9WgXcQ&t=10", "dQw4w9WgXcQ"},
		{"https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"},
		{"https://youtu.be/dQw4w9WgXcQ?t=42", "dQw4w9WgXcQ"},
		{"https://youtu.be/dQw4w9WgXcQ/", "dQw4w9WgXcQ"},
		{"https://www.youtube.com/shorts/abc_-123", "abc_-123"},
		{"https://www.youtube.com/live/abc123", "abc123"},
		{"https://www.youtube-nocookie.com/embed/abc123", "abc123"},
		{"https://www.youtube.com/embed/abc123?autoplay=1", "abc123"},
		{"https://www.youtube.com/v/abc123", "abc123"},
		{"https://www.youtube.com/", ""},
		{"https://www.youtube.com/@somechannel", ""},
		{"https://www.youtube.com/watch", ""},
		{"https://www.youtube.com/watch?v=", ""},
		{"https://www.youtube.com/watch?v=bad%20id", ""},
		{"https://www.youtube.com/watch?v=a/b", ""},
		{"https://youtu.be/", ""},
	}
	for _, tt := range tests {
		u, err := url.Parse(tt.urlStr)
		if err != nil {
			t.Fatalf("parse %s: %v", tt.urlStr, err)
		}
		if got := extractVideoID(u); got != tt.want {
			t.Errorf("extractVideoID(%s) = %q, want %q", tt.urlStr, got, tt.want)
		}
	}
}

// newOEmbedServer returns an httptest server that answers YouTube oEmbed
// requests, plus a YouTubeResolver pointed at it.
func newOEmbedServer(t *testing.T, handler http.HandlerFunc) (*httptest.Server, *YouTubeResolver) {
	t.Helper()
	transport.SetAllowLocalIPs(true)
	t.Cleanup(func() { transport.SetAllowLocalIPs(false) })

	ts := httptest.NewServer(handler)
	t.Cleanup(ts.Close)

	r := NewYouTubeResolver()
	r.oembedURL = ts.URL + "/oembed"
	return ts, r
}

func TestYouTubeResolver_Resolve(t *testing.T) {
	var gotQuery url.Values
	_, r := newOEmbedServer(t, func(w http.ResponseWriter, req *http.Request) {
		gotQuery = req.URL.Query()
		if req.URL.Path != "/oembed" {
			http.NotFound(w, req)
			return
		}
		if req.Header.Get("User-Agent") != UserAgent {
			t.Errorf("User-Agent = %q, want %q", req.Header.Get("User-Agent"), UserAgent)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"title":"Never Gonna Give You Up","author_name":"Rick Astley","type":"video"}`))
	})

	ctx := context.Background()

	for _, urlStr := range []string{
		"https://www.youtube.com/watch?v=dQw4w9WgXcQ",
		"https://youtu.be/dQw4w9WgXcQ",
		"https://www.youtube.com/shorts/dQw4w9WgXcQ",
		"https://m.youtube.com/watch?v=dQw4w9WgXcQ",
	} {
		u, _ := url.Parse(urlStr)
		res, err := r.Resolve(ctx, u)
		if err != nil {
			t.Fatalf("Resolve(%s) failed: %v", urlStr, err)
		}
		if res.Title != "Never Gonna Give You Up" {
			t.Errorf("Resolve(%s): title = %q", urlStr, res.Title)
		}
		if res.Description != "Rick Astley" {
			t.Errorf("Resolve(%s): description = %q", urlStr, res.Description)
		}
		if res.Platform != "YouTube" {
			t.Errorf("Resolve(%s): platform = %q", urlStr, res.Platform)
		}
		if got := gotQuery.Get("url"); got != "https://www.youtube.com/watch?v=dQw4w9WgXcQ" {
			t.Errorf("Resolve(%s): oembed url param = %q", urlStr, got)
		}
		if got := gotQuery.Get("format"); got != "json" {
			t.Errorf("Resolve(%s): oembed format param = %q", urlStr, got)
		}
	}
}

func TestYouTubeResolver_Resolve_SanitizesTitle(t *testing.T) {
	_, r := newOEmbedServer(t, func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"title":"\u202E  spoofed \u200B title\n","author_name":"  a\tb  "}`))
	})

	u, _ := url.Parse("https://youtu.be/abc123")
	res, err := r.Resolve(context.Background(), u)
	if err != nil {
		t.Fatal(err)
	}
	if res.Title != "spoofed title" {
		t.Errorf("title = %q", res.Title)
	}
	if res.Description != "a b" {
		t.Errorf("description = %q", res.Description)
	}
}

func TestYouTubeResolver_Resolve_Errors(t *testing.T) {
	t.Run("no video id", func(t *testing.T) {
		_, r := newOEmbedServer(t, func(w http.ResponseWriter, req *http.Request) {
			t.Error("oembed endpoint should not be called without a video ID")
		})
		u, _ := url.Parse("https://www.youtube.com/@channel")
		_, err := r.Resolve(context.Background(), u)
		if !errors.Is(err, ErrNoVideoID) {
			t.Errorf("got %v, want ErrNoVideoID", err)
		}
	})

	t.Run("404 from oembed", func(t *testing.T) {
		_, r := newOEmbedServer(t, func(w http.ResponseWriter, req *http.Request) {
			http.Error(w, "Not Found", http.StatusNotFound)
		})
		u, _ := url.Parse("https://youtu.be/missing1")
		_, err := r.Resolve(context.Background(), u)
		if err == nil || !strings.Contains(err.Error(), "404") {
			t.Errorf("got %v, want status 404 error", err)
		}
	})

	t.Run("empty title", func(t *testing.T) {
		_, r := newOEmbedServer(t, func(w http.ResponseWriter, req *http.Request) {
			_, _ = w.Write([]byte(`{"title":"","author_name":"x"}`))
		})
		u, _ := url.Parse("https://youtu.be/abc123")
		_, err := r.Resolve(context.Background(), u)
		if !errors.Is(err, ErrNoTitle) {
			t.Errorf("got %v, want ErrNoTitle", err)
		}
	})

	t.Run("malformed json", func(t *testing.T) {
		_, r := newOEmbedServer(t, func(w http.ResponseWriter, req *http.Request) {
			_, _ = w.Write([]byte(`<html>not json</html>`))
		})
		u, _ := url.Parse("https://youtu.be/abc123")
		_, err := r.Resolve(context.Background(), u)
		if err == nil {
			t.Error("expected an error for malformed JSON")
		}
	})
}
