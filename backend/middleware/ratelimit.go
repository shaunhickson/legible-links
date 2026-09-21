package middleware

import (
	"context"
	"encoding/json"
	"log/slog"
	"math"
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// TrustedProxyHops is the number of reverse proxies in front of this server
// that append the connecting address to X-Forwarded-For. It is set once at
// startup, before the server begins serving, and must not change afterwards.
//
//   - 0 (default): X-Forwarded-For is ignored; the TCP peer address is used.
//     Anything a client puts in the header cannot influence the rate-limit key.
//   - N: the N-th entry from the right of X-Forwarded-For is used (1 is the
//     rightmost, which is what Cloud Run appends). Entries to the left of it
//     are client-controlled and ignored. If the header has fewer than N
//     entries, or the entry is not an IP address, the TCP peer address is used.
var TrustedProxyHops int

type RateLimiter struct {
	mu       sync.Mutex
	visitors map[string]*visitor
	limit    rate.Limit
	burst    int
	global   *rate.Limiter // nil when no process-wide limit is configured
}

type visitor struct {
	limiter  *rate.Limiter
	lastSeen time.Time // guarded by RateLimiter.mu
}

// NewRateLimiter returns a per-client limiter allowing rpm requests per minute
// with the given burst.
func NewRateLimiter(rpm int, burst int) *RateLimiter {
	return &RateLimiter{
		visitors: make(map[string]*visitor),
		limit:    rate.Limit(rpm) / 60.0,
		burst:    burst,
	}
}

// SetGlobalLimit adds a process-wide token bucket, checked before the
// per-client bucket, allowing rps requests per second with the given burst.
func (rl *RateLimiter) SetGlobalLimit(rps int, burst int) {
	if rps <= 0 {
		rl.global = nil
		return
	}
	rl.global = rate.NewLimiter(rate.Limit(rps), burst)
}

func (rl *RateLimiter) getVisitor(key string) *rate.Limiter {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	v, exists := rl.visitors[key]
	if !exists {
		v = &visitor{limiter: rate.NewLimiter(rl.limit, rl.burst)}
		rl.visitors[key] = v
	}
	v.lastSeen = time.Now()
	return v.limiter
}

// cleanup removes visitors not seen within expiry.
func (rl *RateLimiter) cleanup(expiry time.Duration) {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	cutoff := time.Now().Add(-expiry)
	for key, v := range rl.visitors {
		if v.lastSeen.Before(cutoff) {
			delete(rl.visitors, key)
		}
	}
}

// runCleanup calls cleanup every interval until ctx is done.
func (rl *RateLimiter) runCleanup(ctx context.Context, interval, expiry time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			rl.cleanup(expiry)
		}
	}
}

// CleanupBackground starts a goroutine that removes idle visitors every
// interval. It exits when ctx is cancelled.
func (rl *RateLimiter) CleanupBackground(ctx context.Context, interval, expiry time.Duration) {
	go rl.runCleanup(ctx, interval, expiry)
}

func (rl *RateLimiter) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if rl.global != nil && !rl.global.Allow() {
			reject(w, rl.global)
			return
		}

		limiter := rl.getVisitor(getIP(r))
		if !limiter.Allow() {
			reject(w, limiter)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// reject writes a 429 with a Retry-After hint derived from the limiter.
func reject(w http.ResponseWriter, l *rate.Limiter) {
	w.Header().Set("Retry-After", strconv.Itoa(retryAfterSeconds(l)))
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusTooManyRequests)
	if err := json.NewEncoder(w).Encode(map[string]string{
		"error": "Too many requests. Please try again later.",
	}); err != nil {
		slog.Error("Failed to encode 429 response", "error", err)
	}
}

// retryAfterSeconds estimates how long until the limiter will admit a request.
func retryAfterSeconds(l *rate.Limiter) int {
	res := l.Reserve()
	if !res.OK() {
		return 60
	}
	delay := res.Delay()
	res.Cancel()

	secs := int(math.Ceil(delay.Seconds()))
	if secs < 1 {
		secs = 1
	}
	return secs
}

// getIP returns the rate-limit key for the request: the trusted forwarded
// address when TrustedProxyHops is configured, otherwise the TCP peer.
func getIP(r *http.Request) string {
	if ip, ok := forwardedClientIP(r); ok {
		return ip
	}

	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	if addr, err := netip.ParseAddr(host); err == nil {
		return addr.Unmap().String()
	}
	return host
}

// forwardedClientIP extracts the client address from X-Forwarded-For according
// to TrustedProxyHops. All header lines are joined in order because proxies
// may either append to an existing line or add a new one.
func forwardedClientIP(r *http.Request) (string, bool) {
	hops := TrustedProxyHops
	if hops <= 0 {
		return "", false
	}

	joined := strings.Join(r.Header.Values("X-Forwarded-For"), ",")
	if joined == "" {
		return "", false
	}

	parts := strings.Split(joined, ",")
	if len(parts) < hops {
		return "", false
	}

	candidate := strings.TrimSpace(parts[len(parts)-hops])
	addr, err := netip.ParseAddr(candidate)
	if err != nil {
		return "", false
	}
	return addr.Unmap().String(), true
}
