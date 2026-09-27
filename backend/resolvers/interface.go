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

// Clone returns an independent copy of r, or nil for a nil receiver.
func (r *Result) Clone() *Result {
	if r == nil {
		return nil
	}
	cp := *r
	return &cp
}

// Cache stores resolution results keyed by the requested URL.
//
// Besides results, a key can hold a negative entry: a record that resolving
// it failed, kept for a shorter time so a page full of dead links does not
// re-trigger fetches. Get reports a negative entry as (nil, true) and
// GetMulti maps the key to nil; callers must treat both as "known to fail",
// never as a result. A missing key is (nil, false), or absent from the map.
//
// Implementations must be safe for concurrent use and must copy results on
// the way in and out, so the caller's pointer is never retained and a cached
// value can never be mutated through a returned pointer.
type Cache interface {
	Get(key string) (*Result, bool)
	// Set stores a copy of res. A nil res is ignored; failures are recorded
	// with SetNegative.
	Set(key string, res *Result)
	// SetNegative records that key failed to resolve. It never replaces an
	// unexpired result.
	SetNegative(key string)
	GetMulti(keys []string) map[string]*Result
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
