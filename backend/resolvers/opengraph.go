package resolvers

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"time"
)

// ErrNotHTML is returned when a page's Content-Type is not HTML/XHTML.
var ErrNotHTML = errors.New("response is not an html document")

type OpenGraphResolver struct {
	client *http.Client
}

func NewOpenGraphResolver() *OpenGraphResolver {
	return &OpenGraphResolver{
		client: SafeHttpClient(2 * time.Second),
	}
}

func (r *OpenGraphResolver) Name() string {
	return "opengraph"
}

func (r *OpenGraphResolver) CanHandle(u *url.URL) bool {
	// Generic fallback handles everything that looks like a valid http/https URL
	return u.Scheme == "http" || u.Scheme == "https"
}

func (r *OpenGraphResolver) Resolve(ctx context.Context, u *url.URL) (*Result, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("User-Agent", UserAgent)
	req.Header.Set("Accept", "text/html, application/xhtml+xml;q=0.9, */*;q=0.1")

	resp, err := r.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	if !IsHTMLContentType(resp.Header.Get("Content-Type")) {
		return nil, ErrNotHTML
	}

	res, err := ExtractMetadata(resp.Body)
	if err != nil {
		return nil, err
	}

	res.Platform = "Generic"
	return res, nil
}
