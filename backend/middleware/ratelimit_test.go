package middleware

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"
)

func setHops(t *testing.T, n int) {
	t.Helper()
	old := TrustedProxyHops
	TrustedProxyHops = n
	t.Cleanup(func() { TrustedProxyHops = old })
}

func okHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
}

func TestRateLimiter(t *testing.T) {
	setHops(t, 0)
	// 60 RPM, Burst 1
	rl := NewRateLimiter(60, 1)
	handler := rl.Middleware(okHandler())

	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "1.2.3.4:1234"

	// 1. First request should pass
	rec1 := httptest.NewRecorder()
	handler.ServeHTTP(rec1, req)
	if rec1.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", rec1.Code)
	}

	// 2. Second request (immediate) should fail (Burst is 1)
	rec2 := httptest.NewRecorder()
	handler.ServeHTTP(rec2, req)
	if rec2.Code != http.StatusTooManyRequests {
		t.Errorf("Expected 429, got %d", rec2.Code)
	}
	if ra := rec2.Header().Get("Retry-After"); ra == "" {
		t.Error("Expected Retry-After header on 429")
	} else if n, err := strconv.Atoi(ra); err != nil || n < 1 {
		t.Errorf("Retry-After should be a positive integer, got %q", ra)
	}
	if rec2.Header().Get("Cache-Control") != "no-store" {
		t.Error("Expected Cache-Control: no-store on 429")
	}

	// 3. Different IP should pass
	req2 := httptest.NewRequest("GET", "/", nil)
	req2.RemoteAddr = "5.6.7.8:5678"
	rec3 := httptest.NewRecorder()
	handler.ServeHTTP(rec3, req2)
	if rec3.Code != http.StatusOK {
		t.Errorf("Expected 200 for new IP, got %d", rec3.Code)
	}
}

func TestGetIP(t *testing.T) {
	tests := []struct {
		name       string
		hops       int
		remoteAddr string
		xff        []string
		want       string
	}{
		{"no header, hops 0", 0, "10.0.0.1:1234", nil, "10.0.0.1"},
		{"header ignored with hops 0", 0, "10.0.0.1:1234", []string{"1.1.1.1, 2.2.2.2"}, "10.0.0.1"},
		{"hops 1 takes rightmost", 1, "10.0.0.1:1234", []string{"1.1.1.1, 2.2.2.2"}, "2.2.2.2"},
		{"hops 1 single entry", 1, "10.0.0.1:1234", []string{"3.3.3.3"}, "3.3.3.3"},
		{"hops 1 with leading junk", 1, "10.0.0.1:1234", []string{"junk, <script>, 2.2.2.2"}, "2.2.2.2"},
		{"hops 1 rightmost junk falls back", 1, "10.0.0.1:1234", []string{"1.1.1.1, junk"}, "10.0.0.1"},
		{"hops 1 no header falls back", 1, "10.0.0.1:1234", nil, "10.0.0.1"},
		{"hops 1 empty header falls back", 1, "10.0.0.1:1234", []string{""}, "10.0.0.1"},
		{"hops 2 takes second from right", 2, "10.0.0.1:1234", []string{"1.1.1.1, 2.2.2.2, 3.3.3.3"}, "2.2.2.2"},
		{"hops 2 with too few entries falls back", 2, "10.0.0.1:1234", []string{"3.3.3.3"}, "10.0.0.1"},
		{"hops 3 with too few entries falls back", 3, "10.0.0.1:1234", []string{"1.1.1.1, 2.2.2.2"}, "10.0.0.1"},
		{"multiple header lines joined in order", 1, "10.0.0.1:1234", []string{"1.1.1.1", "2.2.2.2"}, "2.2.2.2"},
		{"ipv6 entry", 1, "10.0.0.1:1234", []string{"1.1.1.1, 2001:db8::1"}, "2001:db8::1"},
		{"ipv4-mapped entry unmapped", 1, "10.0.0.1:1234", []string{"::ffff:2.2.2.2"}, "2.2.2.2"},
		{"ipv6 remote addr", 0, "[2001:db8::5]:443", nil, "2001:db8::5"},
		{"remote addr without port", 0, "10.0.0.7", nil, "10.0.0.7"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			setHops(t, tc.hops)
			req := httptest.NewRequest("GET", "/", nil)
			req.RemoteAddr = tc.remoteAddr
			for _, v := range tc.xff {
				req.Header.Add("X-Forwarded-For", v)
			}
			if got := getIP(req); got != tc.want {
				t.Errorf("getIP() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestRateLimiter_SpoofedXFFDoesNotBypassWithoutProxy(t *testing.T) {
	setHops(t, 0)
	rl := NewRateLimiter(60, 3)
	handler := rl.Middleware(okHandler())

	// One TCP peer rotating the client-controlled X-Forwarded-For value.
	var codes []int
	for i := 0; i < 6; i++ {
		req := httptest.NewRequest("GET", "/", nil)
		req.RemoteAddr = "203.0.113.9:4444"
		req.Header.Set("X-Forwarded-For", fmt.Sprintf("10.0.0.%d", i))
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		codes = append(codes, rec.Code)
	}

	for i, code := range codes {
		want := http.StatusOK
		if i >= 3 {
			want = http.StatusTooManyRequests
		}
		if code != want {
			t.Errorf("request %d: got %d, want %d (codes: %v)", i, code, want, codes)
		}
	}
}

func TestRateLimiter_XFFRightmostWithProxy(t *testing.T) {
	setHops(t, 1)
	rl := NewRateLimiter(60, 1)
	handler := rl.Middleware(okHandler())

	send := func(xff string) int {
		req := httptest.NewRequest("GET", "/", nil)
		req.RemoteAddr = "169.254.8.8:1234" // the proxy
		req.Header.Set("X-Forwarded-For", xff)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec.Code
	}

	// Rotating a client-supplied leading entry must not create fresh buckets:
	// the rightmost (proxy-appended) address is the key.
	if code := send("1.1.1.1, 2.2.2.2"); code != http.StatusOK {
		t.Errorf("first request: got %d, want 200", code)
	}
	if code := send("9.9.9.9, 2.2.2.2"); code != http.StatusTooManyRequests {
		t.Errorf("second request with different leading junk: got %d, want 429", code)
	}
	if code := send("junk, 2.2.2.2"); code != http.StatusTooManyRequests {
		t.Errorf("third request with non-IP leading junk: got %d, want 429", code)
	}
	// A genuinely different client is unaffected.
	if code := send("1.1.1.1, 3.3.3.3"); code != http.StatusOK {
		t.Errorf("different rightmost address: got %d, want 200", code)
	}
}

func TestRateLimiter_GlobalLimit(t *testing.T) {
	setHops(t, 0)
	rl := NewRateLimiter(6000, 100) // generous per-IP so only the global limit bites
	rl.SetGlobalLimit(1, 2)
	handler := rl.Middleware(okHandler())

	send := func(ip string) *httptest.ResponseRecorder {
		req := httptest.NewRequest("GET", "/", nil)
		req.RemoteAddr = ip + ":1234"
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec
	}

	if rec := send("1.1.1.1"); rec.Code != http.StatusOK {
		t.Errorf("1st: got %d", rec.Code)
	}
	if rec := send("2.2.2.2"); rec.Code != http.StatusOK {
		t.Errorf("2nd: got %d", rec.Code)
	}
	rec := send("3.3.3.3")
	if rec.Code != http.StatusTooManyRequests {
		t.Errorf("3rd (distinct IP, global burst exhausted): got %d, want 429", rec.Code)
	}
	if rec.Header().Get("Retry-After") == "" {
		t.Error("Expected Retry-After on global 429")
	}

	// Disabling the global limit restores service.
	rl.SetGlobalLimit(0, 0)
	if rec := send("4.4.4.4"); rec.Code != http.StatusOK {
		t.Errorf("after disabling global limit: got %d, want 200", rec.Code)
	}
}

func TestCleanup(t *testing.T) {
	rl := NewRateLimiter(60, 10)

	rl.mu.Lock()
	rl.visitors["stale"] = &visitor{limiter: nil, lastSeen: time.Now().Add(-10 * time.Minute)}
	rl.visitors["fresh"] = &visitor{limiter: nil, lastSeen: time.Now()}
	rl.mu.Unlock()

	rl.cleanup(3 * time.Minute)

	rl.mu.Lock()
	defer rl.mu.Unlock()
	if _, ok := rl.visitors["stale"]; ok {
		t.Error("stale visitor should have been removed")
	}
	if _, ok := rl.visitors["fresh"]; !ok {
		t.Error("fresh visitor should have been kept")
	}
}

func TestRunCleanup_StopsOnCancel(t *testing.T) {
	rl := NewRateLimiter(60, 10)
	ctx, cancel := context.WithCancel(context.Background())

	done := make(chan struct{})
	go func() {
		rl.runCleanup(ctx, time.Millisecond, time.Minute)
		close(done)
	}()

	// Let a few ticks happen, then cancel.
	time.Sleep(5 * time.Millisecond)
	cancel()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("runCleanup did not exit after context cancellation")
	}
}

func TestRunCleanup_RemovesStaleWhileRunning(t *testing.T) {
	rl := NewRateLimiter(60, 10)
	rl.mu.Lock()
	rl.visitors["stale"] = &visitor{lastSeen: time.Now().Add(-time.Hour)}
	rl.mu.Unlock()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	rl.CleanupBackground(ctx, time.Millisecond, time.Minute)

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		rl.mu.Lock()
		_, ok := rl.visitors["stale"]
		rl.mu.Unlock()
		if !ok {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("background cleanup never removed the stale visitor")
}

func TestRetryAfterSeconds(t *testing.T) {
	// 1 token per 10 seconds, burst 1: after one Allow the next is ~10s away.
	rl := NewRateLimiter(6, 1)
	l := rl.getVisitor("x")
	if !l.Allow() {
		t.Fatal("first Allow should succeed")
	}
	if secs := retryAfterSeconds(l); secs < 9 || secs > 10 {
		t.Errorf("retryAfterSeconds = %d, want about 10", secs)
	}
	// Estimating must not consume a token.
	if secs := retryAfterSeconds(l); secs < 9 || secs > 10 {
		t.Errorf("second estimate = %d, want about 10 (estimate consumed a token?)", secs)
	}
}
