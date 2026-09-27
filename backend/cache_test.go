package main

import (
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/shaunhickson/legible-links/backend/resolvers"
)

// fakeClock is an injectable time source for cache tests.
type fakeClock struct {
	mu sync.Mutex
	t  time.Time
}

func newFakeClock() *fakeClock {
	return &fakeClock{t: time.Date(2026, 9, 20, 12, 0, 0, 0, time.UTC)}
}

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *fakeClock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = c.t.Add(d)
}

func newTestCache(maxEntries int, ttl time.Duration) (*InMemoryCache, *fakeClock) {
	clock := newFakeClock()
	c := NewInMemoryCache(maxEntries, ttl)
	c.now = clock.Now
	return c, clock
}

// titled builds a result whose only interesting field is its title.
func titled(title string) *resolvers.Result {
	return &resolvers.Result{Title: title, Platform: "Generic"}
}

// title returns the cached title for key, or "" when absent or negative.
func title(c *InMemoryCache, key string) string {
	res, _ := c.Get(key)
	if res == nil {
		return ""
	}
	return res.Title
}

func TestCache_GetSet(t *testing.T) {
	c, _ := newTestCache(10, time.Hour)

	if _, ok := c.Get("missing"); ok {
		t.Error("expected miss for unknown key")
	}

	c.Set("a", titled("Title A"))
	if v, ok := c.Get("a"); !ok || v == nil || v.Title != "Title A" {
		t.Errorf("Get(a) = %+v, %v; want Title A, true", v, ok)
	}

	c.Set("a", titled("Title A2"))
	if got := title(c, "a"); got != "Title A2" {
		t.Errorf("Get(a) after update = %q; want Title A2", got)
	}
	if c.Len() != 1 {
		t.Errorf("Len() = %d after updating one key; want 1", c.Len())
	}
}

func TestCache_StoresFullResult(t *testing.T) {
	c, _ := newTestCache(10, time.Hour)
	want := resolvers.Result{Title: "T", Description: "D", Platform: "Generic", FinalURL: "https://final.example/x"}

	c.Set("a", &want)
	got, ok := c.Get("a")
	if !ok || got == nil || *got != want {
		t.Errorf("Get(a) = %+v, %v; want %+v", got, ok, want)
	}
	multi := c.GetMulti([]string{"a"})
	if multi["a"] == nil || *multi["a"] != want {
		t.Errorf("GetMulti[a] = %+v; want %+v", multi["a"], want)
	}
}

func TestCache_StoresAndReturnsCopies(t *testing.T) {
	c, _ := newTestCache(10, time.Hour)

	in := titled("Original")
	c.Set("a", in)
	in.Title = "Changed after Set"
	if got := title(c, "a"); got != "Original" {
		t.Errorf("cache kept the caller's pointer: Get(a) = %q", got)
	}

	out, _ := c.Get("a")
	out.Title = "Changed after Get"
	if got := title(c, "a"); got != "Original" {
		t.Errorf("cache handed out its own pointer: Get(a) = %q", got)
	}

	multi := c.GetMulti([]string{"a"})
	multi["a"].Title = "Changed after GetMulti"
	if got := title(c, "a"); got != "Original" {
		t.Errorf("GetMulti handed out the cache's pointer: Get(a) = %q", got)
	}
}

func TestCache_NilSetIsIgnored(t *testing.T) {
	c, _ := newTestCache(10, time.Hour)
	c.Set("a", nil)
	if _, ok := c.Get("a"); ok {
		t.Error("Set(a, nil) must not create an entry")
	}
	if c.Len() != 0 {
		t.Errorf("Len() = %d, want 0", c.Len())
	}
}

func TestCache_Defaults(t *testing.T) {
	c := NewInMemoryCache(0, 0)
	if c.maxEntries != DefaultCacheMaxEntries {
		t.Errorf("maxEntries = %d, want %d", c.maxEntries, DefaultCacheMaxEntries)
	}
	if c.ttl != DefaultCacheTTL {
		t.Errorf("ttl = %v, want %v", c.ttl, DefaultCacheTTL)
	}
	if c.negativeTTL != DefaultNegativeCacheTTL {
		t.Errorf("negativeTTL = %v, want %v", c.negativeTTL, DefaultNegativeCacheTTL)
	}
}

func TestCache_EvictionOrder(t *testing.T) {
	c, _ := newTestCache(3, time.Hour)

	c.Set("a", titled("A"))
	c.Set("b", titled("B"))
	c.Set("c", titled("C"))

	// Touch "a" so "b" becomes the least recently used.
	if _, ok := c.Get("a"); !ok {
		t.Fatal("a should be present")
	}

	c.Set("d", titled("D")) // evicts b

	if c.Len() != 3 {
		t.Errorf("Len() = %d, want 3", c.Len())
	}
	if _, ok := c.Get("b"); ok {
		t.Error("b should have been evicted as least recently used")
	}
	for _, k := range []string{"a", "c", "d"} {
		if _, ok := c.Get(k); !ok {
			t.Errorf("%s should still be present", k)
		}
	}

	// Setting an existing key counts as use and does not grow the cache.
	c.Set("c", titled("C2")) // order now: c, d, a
	c.Set("e", titled("E"))  // evicts a
	if _, ok := c.Get("a"); ok {
		t.Error("a should have been evicted")
	}
	if got := title(c, "c"); got != "C2" {
		t.Errorf("c = %q; want C2", got)
	}
	if c.Len() != 3 {
		t.Errorf("Len() = %d, want 3", c.Len())
	}
}

func TestCache_EvictsExactlyDownToBound(t *testing.T) {
	c, _ := newTestCache(5, time.Hour)
	for i := 0; i < 50; i++ {
		c.Set(fmt.Sprintf("k%d", i), titled("v"))
	}
	if c.Len() != 5 {
		t.Errorf("Len() = %d, want 5", c.Len())
	}
	// The five most recent survive.
	for i := 45; i < 50; i++ {
		if _, ok := c.Get(fmt.Sprintf("k%d", i)); !ok {
			t.Errorf("k%d should be present", i)
		}
	}
	if _, ok := c.Get("k44"); ok {
		t.Error("k44 should have been evicted")
	}
}

func TestCache_TTLExpiry(t *testing.T) {
	c, clock := newTestCache(10, time.Hour)

	c.Set("a", titled("A"))

	clock.Advance(59 * time.Minute)
	if _, ok := c.Get("a"); !ok {
		t.Error("a should still be valid before the TTL")
	}

	clock.Advance(2 * time.Minute) // 61 minutes since Set
	if _, ok := c.Get("a"); ok {
		t.Error("a should have expired")
	}
	if c.Len() != 0 {
		t.Errorf("expired entry should be removed on access; Len() = %d", c.Len())
	}
}

func TestCache_ExpiryIsExactAtBoundary(t *testing.T) {
	c, clock := newTestCache(10, time.Hour)
	c.Set("a", titled("A"))
	clock.Advance(time.Hour)
	if _, ok := c.Get("a"); ok {
		t.Error("entry should be a miss exactly at its expiry time")
	}
}

func TestCache_SetRefreshesTTL(t *testing.T) {
	c, clock := newTestCache(10, time.Hour)

	c.Set("a", titled("A"))
	clock.Advance(50 * time.Minute)
	c.Set("a", titled("A-refreshed"))
	clock.Advance(20 * time.Minute) // 70 min since first Set, 20 since refresh

	if got := title(c, "a"); got != "A-refreshed" {
		t.Errorf("Get(a) = %q; want refreshed value", got)
	}
}

func TestCache_GetDoesNotExtendTTL(t *testing.T) {
	c, clock := newTestCache(10, time.Hour)

	c.Set("a", titled("A"))
	clock.Advance(50 * time.Minute)
	if _, ok := c.Get("a"); !ok {
		t.Fatal("a should be present")
	}
	clock.Advance(20 * time.Minute) // 70 min since Set
	if _, ok := c.Get("a"); ok {
		t.Error("a Get must not extend the TTL")
	}
}

func TestCache_GetMulti(t *testing.T) {
	c, clock := newTestCache(10, time.Hour)

	c.Set("fresh", titled("F"))
	c.Set("old", titled("O"))
	clock.Advance(30 * time.Minute)
	c.Set("newer", titled("N"))
	clock.Advance(40 * time.Minute) // fresh and old are 70 min old; newer is 40

	got := c.GetMulti([]string{"fresh", "old", "newer", "missing"})
	if len(got) != 1 {
		t.Errorf("GetMulti returned %v; want only newer", got)
	}
	if got["newer"] == nil || got["newer"].Title != "N" {
		t.Errorf("GetMulti[newer] = %+v, want N", got["newer"])
	}
	if c.Len() != 1 {
		t.Errorf("expired entries should be purged by GetMulti; Len() = %d", c.Len())
	}
}

func TestCache_Negative(t *testing.T) {
	c, clock := newTestCache(10, time.Hour)

	c.SetNegative("dead")
	if res, ok := c.Get("dead"); !ok || res != nil {
		t.Errorf("Get(dead) = %+v, %v; want nil, true", res, ok)
	}
	multi := c.GetMulti([]string{"dead", "missing"})
	if res, present := multi["dead"]; !present || res != nil {
		t.Errorf("GetMulti[dead] = %+v (present=%v); want present with nil", res, present)
	}
	if _, present := multi["missing"]; present {
		t.Error("a miss must be absent from GetMulti, unlike a negative entry")
	}
	if c.Len() != 1 {
		t.Errorf("Len() = %d, want 1", c.Len())
	}

	// Negative entries expire on their own, shorter, TTL.
	clock.Advance(DefaultNegativeCacheTTL - time.Second)
	if _, ok := c.Get("dead"); !ok {
		t.Error("negative entry should still be present before its TTL")
	}
	clock.Advance(time.Second)
	if _, ok := c.Get("dead"); ok {
		t.Error("negative entry should have expired")
	}
	if c.Len() != 0 {
		t.Errorf("expired negative entry should be removed; Len() = %d", c.Len())
	}
}

func TestCache_NegativeVersusResult(t *testing.T) {
	c, clock := newTestCache(10, time.Hour)

	// A result replaces a negative entry.
	c.SetNegative("a")
	c.Set("a", titled("Recovered"))
	if got := title(c, "a"); got != "Recovered" {
		t.Errorf("Set after SetNegative: Get(a) = %q, want Recovered", got)
	}

	// A negative entry never replaces an unexpired result.
	c.SetNegative("a")
	if got := title(c, "a"); got != "Recovered" {
		t.Errorf("SetNegative must not replace a live result: Get(a) = %q", got)
	}
	if c.Len() != 1 {
		t.Errorf("Len() = %d, want 1", c.Len())
	}

	// Once the result has expired, a failure can be recorded.
	clock.Advance(time.Hour)
	c.SetNegative("a")
	if res, ok := c.Get("a"); !ok || res != nil {
		t.Errorf("SetNegative after expiry: Get(a) = %+v, %v; want nil, true", res, ok)
	}
}

func TestCache_NegativeTTLConfigurable(t *testing.T) {
	c, clock := newTestCache(10, time.Hour)

	c.SetNegativeTTL(time.Minute)
	c.SetNegative("a")
	clock.Advance(61 * time.Second)
	if _, ok := c.Get("a"); ok {
		t.Error("negative entry should honour the configured TTL")
	}

	// Non-positive disables negative caching entirely.
	c.SetNegativeTTL(0)
	c.SetNegative("b")
	if _, ok := c.Get("b"); ok {
		t.Error("SetNegative must be a no-op when negative caching is disabled")
	}
	if c.Len() != 0 {
		t.Errorf("Len() = %d, want 0", c.Len())
	}
}

func TestCache_NegativeEntriesCountTowardBound(t *testing.T) {
	c, _ := newTestCache(3, time.Hour)
	for i := 0; i < 10; i++ {
		c.SetNegative(fmt.Sprintf("dead%d", i))
	}
	c.Set("live", titled("L"))
	if c.Len() != 3 {
		t.Errorf("Len() = %d, want 3 (negative entries share the bound)", c.Len())
	}
	if got := title(c, "live"); got != "L" {
		t.Errorf("live = %q, want L", got)
	}
	if _, ok := c.Get("dead0"); ok {
		t.Error("oldest negative entry should have been evicted")
	}
}

func TestCache_Concurrent(t *testing.T) {
	c := NewInMemoryCache(100, time.Hour)

	var wg sync.WaitGroup
	for g := 0; g < 8; g++ {
		wg.Add(1)
		go func(g int) {
			defer wg.Done()
			for i := 0; i < 500; i++ {
				key := fmt.Sprintf("k%d", (g*7+i)%150)
				if i%5 == 0 {
					c.SetNegative(key)
				} else {
					c.Set(key, titled("v"))
				}
				if res, ok := c.Get(key); ok && res != nil {
					res.Title = "scribble" // must never reach the cache
				}
				c.GetMulti([]string{key, "other"})
			}
		}(g)
	}
	wg.Wait()

	if n := c.Len(); n > 100 {
		t.Errorf("Len() = %d exceeds bound 100", n)
	}
	for _, res := range c.GetMulti([]string{"k0", "k1", "k2", "k3"}) {
		if res != nil && res.Title == "scribble" {
			t.Error("a mutation of a returned result reached the cache")
		}
	}
}
