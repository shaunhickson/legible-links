package main

import (
	"container/list"
	"sync"
	"time"

	"github.com/shaunhickson/legible-links/backend/resolvers"
)

const (
	// DefaultCacheMaxEntries bounds the in-memory cache.
	DefaultCacheMaxEntries = 10000
	// DefaultCacheTTL is how long a resolved title stays valid.
	DefaultCacheTTL = 24 * time.Hour
)

// InMemoryCache is a bounded, thread-safe LRU cache with per-entry TTL.
// Expired entries are treated as misses and removed when touched; the
// least-recently-used entry is evicted when the size bound is exceeded.
type InMemoryCache struct {
	mu         sync.Mutex
	maxEntries int
	ttl        time.Duration
	now        func() time.Time // injectable for tests
	ll         *list.List       // front = most recently used
	items      map[string]*list.Element
}

type cacheEntry struct {
	key     string
	value   string
	expires time.Time
}

var _ resolvers.Cache = (*InMemoryCache)(nil)

// NewInMemoryCache returns a cache holding at most maxEntries entries, each
// valid for ttl. Non-positive arguments select the defaults.
func NewInMemoryCache(maxEntries int, ttl time.Duration) *InMemoryCache {
	if maxEntries <= 0 {
		maxEntries = DefaultCacheMaxEntries
	}
	if ttl <= 0 {
		ttl = DefaultCacheTTL
	}
	return &InMemoryCache{
		maxEntries: maxEntries,
		ttl:        ttl,
		now:        time.Now,
		ll:         list.New(),
		items:      make(map[string]*list.Element),
	}
}

func (c *InMemoryCache) Get(key string) (string, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.get(key, c.now())
}

func (c *InMemoryCache) Set(key string, value string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	expires := c.now().Add(c.ttl)
	if el, ok := c.items[key]; ok {
		e := el.Value.(*cacheEntry)
		e.value = value
		e.expires = expires
		c.ll.MoveToFront(el)
		return
	}

	el := c.ll.PushFront(&cacheEntry{key: key, value: value, expires: expires})
	c.items[key] = el

	for c.ll.Len() > c.maxEntries {
		c.removeElement(c.ll.Back())
	}
}

func (c *InMemoryCache) GetMulti(keys []string) map[string]string {
	c.mu.Lock()
	defer c.mu.Unlock()

	now := c.now()
	results := make(map[string]string)
	for _, key := range keys {
		if val, ok := c.get(key, now); ok {
			results[key] = val
		}
	}
	return results
}

// Len returns the number of entries currently held, expired or not.
func (c *InMemoryCache) Len() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.ll.Len()
}

// get must be called with c.mu held.
func (c *InMemoryCache) get(key string, now time.Time) (string, bool) {
	el, ok := c.items[key]
	if !ok {
		return "", false
	}
	e := el.Value.(*cacheEntry)
	if !now.Before(e.expires) {
		c.removeElement(el)
		return "", false
	}
	c.ll.MoveToFront(el)
	return e.value, true
}

// removeElement must be called with c.mu held.
func (c *InMemoryCache) removeElement(el *list.Element) {
	c.ll.Remove(el)
	delete(c.items, el.Value.(*cacheEntry).key)
}
