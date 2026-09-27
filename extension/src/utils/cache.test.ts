import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CACHE_STORAGE_KEY, CacheStorage, CachedResolution, createCache } from './cache';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function fakeStorage(initial: Record<string, unknown> = {}) {
    const data: Record<string, unknown> = { ...initial };
    const storage: CacheStorage & { data: Record<string, unknown>; get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> } = {
        data,
        get: vi.fn(async (key: string) => ({ [key]: data[key] })),
        set: vi.fn(async (items: Record<string, unknown>) => {
            Object.assign(data, items);
        }),
    };
    return storage;
}

const value = (title: string): CachedResolution => ({ title, platform: 'generic', source: 'backend' });

describe('createCache', () => {
    let t: number;
    const now = () => t;

    beforeEach(() => {
        t = 1_000_000;
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('misses, then hits after set, and marks negative entries', async () => {
        const cache = createCache({ now });
        await cache.ready;
        expect(cache.get('a')).toBeUndefined();
        cache.set('a', value('A'));
        expect(cache.get('a')).toEqual({ kind: 'hit', value: value('A') });
        cache.setNegative('b');
        expect(cache.get('b')).toEqual({ kind: 'negative' });
        expect(cache.size).toBe(2);
    });

    it('expires hits after 24 h and negatives after 1 h', () => {
        const cache = createCache({ now });
        cache.set('a', value('A'));
        cache.setNegative('b');
        t += HOUR - 1;
        expect(cache.get('a')?.kind).toBe('hit');
        expect(cache.get('b')?.kind).toBe('negative');
        t += 1;
        expect(cache.get('b')).toBeUndefined();
        expect(cache.get('a')?.kind).toBe('hit');
        t = 1_000_000 + DAY;
        expect(cache.get('a')).toBeUndefined();
        expect(cache.size).toBe(0);
    });

    it('evicts the oldest-inserted entry beyond maxEntries; re-setting a key makes it newest', () => {
        const cache = createCache({ now, maxEntries: 3 });
        cache.set('a', value('A'));
        cache.set('b', value('B'));
        cache.set('c', value('C'));
        cache.set('a', value('A2')); // a is now the newest
        cache.set('d', value('D')); // evicts b
        expect(cache.get('b')).toBeUndefined();
        expect(cache.get('a')?.kind).toBe('hit');
        expect(cache.get('c')?.kind).toBe('hit');
        expect(cache.get('d')?.kind).toBe('hit');
        expect(cache.size).toBe(3);
    });

    it('writes to L2 once, debounced, under a single key', async () => {
        const storage = fakeStorage();
        const cache = createCache({ storage, now, debounceMs: 500 });
        await cache.ready;
        cache.set('a', value('A'));
        cache.set('b', value('B'));
        cache.setNegative('c');
        expect(storage.set).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(499);
        expect(storage.set).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(storage.set).toHaveBeenCalledTimes(1);
        const blob = storage.data[CACHE_STORAGE_KEY] as { v: number; entries: unknown[] };
        expect(blob.v).toBe(1);
        expect(blob.entries).toEqual([
            ['a', value('A'), t + DAY],
            ['b', value('B'), t + DAY],
            ['c', null, t + HOUR],
        ]);
    });

    it('loads L2 on creation, skipping expired and malformed entries', async () => {
        const storage = fakeStorage({
            [CACHE_STORAGE_KEY]: {
                v: 1,
                entries: [
                    ['fresh', value('Fresh'), t + HOUR],
                    ['stale', value('Stale'), t - 1],
                    ['neg', null, t + HOUR],
                    ['bad-shape', { title: 5 }, t + HOUR],
                    ['bad-source', { title: 'T', platform: 'x', source: 'cache' }, t + HOUR],
                    ['no-expiry', value('X')],
                    'garbage',
                ],
            },
        });
        const cache = createCache({ storage, now });
        await cache.ready;
        expect(cache.get('fresh')).toEqual({ kind: 'hit', value: value('Fresh') });
        expect(cache.get('neg')).toEqual({ kind: 'negative' });
        expect(cache.get('stale')).toBeUndefined();
        expect(cache.get('bad-shape')).toBeUndefined();
        expect(cache.get('bad-source')).toBeUndefined();
        expect(cache.get('no-expiry')).toBeUndefined();
        expect(cache.size).toBe(2);
    });

    it('ignores an L2 blob of the wrong version or shape', async () => {
        for (const blob of [undefined, null, 'x', { v: 2, entries: [] }, { v: 1, entries: 'nope' }]) {
            const cache = createCache({ storage: fakeStorage({ [CACHE_STORAGE_KEY]: blob }), now });
            await cache.ready;
            expect(cache.size).toBe(0);
        }
    });

    it('keeps working in memory when L2 reads or writes fail', async () => {
        const storage: CacheStorage = {
            get: async () => {
                throw new Error('no session storage');
            },
            set: async () => {
                throw new Error('quota');
            },
        };
        const cache = createCache({ storage, now, debounceMs: 10 });
        await cache.ready;
        cache.set('a', value('A'));
        await vi.advanceTimersByTimeAsync(20);
        await cache.flush();
        expect(cache.get('a')?.kind).toBe('hit');
    });

    it('flush writes pending changes immediately and drops expired entries from the blob', async () => {
        const storage = fakeStorage();
        const cache = createCache({ storage, now });
        await cache.ready;
        cache.set('a', value('A'));
        cache.setNegative('b');
        t += 2 * HOUR;
        await cache.flush();
        expect(storage.set).toHaveBeenCalledTimes(1);
        const blob = storage.data[CACHE_STORAGE_KEY] as { entries: unknown[] };
        expect(blob.entries).toEqual([['a', value('A'), t - 2 * HOUR + DAY]]);
        await vi.advanceTimersByTimeAsync(1000);
        expect(storage.set).toHaveBeenCalledTimes(1); // the debounced write was cancelled by flush
    });

    it('is ready immediately without L2', async () => {
        const cache = createCache();
        await expect(cache.ready).resolves.toBeUndefined();
        await expect(cache.flush()).resolves.toBeUndefined();
    });
});
