package main

import (
	"container/list"
	"sync"
	"time"

	"github.com/shaunhickson/legible-links/backend/resolvers"
)

const (
	// DefaultCacheMaxEntries bounds the in-memory cache; results and
	// negative entries count against it together.
	DefaultCacheMaxEntries = 10000
	// DefaultCacheTTL is how long a resolved result stays valid.
	DefaultCacheTTL = 24 * time.Hour
	// DefaultNegativeCacheTTL is how long a failed resolution is remembered.
	DefaultNegativeCacheTTL = 10 * time.Minute
)

// InMemoryCache is a bounded, thread-safe LRU cache with per-entry TTL. It
// holds full resolution results and, for a shorter time, negative entries
// recording that a URL failed to resolve. Expired entries are treated as
// misses and removed when touched; the least-recently-used entry is evicted
// when the size bound is exceeded. Results are copied on the way in and out,
// so neither the caller nor a later reader can mutate a cached value.
type InMemoryCache struct {
	mu          sync.Mutex
	maxEntries  int
	ttl         time.Duration
	negativeTTL time.Duration    // non-positive disables negative caching
	now         func() time.Time // injectable for tests
	ll          *list.List       // front = most recently used
	items       map[string]*list.Element
}

type cacheEntry struct {
	key     string
	value   *resolvers.Result // nil marks a negative entry
	expires time.Time
}

var _ resolvers.Cache = (*InMemoryCache)(nil)

// NewInMemoryCache returns a cache holding at most maxEntries entries, each
// result valid for ttl and each negative entry for DefaultNegativeCacheTTL
// (see SetNegativeTTL). Non-positive arguments select the defaults.
func NewInMemoryCache(maxEntries int, ttl time.Duration) *InMemoryCache {
	if maxEntries <= 0 {
		maxEntries = DefaultCacheMaxEntries
	}
	if ttl <= 0 {
		ttl = DefaultCacheTTL
	}
	return &InMemoryCache{
		maxEntries:  maxEntries,
		ttl:         ttl,
		negativeTTL: DefaultNegativeCacheTTL,
		now:         time.Now,
		ll:          list.New(),
		items:       make(map[string]*list.Element),
	}
}

// SetNegativeTTL sets how long failed resolutions are remembered. A
// non-positive value disables negative caching. Entries already recorded
// keep the expiry they were given.
func (c *InMemoryCache) SetNegativeTTL(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.negativeTTL = d
}

// Get returns a copy of the result cached under key. A negative entry is
// reported as (nil, true).
func (c *InMemoryCache) Get(key string) (*resolvers.Result, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.get(key, c.now())
	if !ok {
		return nil, false
	}
	return e.value.Clone(), true
}

// Set stores a copy of res under key, replacing any existing entry. A nil
// res is ignored.
func (c *InMemoryCache) Set(key string, res *resolvers.Result) {
	if res == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.set(key, res.Clone(), c.now().Add(c.ttl))
}

// SetNegative records that key failed to resolve, unless negative caching is
// disabled or an unexpired result is already cached: a result observed by a
// concurrent request outranks a failure.
func (c *InMemoryCache) SetNegative(key string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.negativeTTL <= 0 {
		return
	}
	now := c.now()
	if e, ok := c.get(key, now); ok && e.value != nil {
		return
	}
	c.set(key, nil, now.Add(c.negativeTTL))
}

// GetMulti returns copies of the entries cached under keys. Negative entries
// are present in the map with a nil value; misses are absent.
func (c *InMemoryCache) GetMulti(keys []string) map[string]*resolvers.Result {
	c.mu.Lock()
	defer c.mu.Unlock()

	now := c.now()
	results := make(map[string]*resolvers.Result)
	for _, key := range keys {
		if e, ok := c.get(key, now); ok {
			results[key] = e.value.Clone()
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

// set must be called with c.mu held.
func (c *InMemoryCache) set(key string, value *resolvers.Result, expires time.Time) {
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

// get must be called with c.mu held. It returns the live entry, which the
// caller must not hand out without copying its value.
func (c *InMemoryCache) get(key string, now time.Time) (*cacheEntry, bool) {
	el, ok := c.items[key]
	if !ok {
		return nil, false
	}
	e := el.Value.(*cacheEntry)
	if !now.Before(e.expires) {
		c.removeElement(el)
		return nil, false
	}
	c.ll.MoveToFront(el)
	return e, true
}

// removeElement must be called with c.mu held.
func (c *InMemoryCache) removeElement(el *list.Element) {
	c.ll.Remove(el)
	delete(c.items, el.Value.(*cacheEntry).key)
}
