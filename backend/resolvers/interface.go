package resolvers

import (
	"context"
	"net/url"
)

// Result represents the outcome of a URL resolution
type Result struct {
	Title       string `json:"title"`
	Description string `json:"description,omitempty"`
	Platform    string `json:"platform"`
	// FinalURL is set when the resolved URL differed from the requested one,
	// e.g. after following a shortener. The extension shows its host as the
	// destination and the original host as "via".
	FinalURL string `json:"finalUrl,omitempty"`
}

// Cache defines the interface for storing and retrieving results
type Cache interface {
	Get(key string) (string, bool)
	Set(key string, title string)
	GetMulti(keys []string) map[string]string
}

// Resolver defines the interface for platform-specific URL resolution
type Resolver interface {
	// Name returns the unique identifier for this resolver
	Name() string

	// CanHandle returns true if this resolver can process the given URL
	CanHandle(u *url.URL) bool

	// Resolve returns a human-friendly title/description for the URL
	Resolve(ctx context.Context, u *url.URL) (*Result, error)
}
