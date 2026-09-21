package resolvers

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type MockCache struct {
	mu    sync.Mutex
	store map[string]string
}

func newMockCache() *MockCache {
	return &MockCache{store: make(map[string]string)}
}

func (m *MockCache) Get(key string) (string, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	val, ok := m.store[key]
	return val, ok
}

func (m *MockCache) Set(key string, title string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.store[key] = title
}

func (m *MockCache) GetMulti(keys []string) map[string]string {
	m.mu.Lock()
	defer m.mu.Unlock()
	res := make(map[string]string)
	for _, k := range keys {
		if val, ok := m.store[k]; ok {
			res[k] = val
		}
	}
	return res
}

func (m *MockCache) get(key string) string {
	v, _ := m.Get(key)
	return v
}

type MockResolver struct {
	name      string
	canHandle bool
	title     string
	err       error
	resolveFn func(ctx context.Context, u *url.URL) (*Result, error)
	calls     atomic.Int32
}

func (r *MockResolver) Name() string              { return r.name }
func (r *MockResolver) CanHandle(u *url.URL) bool { return r.canHandle }
func (r *MockResolver) Resolve(ctx context.Context, u *url.URL) (*Result, error) {
	r.calls.Add(1)
	if r.resolveFn != nil {
		return r.resolveFn(ctx, u)
	}
	if r.err != nil {
		return nil, r.err
	}
	return &Result{Title: r.title, Platform: r.name}, nil
}

// captureLogs routes the default slog logger into a buffer at debug level for
// the duration of the test.
func captureLogs(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	old := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(old) })
	return &buf
}

func TestResolverManager(t *testing.T) {
	cache := newMockCache()
	manager := NewResolverManager(cache)

	r1 := &MockResolver{name: "r1", canHandle: true, title: "Title 1"}
	manager.Register(r1)

	ctx := context.Background()
	urls := []string{"https://example.com/1"}

	results := manager.ResolveMulti(ctx, urls)

	if results["https://example.com/1"].Title != "Title 1" {
		t.Errorf("Expected Title 1, got %s", results["https://example.com/1"].Title)
	}

	// Check cache
	if cache.get("https://example.com/1") != "Title 1" {
		t.Errorf("Expected Title 1 in cache, got %s", cache.get("https://example.com/1"))
	}
}

func TestResolverManager_CacheHitSkipsResolvers(t *testing.T) {
	cache := newMockCache()
	cache.Set("https://example.com/cached", "Cached Title")
	manager := NewResolverManager(cache)

	r1 := &MockResolver{name: "r1", canHandle: true, title: "Fresh Title"}
	manager.Register(r1)

	results := manager.ResolveMulti(context.Background(), []string{"https://example.com/cached"})
	if got := results["https://example.com/cached"].Title; got != "Cached Title" {
		t.Errorf("got %q, want cached title", got)
	}
	if r1.calls.Load() != 0 {
		t.Errorf("resolver was called %d times for a cached URL", r1.calls.Load())
	}
}

func TestResolverManager_FallsThroughOnErrorAndNil(t *testing.T) {
	cache := newMockCache()
	manager := NewResolverManager(cache)

	failing := &MockResolver{name: "failing", canHandle: true, err: errors.New("boom")}
	nilResult := &MockResolver{name: "nil", canHandle: true, resolveFn: func(context.Context, *url.URL) (*Result, error) {
		return nil, nil
	}}
	cannot := &MockResolver{name: "cannot", canHandle: false, title: "Never"}
	ok := &MockResolver{name: "ok", canHandle: true, title: "Fallback Title"}
	manager.Register(failing)
	manager.Register(nilResult)
	manager.Register(cannot)
	manager.Register(ok)

	results := manager.ResolveMulti(context.Background(), []string{"https://example.com/x"})
	if got := results["https://example.com/x"]; got == nil || got.Title != "Fallback Title" {
		t.Fatalf("got %+v, want Fallback Title", got)
	}
	if cannot.calls.Load() != 0 {
		t.Error("resolver whose CanHandle is false must not be called")
	}
}

func TestResolverManager_AllFailReturnsNothing(t *testing.T) {
	cache := newMockCache()
	manager := NewResolverManager(cache)
	manager.Register(&MockResolver{name: "failing", canHandle: true, err: errors.New("boom")})

	results := manager.ResolveMulti(context.Background(), []string{"https://example.com/x"})
	if len(results) != 0 {
		t.Errorf("expected no results, got %v", results)
	}
	if _, ok := cache.Get("https://example.com/x"); ok {
		t.Error("failed resolutions must not be cached")
	}
}

func TestResolverManager_SanitizesResults(t *testing.T) {
	cache := newMockCache()
	manager := NewResolverManager(cache)
	manager.Register(&MockResolver{name: "r", canHandle: true, resolveFn: func(context.Context, *url.URL) (*Result, error) {
		return &Result{Title: "\u202E  Spoofed\u200B  Title \n", Description: "\x01desc\x02"}, nil
	}})

	results := manager.ResolveMulti(context.Background(), []string{"https://example.com/x"})
	res := results["https://example.com/x"]
	if res == nil {
		t.Fatal("expected a result")
	}
	if res.Title != "Spoofed Title" {
		t.Errorf("title = %q", res.Title)
	}
	if res.Description != "desc" {
		t.Errorf("description = %q", res.Description)
	}
	if cache.get("https://example.com/x") != "Spoofed Title" {
		t.Errorf("cached title = %q, want sanitized value", cache.get("https://example.com/x"))
	}
}

func TestResolverManager_UnparseableURL(t *testing.T) {
	buf := captureLogs(t)
	manager := NewResolverManager(newMockCache())
	r := &MockResolver{name: "r", canHandle: true, title: "T"}
	manager.Register(r)

	bad := "http://secret.example/%zz?token=abc"
	results := manager.ResolveMulti(context.Background(), []string{bad})
	if len(results) != 0 {
		t.Errorf("expected no results for an unparseable URL, got %v", results)
	}
	if r.calls.Load() != 0 {
		t.Error("resolver must not be called for an unparseable URL")
	}
	if strings.Contains(buf.String(), "secret.example") || strings.Contains(buf.String(), "token=abc") {
		t.Errorf("log leaked the unparseable URL: %s", buf.String())
	}
}

func TestNoURLInLogs(t *testing.T) {
	const secret = "https://secret.example/p?token=abc"
	buf := captureLogs(t)

	manager := NewResolverManager(newMockCache())

	// Three failure shapes seen in practice: an http.Client error (*url.Error
	// carries the URL), a dial error (*net.OpError carries the address and
	// wraps a *net.DNSError carrying the host), and a plain error whose text
	// happens to contain the URL.
	manager.Register(&MockResolver{name: "client", canHandle: true, err: &url.Error{
		Op:  "Get",
		URL: secret,
		Err: errors.New("connection refused while fetching " + secret),
	}})
	manager.Register(&MockResolver{name: "dial", canHandle: true, err: &url.Error{
		Op:  "Head",
		URL: secret,
		Err: &net.OpError{
			Op:   "dial",
			Net:  "tcp",
			Addr: &net.TCPAddr{IP: net.ParseIP("10.1.2.3"), Port: 443},
			Err:  &net.DNSError{Err: "no such host", Name: "secret.example", IsNotFound: true},
		},
	}})
	manager.Register(&MockResolver{name: "plain", canHandle: true, err: fmt.Errorf("fetch of %s failed", secret)})

	results := manager.ResolveMulti(context.Background(), []string{secret})
	if len(results) != 0 {
		t.Fatalf("expected no results, got %v", results)
	}

	out := buf.String()
	if strings.Count(out, "resolver failed") != 3 {
		t.Fatalf("expected three 'resolver failed' lines, got:\n%s", out)
	}
	for _, forbidden := range []string{"secret.example/p", "token=abc", "/p?", "10.1.2.3"} {
		if strings.Contains(out, forbidden) {
			t.Errorf("log output contains %q:\n%s", forbidden, out)
		}
	}
	// The host alone is allowed and useful.
	if !strings.Contains(out, "host=secret.example") {
		t.Errorf("expected host attribute in log output:\n%s", out)
	}
}

func TestScrubErr(t *testing.T) {
	const secret = "https://secret.example/p?token=abc"
	tests := []struct {
		name string
		err  error
		want string
	}{
		{"nil", nil, ""},
		{"plain", errors.New("boom"), "boom"},
		{"url.Error", &url.Error{Op: "Get", URL: secret, Err: errors.New("boom")}, "Get: boom"},
		{"url.Error inner has url", &url.Error{Op: "Get", URL: secret, Err: errors.New("bad " + secret + " really")}, "Get: bad <url> really"},
		{"wrapped url.Error", fmt.Errorf("outer: %w", &url.Error{Op: "Get", URL: secret, Err: errors.New("boom")}), "Get: boom"},
		{
			"dial chain",
			&url.Error{Op: "Get", URL: secret, Err: &net.OpError{
				Op: "dial", Net: "tcp",
				Addr: &net.TCPAddr{IP: net.ParseIP("10.1.2.3"), Port: 443},
				Err:  &net.DNSError{Err: "no such host", Name: "secret.example", IsNotFound: true},
			}},
			"Get: net.OpError(dial): net.DNSError(not_found=true, timeout=false)",
		},
		{"bare DNSError", &net.DNSError{Err: "timeout", Name: "secret.example", IsTimeout: true}, "net.DNSError(not_found=false, timeout=true)"},
		{"OpError with syscall text", &net.OpError{Op: "read", Net: "tcp", Err: errors.New("connection reset by peer")}, "net.OpError(read): connection reset by peer"},
		{"AddrError", &net.AddrError{Err: "invalid", Addr: "10.1.2.3"}, "net.AddrError"},
		{"context deadline", context.DeadlineExceeded, "context deadline exceeded"},
		{"two urls in text", errors.New("from http://a.example/x to https://b.example/y?k=v"), "from <url> to <url>"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := scrubErr(tc.err)
			if got != tc.want {
				t.Errorf("scrubErr() = %q, want %q", got, tc.want)
			}
			if strings.Contains(got, "secret.example/p") || strings.Contains(got, "token=abc") || strings.Contains(got, "10.1.2.3") {
				t.Errorf("scrubErr() leaked sensitive data: %q", got)
			}
		})
	}
}

// concurrencyProbe is a resolver that records the highest number of
// simultaneous Resolve calls it has observed.
type concurrencyProbe struct {
	current atomic.Int32
	maxSeen atomic.Int32
	hold    time.Duration
}

func (p *concurrencyProbe) Name() string            { return "probe" }
func (p *concurrencyProbe) CanHandle(*url.URL) bool { return true }
func (p *concurrencyProbe) Resolve(ctx context.Context, u *url.URL) (*Result, error) {
	n := p.current.Add(1)
	defer p.current.Add(-1)
	for {
		m := p.maxSeen.Load()
		if n <= m || p.maxSeen.CompareAndSwap(m, n) {
			break
		}
	}
	select {
	case <-time.After(p.hold):
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	return &Result{Title: "probe " + u.Path}, nil
}

func manyURLs(n int) []string {
	urls := make([]string, n)
	for i := range urls {
		urls[i] = fmt.Sprintf("https://example.com/%d", i)
	}
	return urls
}

func TestResolverManager_PerRequestConcurrencyBound(t *testing.T) {
	probe := &concurrencyProbe{hold: 15 * time.Millisecond}
	manager := NewResolverManager(newMockCache())
	manager.SetTimeout(10 * time.Second)
	manager.SetMaxConcurrent(2)
	manager.Register(probe)

	results := manager.ResolveMulti(context.Background(), manyURLs(8))
	if len(results) != 8 {
		t.Errorf("got %d results, want 8", len(results))
	}
	if got := probe.maxSeen.Load(); got > 2 {
		t.Errorf("observed %d concurrent resolutions, want at most 2", got)
	}
}

func TestResolverManager_GlobalSemaphoreBound(t *testing.T) {
	probe := &concurrencyProbe{hold: 15 * time.Millisecond}
	global := NewSemaphore(1)

	// Two managers sharing one global semaphore, each allowed 8 in parallel.
	var managers []*ResolverManager
	for i := 0; i < 2; i++ {
		m := NewResolverManager(newMockCache())
		m.SetTimeout(10 * time.Second)
		m.SetMaxConcurrent(8)
		m.SetGlobalSemaphore(global)
		m.Register(probe)
		managers = append(managers, m)
	}

	var wg sync.WaitGroup
	for _, m := range managers {
		wg.Add(1)
		go func(m *ResolverManager) {
			defer wg.Done()
			if got := len(m.ResolveMulti(context.Background(), manyURLs(4))); got != 4 {
				t.Errorf("got %d results, want 4", got)
			}
		}(m)
	}
	wg.Wait()

	if got := probe.maxSeen.Load(); got != 1 {
		t.Errorf("observed %d concurrent resolutions across managers, want exactly 1", got)
	}
}

func TestSemaphore(t *testing.T) {
	t.Run("nil is unlimited", func(t *testing.T) {
		var s *Semaphore
		if err := s.Acquire(context.Background()); err != nil {
			t.Fatal(err)
		}
		s.Release()
	})

	t.Run("zero size is nil", func(t *testing.T) {
		if NewSemaphore(0) != nil {
			t.Error("NewSemaphore(0) should return nil")
		}
	})

	t.Run("acquire respects context", func(t *testing.T) {
		s := NewSemaphore(1)
		if err := s.Acquire(context.Background()); err != nil {
			t.Fatal(err)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
		defer cancel()
		if err := s.Acquire(ctx); !errors.Is(err, context.DeadlineExceeded) {
			t.Errorf("got %v, want DeadlineExceeded", err)
		}
		s.Release()
		if err := s.Acquire(context.Background()); err != nil {
			t.Errorf("acquire after release: %v", err)
		}
	})
}

func TestResolverManager_TimeoutReturnsPartialResults(t *testing.T) {
	manager := NewResolverManager(newMockCache())
	manager.SetTimeout(30 * time.Millisecond)
	manager.Register(&MockResolver{name: "slow", canHandle: true, resolveFn: func(ctx context.Context, u *url.URL) (*Result, error) {
		if u.Path == "/fast" {
			return &Result{Title: "Fast"}, nil
		}
		<-ctx.Done()
		return nil, ctx.Err()
	}})

	start := time.Now()
	results := manager.ResolveMulti(context.Background(), []string{"https://example.com/fast", "https://example.com/slow"})
	if time.Since(start) > 2*time.Second {
		t.Error("ResolveMulti did not honour its timeout")
	}
	if results["https://example.com/fast"] == nil {
		t.Error("expected the fast URL to resolve")
	}
	if results["https://example.com/slow"] != nil {
		t.Error("expected the slow URL to be absent")
	}
}

func TestResolveRecursively_SkipsCaller(t *testing.T) {
	buf := captureLogs(t)
	manager := NewResolverManager(newMockCache())
	self := &MockResolver{name: "self", canHandle: true, title: "Self"}
	failing := &MockResolver{name: "failing", canHandle: true, err: errors.New("see https://secret.example/p?token=abc")}
	other := &MockResolver{name: "other", canHandle: true, title: "Other"}
	manager.Register(self)
	manager.Register(failing)
	manager.Register(other)

	u, _ := url.Parse("https://secret.example/p?token=abc")
	res, err := manager.resolveRecursively(context.Background(), u, "self")
	if err != nil {
		t.Fatal(err)
	}
	if res.Title != "Other" {
		t.Errorf("got %q, want Other", res.Title)
	}
	if self.calls.Load() != 0 {
		t.Error("the caller must be skipped")
	}
	if strings.Contains(buf.String(), "token=abc") {
		t.Errorf("log leaked URL: %s", buf.String())
	}

	// No resolver left: the error must name the host only.
	empty := NewResolverManager(newMockCache())
	_, err = empty.resolveRecursively(context.Background(), u, "")
	if err == nil {
		t.Fatal("expected an error")
	}
	if strings.Contains(err.Error(), "token=abc") || strings.Contains(err.Error(), "/p") {
		t.Errorf("error leaked URL: %v", err)
	}
}
