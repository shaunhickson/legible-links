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

func TestGitHubResolver(t *testing.T) {
	transport.SetAllowLocalIPs(true)
	t.Cleanup(func() { transport.SetAllowLocalIPs(false) })

	mux := http.NewServeMux()
	mux.HandleFunc("/repos/owner/repo", func(w http.ResponseWriter, r *http.Request) {
		data := githubRepoResponse{
			FullName:        "owner/repo",
			Description:     "A great repository",
			StargazersCount: 100,
			Language:        "Go",
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(data); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
	})

	ts := httptest.NewServer(mux)
	defer ts.Close()

	resolver := NewGitHubResolver("")
	ctx := context.Background()

	t.Run("CanHandle", func(t *testing.T) {
		tests := []struct {
			url      string
			expected bool
		}{
			{"https://github.com/owner/repo", true},
			{"https://www.github.com/owner/repo", true},
			{"https://github.com/settings", false},
			{"https://github.com/owner/repo/pulls", false},
			{"https://google.com", false},
		}

		for _, tc := range tests {
			u, _ := url.Parse(tc.url)
			if resolver.CanHandle(u) != tc.expected {
				t.Errorf("CanHandle(%s) = %v; want %v", tc.url, !tc.expected, tc.expected)
			}
		}
	})

	t.Run("Resolve", func(t *testing.T) {
		resolver.baseURL = ts.URL
		u, _ := url.Parse("https://github.com/owner/repo")
		res, err := resolver.Resolve(ctx, u)
		if err != nil {
			t.Fatalf("Expected no error, got %v", err)
		}

		if res.Title != "owner/repo" {
			t.Errorf("Expected title owner/repo, got %s", res.Title)
		}
		if !strings.Contains(res.Description, "★ 100") {
			t.Errorf("Expected description to contain ★ 100, got %s", res.Description)
		}
		if !strings.Contains(res.Description, "Go") {
			t.Errorf("Expected description to contain Go, got %s", res.Description)
		}
	})
}
