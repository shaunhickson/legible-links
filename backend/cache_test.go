package main

import (
	"fmt"
	"sync"
	"testing"
	"time"
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

func TestCache_GetSet(t *testing.T) {
	c, _ := newTestCache(10, time.Hour)

	if _, ok := c.Get("missing"); ok {
		t.Error("expected miss for unknown key")
	}

	c.Set("a", "Title A")
	if v, ok := c.Get("a"); !ok || v != "Title A" {
		t.Errorf("Get(a) = %q, %v; want Title A, true", v, ok)
	}

	c.Set("a", "Title A2")
	if v, _ := c.Get("a"); v != "Title A2" {
		t.Errorf("Get(a) after update = %q; want Title A2", v)
	}
	if c.Len() != 1 {
		t.Errorf("Len() = %d after updating one key; want 1", c.Len())
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
}

func TestCache_EvictionOrder(t *testing.T) {
	c, _ := newTestCache(3, time.Hour)

	c.Set("a", "A")
	c.Set("b", "B")
	c.Set("c", "C")

	// Touch "a" so "b" becomes the least recently used.
	if _, ok := c.Get("a"); !ok {
		t.Fatal("a should be present")
	}

	c.Set("d", "D") // evicts b

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
	c.Set("c", "C2") // order now: c, d, a
	c.Set("e", "E")  // evicts a
	if _, ok := c.Get("a"); ok {
		t.Error("a should have been evicted")
	}
	if v, ok := c.Get("c"); !ok || v != "C2" {
		t.Errorf("c = %q, %v; want C2, true", v, ok)
	}
	if c.Len() != 3 {
		t.Errorf("Len() = %d, want 3", c.Len())
	}
}

func TestCache_EvictsExactlyDownToBound(t *testing.T) {
	c, _ := newTestCache(5, time.Hour)
	for i := 0; i < 50; i++ {
		c.Set(fmt.Sprintf("k%d", i), "v")
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

	c.Set("a", "A")

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
	c.Set("a", "A")
	clock.Advance(time.Hour)
	if _, ok := c.Get("a"); ok {
		t.Error("entry should be a miss exactly at its expiry time")
	}
}

func TestCache_SetRefreshesTTL(t *testing.T) {
	c, clock := newTestCache(10, time.Hour)

	c.Set("a", "A")
	clock.Advance(50 * time.Minute)
	c.Set("a", "A-refreshed")
	clock.Advance(20 * time.Minute) // 70 min since first Set, 20 since refresh

	if v, ok := c.Get("a"); !ok || v != "A-refreshed" {
		t.Errorf("Get(a) = %q, %v; want refreshed value", v, ok)
	}
}

func TestCache_GetDoesNotExtendTTL(t *testing.T) {
	c, clock := newTestCache(10, time.Hour)

	c.Set("a", "A")
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

	c.Set("fresh", "F")
	c.Set("old", "O")
	clock.Advance(30 * time.Minute)
	c.Set("newer", "N")
	clock.Advance(40 * time.Minute) // fresh and old are 70 min old; newer is 40

	got := c.GetMulti([]string{"fresh", "old", "newer", "missing"})
	if len(got) != 1 {
		t.Errorf("GetMulti returned %v; want only newer", got)
	}
	if got["newer"] != "N" {
		t.Errorf("GetMulti[newer] = %q, want N", got["newer"])
	}
	if c.Len() != 1 {
		t.Errorf("expired entries should be purged by GetMulti; Len() = %d", c.Len())
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
				c.Set(key, "v")
				c.Get(key)
				c.GetMulti([]string{key, "other"})
			}
		}(g)
	}
	wg.Wait()

	if n := c.Len(); n > 100 {
		t.Errorf("Len() = %d exceeds bound 100", n)
	}
}
