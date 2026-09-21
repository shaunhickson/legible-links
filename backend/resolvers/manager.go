package resolvers

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"regexp"
	"sync"
	"time"
)

const (
	// DefaultMaxConcurrent is the per-request bound on parallel resolutions.
	DefaultMaxConcurrent = 16
	// DefaultTimeout bounds a whole ResolveMulti call.
	DefaultTimeout = 2 * time.Second
)

// Semaphore bounds the number of concurrent outbound resolutions across the
// whole process. A nil *Semaphore imposes no limit.
type Semaphore struct {
	ch chan struct{}
}

// NewSemaphore returns a semaphore with n slots, or nil when n <= 0.
func NewSemaphore(n int) *Semaphore {
	if n <= 0 {
		return nil
	}
	return &Semaphore{ch: make(chan struct{}, n)}
}

// Acquire takes a slot, waiting until one is free or ctx is done.
func (s *Semaphore) Acquire(ctx context.Context) error {
	if s == nil {
		return nil
	}
	select {
	case s.ch <- struct{}{}:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// Release returns a slot taken by Acquire.
func (s *Semaphore) Release() {
	if s == nil {
		return
	}
	<-s.ch
}

type ResolverManager struct {
	resolvers     []Resolver
	cache         Cache
	timeout       time.Duration
	maxConcurrent int
	global        *Semaphore
}

func NewResolverManager(cache Cache) *ResolverManager {
	return &ResolverManager{
		resolvers:     []Resolver{},
		cache:         cache,
		timeout:       DefaultTimeout,
		maxConcurrent: DefaultMaxConcurrent,
	}
}

func (m *ResolverManager) SetTimeout(t time.Duration) {
	m.timeout = t
}

// SetMaxConcurrent bounds how many URLs of a single request resolve in parallel.
func (m *ResolverManager) SetMaxConcurrent(n int) {
	if n > 0 {
		m.maxConcurrent = n
	}
}

// SetGlobalSemaphore installs a process-wide bound shared across requests.
func (m *ResolverManager) SetGlobalSemaphore(s *Semaphore) {
	m.global = s
}

func (m *ResolverManager) Register(r Resolver) {
	m.resolvers = append(m.resolvers, r)
}

// resolveRecursively attempts to resolve a URL, skipping the caller to avoid infinite loops
func (m *ResolverManager) resolveRecursively(ctx context.Context, u *url.URL, skipResolver string) (*Result, error) {
	for _, r := range m.resolvers {
		if r.Name() == skipResolver {
			continue
		}
		if !r.CanHandle(u) {
			continue
		}
		res, err := r.Resolve(ctx, u)
		if err != nil {
			slog.Debug("resolver failed", "resolver", r.Name(), "host", u.Host, "err", scrubErr(err))
			continue
		}
		if res != nil && res.Title != "" {
			return sanitizeResult(res), nil
		}
	}
	return nil, fmt.Errorf("no resolver succeeded for host %s", u.Host)
}

// resolveOne runs the registered resolvers in order for a single URL and
// returns the first non-empty result, or nil.
func (m *ResolverManager) resolveOne(ctx context.Context, raw string) *Result {
	u, err := url.Parse(raw)
	if err != nil {
		slog.Debug("url parse failed", "err", scrubErr(err))
		return nil
	}

	for _, r := range m.resolvers {
		if !r.CanHandle(u) {
			continue
		}
		res, err := r.Resolve(ctx, u)
		if err != nil {
			slog.Debug("resolver failed", "resolver", r.Name(), "host", u.Host, "err", scrubErr(err))
			continue
		}
		if res != nil && res.Title != "" {
			return sanitizeResult(res)
		}
	}
	return nil
}

func (m *ResolverManager) ResolveMulti(ctx context.Context, urls []string) map[string]*Result {
	// Apply global timeout if not already set on context
	if m.timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, m.timeout)
		defer cancel()
	}

	results := make(map[string]*Result)
	var missingURLs []string

	// 1. Check Cache (the cache stores title strings only)
	cached := m.cache.GetMulti(urls)
	for _, u := range urls {
		if val, ok := cached[u]; ok {
			results[u] = &Result{Title: val}
		} else {
			missingURLs = append(missingURLs, u)
		}
	}

	if len(missingURLs) == 0 {
		return results
	}

	// 2. Resolve missing URLs, at most maxConcurrent at a time for this
	// request and at most the global bound across all requests.
	var wg sync.WaitGroup
	var mu sync.Mutex
	perRequest := make(chan struct{}, m.maxConcurrent)

	for _, rawURL := range missingURLs {
		wg.Add(1)
		go func(raw string) {
			defer wg.Done()

			select {
			case perRequest <- struct{}{}:
			case <-ctx.Done():
				return
			}
			defer func() { <-perRequest }()

			if err := m.global.Acquire(ctx); err != nil {
				return
			}
			defer m.global.Release()

			res := m.resolveOne(ctx, raw)
			if res == nil {
				return
			}
			mu.Lock()
			results[raw] = res
			mu.Unlock()
			m.cache.Set(raw, res.Title)
		}(rawURL)
	}

	wg.Wait()
	return results
}

// sanitizeResult applies the output sanitizer to every resolver result so no
// resolver can forget to.
func sanitizeResult(res *Result) *Result {
	res.Title = SanitizeTitle(res.Title)
	res.Description = SanitizeDescription(res.Description)
	return res
}

var urlInText = regexp.MustCompile(`https?://\S+`)

// scrubErr renders an error for logging without ever including a URL.
// *url.Error carries the full URL in its message, so only its Op and the
// scrubbed inner error are kept; network and DNS errors are reduced to their
// type and operation; anything else has URL-shaped substrings redacted.
func scrubErr(err error) string {
	if err == nil {
		return ""
	}

	var uerr *url.Error
	if errors.As(err, &uerr) {
		return uerr.Op + ": " + scrubErr(uerr.Err)
	}

	// OpError before DNSError: a dial failure wraps the DNS error, and we
	// want to keep the "dial" op rather than skip straight to the cause.
	var opErr *net.OpError
	if errors.As(err, &opErr) {
		return fmt.Sprintf("net.OpError(%s): %s", opErr.Op, scrubErr(opErr.Err))
	}

	var dnsErr *net.DNSError
	if errors.As(err, &dnsErr) {
		return fmt.Sprintf("net.DNSError(not_found=%t, timeout=%t)", dnsErr.IsNotFound, dnsErr.IsTimeout)
	}

	var addrErr *net.AddrError
	if errors.As(err, &addrErr) {
		return "net.AddrError"
	}

	return urlInText.ReplaceAllString(err.Error(), "<url>")
}
