/**
 * The router policy: mode × trigger × tier, sensitive page hosts, high entropy,
 * backoff, concurrency, caching. Real resolvers, fake network.
 */
import { describe, expect, it } from 'vitest';
import youtubeFixture from '../resolvers/__fixtures__/youtube.json';
import vimeoFixture from '../resolvers/__fixtures__/vimeo.json';
import { FetchFn } from '../resolvers/types';
import { createCache, ResolutionCache } from '../utils/cache';
import { DEFAULT_SETTINGS, MODE_PRESETS, Settings } from '../utils/settings';
import { BACKOFF_MS, createLimiter, createRouter, MAX_IN_FLIGHT, MAX_IN_FLIGHT_PER_HOST } from './router';

const PAGE = 'news.example.org';
const YT = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const ARTICLE = 'https://example.org/blog/2026/post';
const WIKI = 'https://en.wikipedia.org/wiki/Alan_Turing';

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

type Reply = (url: string, init?: RequestInit) => Response | Promise<Response>;

/** A fake network keyed by host; unknown hosts fail loudly. */
function network(handlers: Record<string, Reply> = {}) {
    const calls: { url: string; init?: RequestInit }[] = [];
    const backendTitles = (init?: RequestInit) => {
        const { urls } = JSON.parse(String(init?.body)) as { urls: string[] };
        return json({ titles: Object.fromEntries(urls.map((u) => [u, `Title for ${u}`])) });
    };
    const defaults: Record<string, Reply> = {
        'www.youtube.com': () => json(youtubeFixture),
        'vimeo.com': () => json(vimeoFixture),
        [new URL(DEFAULT_SETTINGS.apiUrl).host]: (_url, init) => backendTitles(init),
    };
    const fetchFn: FetchFn = async (url, init) => {
        calls.push({ url, init });
        const handler = { ...defaults, ...handlers }[new URL(url).host];
        if (!handler) throw new Error(`unexpected host: ${url}`);
        return handler(url, init);
    };
    const hosts = () => calls.map((c) => new URL(c.url).host);
    const posted = () => calls.filter((c) => c.init?.method === 'POST').map((c) => (JSON.parse(String(c.init?.body)) as { urls: string[] }).urls);
    return { fetchFn, calls, hosts, posted };
}

function make(settings: Partial<Settings> = {}, handlers: Record<string, Reply> = {}, extra: { cache?: ResolutionCache; now?: () => number } = {}) {
    const net = network(handlers);
    const cache = extra.cache ?? createCache({ now: extra.now });
    const router = createRouter({ fetchFn: net.fetchFn, cache, getSettings: () => ({ ...DEFAULT_SETTINGS, ...settings }), now: extra.now });
    return { router, net, cache };
}

describe('router: guards before any tier', () => {
    it('answers none for URLs classifyUrl skips, without touching the cache or network', async () => {
        const { router, net, cache } = make(MODE_PRESETS.everything);
        const results = await router.resolve(['https://accounts.example.org/reset?token=abc', 'http://192.168.1.1/', 'javascript:alert(1)'], 'hover', PAGE);
        expect(Object.values(results)).toEqual([{ status: 'none' }, { status: 'none' }, { status: 'none' }]);
        expect(net.calls).toHaveLength(0);
        expect(cache.size).toBe(0);
    });

    it('serves cache hits with source cache, and negative entries as none', async () => {
        const cache = createCache();
        cache.set('https://example.org/cached', { title: 'Cached', platform: 'generic', source: 'backend' });
        cache.setNegative('https://example.org/known-miss');
        const { router, net } = make(MODE_PRESETS.everything, {}, { cache });
        const results = await router.resolve(['https://example.org/cached#frag', 'https://example.org/known-miss?utm_source=x'], 'auto', PAGE);
        expect(results['https://example.org/cached#frag']).toEqual({ status: 'resolved', title: 'Cached', platform: 'generic', source: 'cache' });
        expect(results['https://example.org/known-miss?utm_source=x']).toEqual({ status: 'none' });
        expect(net.calls).toHaveLength(0);
    });

    it('answers each requested URL once, deduplicating repeats', async () => {
        const { router, net } = make();
        const results = await router.resolve([YT, YT], 'auto', PAGE);
        expect(Object.keys(results)).toEqual([YT]);
        expect(net.calls).toHaveLength(1);
    });
});

describe('router: Tier 0', () => {
    it('resolves locally in every mode with zero network, and caches', async () => {
        for (const preset of Object.values(MODE_PRESETS)) {
            const { router, net, cache } = make(preset);
            const first = await router.resolve([WIKI, 'https://github.com/o/r/issues/1'], 'auto', PAGE);
            expect(first[WIKI]).toEqual({ status: 'resolved', title: 'Alan Turing', description: 'en.wikipedia.org', platform: 'wikipedia', source: 'local' });
            expect(first['https://github.com/o/r/issues/1']).toMatchObject({ status: 'resolved', title: 'o/r issue #1', platform: 'github', source: 'local' });
            expect(net.calls).toHaveLength(0);
            expect(cache.size).toBe(2);
            const again = await router.resolve([WIKI], 'auto', PAGE);
            expect(again[WIKI]).toMatchObject({ source: 'cache' });
        }
    });
});

describe('router: Tier A', () => {
    it('fetches the platform automatically when platformMode is auto', async () => {
        const { router, net } = make({ platformMode: 'auto' });
        const results = await router.resolve([YT], 'auto', PAGE);
        expect(results[YT]).toEqual({
            status: 'resolved',
            title: 'Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)',
            description: 'Rick Astley',
            platform: 'youtube',
            source: 'platform',
        });
        expect(net.hosts()).toEqual(['www.youtube.com']);
        expect(net.calls[0].init).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
    });

    it('defers to hover when platformMode is hover, and fetches on the hover trigger', async () => {
        const { router, net } = make({ platformMode: 'hover' });
        expect((await router.resolve([YT], 'auto', PAGE))[YT]).toEqual({ status: 'hover' });
        expect(net.calls).toHaveLength(0);
        expect((await router.resolve([YT], 'hover', PAGE))[YT]).toMatchObject({ status: 'resolved', source: 'platform' });
        expect(net.hosts()).toEqual(['www.youtube.com']);
    });

    it('caches platform answers for later calls', async () => {
        const { router, net } = make();
        await router.resolve([YT], 'auto', PAGE);
        const second = await router.resolve(['https://youtu.be/dQw4w9WgXcQ'], 'auto', PAGE);
        expect(second['https://youtu.be/dQw4w9WgXcQ']).toMatchObject({ status: 'resolved', source: 'platform' }); // a different key
        expect((await router.resolve([YT], 'auto', PAGE))[YT]).toMatchObject({ source: 'cache' });
        expect(net.calls).toHaveLength(2);
    });

    it('remembers a definitive 4xx as a negative entry for an hour', async () => {
        let t = 0;
        const { router, net } = make({}, { 'www.youtube.com': () => json({}, 404) }, { now: () => t });
        expect((await router.resolve([YT], 'auto', PAGE))[YT]).toEqual({ status: 'none' });
        expect((await router.resolve([YT], 'auto', PAGE))[YT]).toEqual({ status: 'none' });
        expect(net.calls).toHaveLength(1);
        t += 60 * 60 * 1000;
        await router.resolve([YT], 'auto', PAGE);
        expect(net.calls).toHaveLength(2);
    });

    it('backs off a host for 10 minutes after 429 or 5xx, without caching the miss', async () => {
        for (const status of [429, 503]) {
            let t = 0;
            const { router, net } = make({}, { 'www.youtube.com': () => json({}, status) }, { now: () => t });
            expect((await router.resolve([YT], 'auto', PAGE))[YT]).toEqual({ status: 'none' });
            expect((await router.resolve(['https://youtu.be/dQw4w9WgXcQ'], 'hover', PAGE))['https://youtu.be/dQw4w9WgXcQ']).toEqual({ status: 'none' });
            expect(net.calls, `status ${status}`).toHaveLength(1);
            t += BACKOFF_MS;
            await router.resolve([YT], 'auto', PAGE);
            expect(net.calls).toHaveLength(2);
        }
    });

    it('backoff is per host: vimeo still resolves while youtube backs off', async () => {
        const { router, net } = make({}, { 'www.youtube.com': () => json({}, 500) });
        await router.resolve([YT], 'auto', PAGE);
        const results = await router.resolve([YT, 'https://vimeo.com/1084537'], 'auto', PAGE);
        expect(results['https://vimeo.com/1084537']).toMatchObject({ status: 'resolved', title: 'Big Buck Bunny' });
        expect(net.hosts()).toEqual(['www.youtube.com', 'vimeo.com']);
    });

    it('does not cache network failures, so the next call tries again', async () => {
        const { router, net } = make({}, {
            'www.youtube.com': () => {
                throw new TypeError('Failed to fetch');
            },
        });
        expect((await router.resolve([YT], 'auto', PAGE))[YT]).toEqual({ status: 'none' });
        await router.resolve([YT], 'auto', PAGE);
        expect(net.calls).toHaveLength(2);
    });

    it('drops platform titles that sanitize to nothing or look like URLs', async () => {
        const { router } = make({}, { 'www.youtube.com': () => json({ title: 'https://paypal.com/login', author_name: 'x' }) });
        expect((await router.resolve([YT], 'auto', PAGE))[YT]).toEqual({ status: 'none' });
    });

    it('sanitizes titles and descriptions before caching or returning', async () => {
        const { router, cache } = make({}, { 'www.youtube.com': () => json({ title: 'gpj.‮exe', author_name: 'Desc​ here' }) });
        const outcome = (await router.resolve([YT], 'auto', PAGE))[YT];
        expect(outcome).toMatchObject({ title: 'gpj.exe', description: 'Desc here' });
        expect(cache.get(YT)).toMatchObject({ kind: 'hit', value: { title: 'gpj.exe', description: 'Desc here' } });
    });

    it('limits in-flight platform requests to 4 per host and 8 overall', async () => {
        let inFlight = 0;
        let maxInFlight = 0;
        const perHost = new Map<string, number>();
        let maxPerHost = 0;
        const gates: (() => void)[] = [];
        const slow: Reply = async (url) => {
            const host = new URL(url).host;
            inFlight++;
            perHost.set(host, (perHost.get(host) ?? 0) + 1);
            maxInFlight = Math.max(maxInFlight, inFlight);
            maxPerHost = Math.max(maxPerHost, perHost.get(host)!);
            await new Promise<void>((r) => gates.push(r));
            inFlight--;
            perHost.set(host, perHost.get(host)! - 1);
            return json(host === 'vimeo.com' ? vimeoFixture : youtubeFixture);
        };
        const { router, net } = make({}, { 'www.youtube.com': slow, 'vimeo.com': slow });
        const urls = [
            ...Array.from({ length: 10 }, (_, i) => `https://www.youtube.com/watch?v=dQw4w9WgXc${String.fromCharCode(65 + i)}`),
            ...Array.from({ length: 10 }, (_, i) => `https://vimeo.com/${1000 + i}`),
        ];
        let done = false;
        const run = router.resolve(urls, 'auto', PAGE).then((r) => {
            done = true;
            return r;
        });
        for (let i = 0; i < 200 && !done; i++) {
            await new Promise((r) => setTimeout(r, 0));
            gates.splice(0).forEach((open) => open());
        }
        const results = await run;
        expect(net.calls).toHaveLength(20);
        expect(Object.values(results).every((o) => o.status === 'resolved')).toBe(true);
        expect(maxPerHost).toBe(MAX_IN_FLIGHT_PER_HOST);
        expect(maxInFlight).toBe(MAX_IN_FLIGHT);
    });
});

describe('router: Tier B', () => {
    it('Balanced (default): generic links wait for hover, then go to our server once', async () => {
        const { router, net } = make();
        expect((await router.resolve([ARTICLE], 'auto', PAGE))[ARTICLE]).toEqual({ status: 'hover' });
        expect(net.calls).toHaveLength(0);
        expect((await router.resolve([ARTICLE], 'hover', PAGE))[ARTICLE]).toEqual({ status: 'resolved', title: `Title for ${ARTICLE}`, platform: 'generic', source: 'backend' });
        expect(net.hosts()).toEqual([new URL(DEFAULT_SETTINGS.apiUrl).host]);
    });

    it('Private: generic links are never sent, hover or not', async () => {
        const { router, net } = make(MODE_PRESETS.private);
        expect((await router.resolve([ARTICLE], 'auto', PAGE))[ARTICLE]).toEqual({ status: 'none' });
        expect((await router.resolve([ARTICLE], 'hover', PAGE))[ARTICLE]).toEqual({ status: 'none' });
        expect(net.calls).toHaveLength(0);
    });

    it('Everything: generic links go to our server automatically', async () => {
        const { router, net } = make(MODE_PRESETS.everything);
        expect((await router.resolve([ARTICLE], 'auto', PAGE))[ARTICLE]).toMatchObject({ status: 'resolved', source: 'backend' });
        expect(net.posted()).toEqual([[ARTICLE]]);
    });

    it('Everything on a sensitive page host waits for hover; hover then sends', async () => {
        for (const host of ['mail.google.com', 'acme.slack.com', 'outlook.office.com', 'docs.google.com']) {
            const { router, net } = make(MODE_PRESETS.everything);
            expect((await router.resolve([ARTICLE], 'auto', host))[ARTICLE], host).toEqual({ status: 'hover' });
            expect(net.calls, host).toHaveLength(0);
            expect((await router.resolve([ARTICLE], 'hover', host))[ARTICLE], host).toMatchObject({ status: 'resolved' });
            expect(net.calls, host).toHaveLength(1);
        }
    });

    it('a sensitive page host does not affect Tier A', async () => {
        const { router, net } = make(MODE_PRESETS.everything);
        expect((await router.resolve([YT], 'auto', 'mail.google.com'))[YT]).toMatchObject({ status: 'resolved', source: 'platform' });
        expect(net.hosts()).toEqual(['www.youtube.com']);
    });

    it('high-entropy URLs never reach our server, even on hover in Everything mode', async () => {
        const { router, net } = make(MODE_PRESETS.everything);
        const urls = [
            'https://example.org/share/4f9c2a1b7e3d4c5a9b8f7e6d5c4b3a2f',
            'https://docs.example.org/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit',
        ];
        for (const trigger of ['auto', 'hover'] as const) {
            const results = await router.resolve(urls, trigger, PAGE);
            expect(Object.values(results)).toEqual([{ status: 'none' }, { status: 'none' }]);
        }
        expect(net.calls).toHaveLength(0);
    });

    it('sends the stripped form: no fragment, no tracking parameters; one request per distinct key', async () => {
        const { router, net } = make(MODE_PRESETS.everything);
        const a = 'https://example.org/read?utm_source=nl&id=7&fbclid=x#top';
        const b = 'https://example.org/read?id=7&utm_source=other';
        const results = await router.resolve([a, b], 'auto', PAGE);
        expect(net.posted()).toEqual([['https://example.org/read?id=7']]);
        expect(results[a]).toMatchObject({ status: 'resolved', title: 'Title for https://example.org/read?id=7' });
        expect(results[b]).toEqual(results[a]);
    });

    it('batches 25 per POST', async () => {
        const { router, net } = make(MODE_PRESETS.everything);
        const urls = Array.from({ length: 30 }, (_, i) => `https://example.org/p/${i}`);
        const results = await router.resolve(urls, 'auto', PAGE);
        expect(net.posted().map((c) => c.length)).toEqual([25, 5]);
        expect(Object.keys(results)).toHaveLength(30);
    });

    it('remembers "no title" as a negative entry, but not a failed request', async () => {
        const backendHost = new URL(DEFAULT_SETTINGS.apiUrl).host;
        const empty = make(MODE_PRESETS.everything, { [backendHost]: () => json({ titles: {} }) });
        expect((await empty.router.resolve([ARTICLE], 'auto', PAGE))[ARTICLE]).toEqual({ status: 'none' });
        expect(empty.cache.get(ARTICLE)).toEqual({ kind: 'negative' });

        const down = make(MODE_PRESETS.everything, {
            [backendHost]: () => {
                throw new TypeError('Failed to fetch');
            },
        });
        expect((await down.router.resolve([ARTICLE], 'auto', PAGE))[ARTICLE]).toEqual({ status: 'none' });
        expect(down.cache.get(ARTICLE)).toBeUndefined();
    });

    it('returns finalUrl for unshortened links and drops finalUrl values that are not http(s)', async () => {
        const backendHost = new URL(DEFAULT_SETTINGS.apiUrl).host;
        const { router } = make(MODE_PRESETS.everything, {
            [backendHost]: () => json({
                titles: { 'https://bit.ly/ok': 'Landing', 'https://bit.ly/bad': 'Odd' },
                details: {
                    'https://bit.ly/ok': { platform: 'Generic', finalUrl: 'https://example.org/landing' },
                    'https://bit.ly/bad': { platform: 'Generic', finalUrl: 'javascript:alert(1)' },
                },
            }),
        });
        const results = await router.resolve(['https://bit.ly/ok', 'https://bit.ly/bad'], 'auto', PAGE);
        expect(results['https://bit.ly/ok']).toEqual({ status: 'resolved', title: 'Landing', platform: 'generic', source: 'backend', finalUrl: 'https://example.org/landing' });
        expect(results['https://bit.ly/bad']).toEqual({ status: 'resolved', title: 'Odd', platform: 'generic', source: 'backend' });
    });

    it('uses the configured apiUrl', async () => {
        const { router, net } = make({ ...MODE_PRESETS.everything, apiUrl: 'http://localhost:8080/resolve' }, {
            'localhost:8080': (_url, init) => {
                const { urls } = JSON.parse(String(init?.body)) as { urls: string[] };
                return json({ titles: Object.fromEntries(urls.map((u) => [u, 'Local'])) });
            },
        });
        expect((await router.resolve([ARTICLE], 'auto', PAGE))[ARTICLE]).toMatchObject({ title: 'Local' });
        expect(net.calls[0].url).toBe('http://localhost:8080/resolve');
    });

    it('waits for the cache to load before answering', async () => {
        let release: () => void = () => undefined;
        const storage = {
            get: () => new Promise<Record<string, unknown>>((r) => {
                release = () => r({ 'll-cache-v1': { v: 1, entries: [[ARTICLE, { title: 'From L2', platform: 'generic', source: 'backend' }, Date.now() + 1000]] } });
            }),
            set: async () => undefined,
        };
        const cache = createCache({ storage });
        const { router, net } = make(MODE_PRESETS.everything, {}, { cache });
        const pending = router.resolve([ARTICLE], 'auto', PAGE);
        await new Promise((r) => setTimeout(r, 0));
        release();
        expect((await pending)[ARTICLE]).toMatchObject({ title: 'From L2', source: 'cache' });
        expect(net.calls).toHaveLength(0);
    });
});

describe('createLimiter', () => {
    it('grants slots in FIFO order once capacity frees up', async () => {
        const limiter = createLimiter(1, 2);
        const order: string[] = [];
        await limiter.acquire('a');
        await limiter.acquire('b');
        const c = limiter.acquire('a').then(() => order.push('a2'));
        const d = limiter.acquire('c').then(() => order.push('c1'));
        await new Promise((r) => setTimeout(r, 0));
        expect(order).toEqual([]);
        limiter.release('b'); // frees a global slot; 'a' is still at its per-host cap, so 'c' goes first
        await d;
        expect(order).toEqual(['c1']);
        limiter.release('a');
        await c;
        expect(order).toEqual(['c1', 'a2']);
    });
});
