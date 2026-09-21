package resolvers

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// ErrUnsupportedScheme is returned when a redirect chain ends somewhere other
// than an http(s) URL.
var ErrUnsupportedScheme = errors.New("final url has an unsupported scheme")

// UnshortenerResolver follows redirect chains to find the final URL
type UnshortenerResolver struct {
	client  *http.Client
	manager *ResolverManager
	domains []string
}

// NewUnshortenerResolver creates a new resolver for shortened URLs
func NewUnshortenerResolver(manager *ResolverManager) *UnshortenerResolver {
	// Known shortener domains
	domains := []string{
		"bit.ly", "t.co", "tinyurl.com", "is.gd", "buff.ly",
		"goo.gl", "bit.do", "ow.ly", "t.ly", "shorturl.at",
	}

	return &UnshortenerResolver{
		client:  SafeHttpClient(2 * time.Second),
		manager: manager,
		domains: domains,
	}
}

func (r *UnshortenerResolver) Name() string {
	return "unshortener"
}

func (r *UnshortenerResolver) CanHandle(u *url.URL) bool {
	host := strings.ToLower(u.Hostname())
	host = strings.TrimPrefix(host, "www.")

	for _, d := range r.domains {
		if host == d {
			return true
		}
	}
	return false
}

func (r *UnshortenerResolver) Resolve(ctx context.Context, u *url.URL) (*Result, error) {
	currentURL := u.String()
	hops := 0
	maxHops := 5
	seen := make(map[string]bool)

	for hops < maxHops {
		if seen[currentURL] {
			// Error text must not carry the URL; the host is enough for logs.
			return nil, fmt.Errorf("redirect loop detected at host %s", u.Host)
		}
		seen[currentURL] = true

		req, err := http.NewRequestWithContext(ctx, http.MethodHead, currentURL, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("User-Agent", UserAgent)

		// We use a client that DOES NOT automatically follow redirects so we can track them
		resp, err := r.client.Transport.RoundTrip(req)
		if err != nil {
			return nil, err
		}
		_ = resp.Body.Close()

		if resp.StatusCode >= 300 && resp.StatusCode < 400 {
			location := resp.Header.Get("Location")
			if location == "" {
				break // Redirect without location? Stop here.
			}

			// Handle relative URLs
			nextURL, err := u.Parse(location)
			if err != nil {
				break
			}
			// Never follow a redirect off the web (javascript:, file:, ...).
			if nextURL.Scheme != "http" && nextURL.Scheme != "https" {
				return nil, ErrUnsupportedScheme
			}
			currentURL = nextURL.String()
			u = nextURL // Update u for relative parsing in next hop
			hops++
		} else {
			// Not a redirect, we've reached the end
			break
		}
	}

	finalURL, err := url.Parse(currentURL)
	if err != nil {
		return nil, err
	}
	if finalURL.Scheme != "http" && finalURL.Scheme != "https" {
		return nil, ErrUnsupportedScheme
	}

	// Now that we have the final URL, let the manager resolve it properly
	// (YouTube, OpenGraph, ...), skipping ourselves to avoid recursion.
	return r.manager.resolveRecursively(ctx, finalURL, r.Name())
}
