import { describe, expect, it, vi } from 'vitest';
import { BACKEND_CHUNK_SIZE, resolveViaBackend } from './backend';

const API_URL = 'https://api.test.example/resolve';

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function sentUrls(fetchFn: { mock: { calls: unknown[][] } }): string[][] {
    return fetchFn.mock.calls.map(([, init]) => (JSON.parse(String((init as RequestInit).body)) as { urls: string[] }).urls);
}

describe('resolveViaBackend', () => {
    it('posts JSON with no cookies, no referrer, no HTTP cache, and a timeout', async () => {
        const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
            const { urls } = JSON.parse(String(init?.body)) as { urls: string[] };
            return json({ titles: Object.fromEntries(urls.map((u) => [u, `Title for ${u}`])) });
        });
        const out = await resolveViaBackend(['https://a.example/'], { apiUrl: API_URL, fetchFn });
        const [url, init] = fetchFn.mock.calls[0];
        expect(url).toBe(API_URL);
        expect(init).toMatchObject({ method: 'POST', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
        expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
        expect(init?.signal === undefined || init?.signal instanceof AbortSignal).toBe(true);
        expect(out.resolved.get('https://a.example/')).toEqual({ title: 'Title for https://a.example/', description: undefined, platform: 'generic', finalUrl: undefined });
        expect(out.failed.size).toBe(0);
    });

    it('chunks 60 URLs into 25/25/10 sequential requests', async () => {
        const urls = Array.from({ length: 60 }, (_, i) => `https://a.example/${i}`);
        const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body)) as { urls: string[] };
            return json({ titles: Object.fromEntries(body.urls.map((u) => [u, 'T'])) });
        });
        const out = await resolveViaBackend(urls, { apiUrl: API_URL, fetchFn });
        expect(sentUrls(fetchFn).map((c) => c.length)).toEqual([BACKEND_CHUNK_SIZE, BACKEND_CHUNK_SIZE, 10]);
        expect(out.resolved.size).toBe(60);
    });

    it('passes platform, description and finalUrl through from details', async () => {
        const fetchFn = vi.fn(async () => json({
            titles: { 'https://bit.ly/x': 'Landing' },
            details: { 'https://bit.ly/x': { platform: 'Generic', description: 'D', finalUrl: 'https://example.org/landing' } },
        }));
        const out = await resolveViaBackend(['https://bit.ly/x'], { apiUrl: API_URL, fetchFn });
        expect(out.resolved.get('https://bit.ly/x')).toEqual({ title: 'Landing', description: 'D', platform: 'Generic', finalUrl: 'https://example.org/landing' });
    });

    it('distinguishes "no title" from a failed request', async () => {
        const fetchFn = vi.fn(async () => json({ titles: { 'https://a.example/': 'A' } }));
        const out = await resolveViaBackend(['https://a.example/', 'https://b.example/'], { apiUrl: API_URL, fetchFn });
        expect(out.resolved.has('https://b.example/')).toBe(false);
        expect(out.failed.has('https://b.example/')).toBe(false);
    });

    it.each<[string, () => Promise<Response>]>([
        ['a non-2xx status', async () => json({ error: 'x' }, 503)],
        ['a malformed body', async () => json({ titles: 'nope' })],
        ['a non-JSON body', async () => new Response('<html>', { status: 200 })],
        ['a network error', async () => {
            throw new TypeError('Failed to fetch');
        }],
    ])('marks the whole chunk failed on %s and continues with the next chunk', async (_name, reply) => {
        let call = 0;
        const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
            call++;
            if (call === 1) return reply();
            const body = JSON.parse(String(init?.body)) as { urls: string[] };
            return json({ titles: Object.fromEntries(body.urls.map((u) => [u, 'T'])) });
        });
        const urls = Array.from({ length: 30 }, (_, i) => `https://a.example/${i}`);
        const out = await resolveViaBackend(urls, { apiUrl: API_URL, fetchFn });
        expect(fetchFn).toHaveBeenCalledTimes(2);
        expect(out.failed.size).toBe(25);
        expect(out.resolved.size).toBe(5);
    });
});
