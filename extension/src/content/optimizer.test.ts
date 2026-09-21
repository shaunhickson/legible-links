import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LinkOptimizer, CHUNK_SIZE, MAX_ATTEMPTS, parseResolveResponse } from './optimizer';
import { DEFAULT_SETTINGS, Settings } from '../utils/settings';

const API_URL = 'https://api.test.example/resolve';

const settings: Settings = { ...DEFAULT_SETTINGS, apiUrl: API_URL };

function makeAnchor(href: string, text = href, parent: Element = document.body): HTMLAnchorElement {
    const a = document.createElement('a');
    a.setAttribute('href', href);
    a.textContent = text;
    parent.appendChild(a);
    return a;
}

type Handler = (urls: string[]) => unknown;

function fakeFetch(handler: Handler) {
    return vi.fn(async (_input: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { urls: string[] };
        const payload = handler(body.urls);
        return { ok: true, status: 200, json: async () => payload } as unknown as Response;
    });
}

function sentUrls(fetchFn: ReturnType<typeof fakeFetch>): string[][] {
    return fetchFn.mock.calls.map(([, init]) => (JSON.parse(String(init?.body)) as { urls: string[] }).urls);
}

function titlesFor(urls: string[], title = (u: string) => `Title for ${u}`) {
    const titles: Record<string, string> = {};
    for (const u of urls) titles[u] = title(u);
    return { titles };
}

const ui = { show: vi.fn(), hide: vi.fn() };

async function run(fetchFn: ReturnType<typeof fakeFetch>) {
    const optimizer = new LinkOptimizer({ fetchFn, loadSettings: async () => settings, ui, batchDelayMs: 0 });
    await optimizer.start();
    await optimizer.flush();
    optimizer.stop();
    return optimizer;
}

describe('LinkOptimizer', () => {
    beforeEach(() => {
        document.body.replaceChildren();
        vi.clearAllMocks();
    });

    it('renders every anchor that shares a URL', async () => {
        const href = 'https://www.example.com/article';
        const a1 = makeAnchor(href);
        const a2 = makeAnchor(href);
        const fetchFn = fakeFetch((urls) => titlesFor(urls, () => 'Shared Title'));

        await run(fetchFn);

        expect(fetchFn).toHaveBeenCalledTimes(1);
        expect(sentUrls(fetchFn)[0]).toEqual([href]);
        for (const a of [a1, a2]) {
            expect(a.classList.contains('ll-resolved')).toBe(true);
            expect(a.querySelector('.ll-title')?.textContent).toBe('Shared Title');
            expect(a.querySelector('.ll-domain')?.textContent).toBe(' · www.example.com');
            expect(a.getAttribute('href')).toBe(href);
            expect(a.getAttribute('title')).toBe(href);
        }
    });

    it('chunks 60 URLs into 25/25/10 sequential requests', async () => {
        const anchors: HTMLAnchorElement[] = [];
        for (let i = 0; i < 60; i++) anchors.push(makeAnchor(`https://example.com/page/${i}`));
        const fetchFn = fakeFetch((urls) => titlesFor(urls));

        await run(fetchFn);

        expect(fetchFn).toHaveBeenCalledTimes(3);
        expect(sentUrls(fetchFn).map((u) => u.length)).toEqual([CHUNK_SIZE, CHUNK_SIZE, 10]);
        expect(anchors.every((a) => a.classList.contains('ll-resolved'))).toBe(true);
    });

    it('never sends anchors inside editable areas', async () => {
        const editor = document.createElement('div');
        editor.setAttribute('contenteditable', 'true');
        document.body.appendChild(editor);
        const inside = makeAnchor('https://example.com/draft', undefined, editor);
        const outside = makeAnchor('https://example.com/public');
        const fetchFn = fakeFetch((urls) => titlesFor(urls));

        await run(fetchFn);

        expect(sentUrls(fetchFn).flat()).toEqual(['https://example.com/public']);
        expect(inside.textContent).toBe('https://example.com/draft');
        expect(inside.classList.contains('ll-resolved')).toBe(false);
        expect(outside.classList.contains('ll-resolved')).toBe(true);
    });

    it('never sends anchors whose text names a different host than the href', async () => {
        const a = makeAnchor('https://evil.example.net/login', 'https://paypal.com/account');
        const fetchFn = fakeFetch((urls) => titlesFor(urls));

        await run(fetchFn);

        expect(fetchFn).not.toHaveBeenCalled();
        expect(a.textContent).toBe('https://paypal.com/account');
    });

    it('never sends sensitive-looking URLs', async () => {
        const token = makeAnchor('https://accounts.example.com/reset?token=abc');
        const local = makeAnchor('http://localhost:3000/dev');
        const ip = makeAnchor('http://10.0.0.5/admin');
        const fetchFn = fakeFetch((urls) => titlesFor(urls));

        await run(fetchFn);

        expect(fetchFn).not.toHaveBeenCalled();
        for (const a of [token, local, ip]) expect(a.classList.contains('ll-resolved')).toBe(false);
    });

    it('skips non-http(s) hrefs and anchors whose text is not a raw URL', async () => {
        makeAnchor('javascript:alert(1)', 'https://example.com/');
        makeAnchor('mailto:a@example.com', 'https://example.com/');
        makeAnchor('https://example.com/', 'Read more');
        const fetchFn = fakeFetch((urls) => titlesFor(urls));

        await run(fetchFn);

        expect(fetchFn).not.toHaveBeenCalled();
    });

    it('renders a hostile title as inert text', async () => {
        const a = makeAnchor('https://example.com/x');
        const payload = '<img src=x onerror="window.__pwned=1">';
        const fetchFn = fakeFetch((urls) => titlesFor(urls, () => payload));

        await run(fetchFn);

        expect(a.querySelector('img')).toBeNull();
        expect(a.querySelector('.ll-title')?.textContent).toBe(payload);
        expect((window as unknown as { __pwned?: unknown }).__pwned).toBeUndefined();
    });

    it('drops titles that are empty after sanitizing or look like URLs', async () => {
        const url1 = makeAnchor('https://example.com/a');
        const empty = makeAnchor('https://example.com/b');
        const fetchFn = fakeFetch(() => ({
            titles: {
                'https://example.com/a': 'https://elsewhere.example/',
                'https://example.com/b': '\u{200B}\u{202E}',
            },
        }));

        await run(fetchFn);

        expect(url1.classList.contains('ll-resolved')).toBe(false);
        expect(empty.classList.contains('ll-resolved')).toBe(false);
    });

    it('ignores malformed responses', async () => {
        const a = makeAnchor('https://example.com/a');
        const fetchFn = fakeFetch((urls) => ({ titles: [urls[0]] }));

        await run(fetchFn);

        expect(a.classList.contains('ll-resolved')).toBe(false);
        expect(parseResolveResponse(null)).toBeNull();
        expect(parseResolveResponse({ titles: 'x' })).toBeNull();
        expect(parseResolveResponse({ titles: { a: 1, b: 'ok' } })?.titles.get('b')).toBe('ok');
        expect(parseResolveResponse({ titles: { a: 1, b: 'ok' } })?.titles.has('a')).toBe(false);
    });

    it('leaves anchors untouched when fetch rejects', async () => {
        const a = makeAnchor('https://example.com/a');
        const b = makeAnchor('https://example.com/b');
        const fetchFn = vi.fn(async () => {
            throw new Error('network down');
        });

        await run(fetchFn as unknown as ReturnType<typeof fakeFetch>);

        expect(fetchFn).toHaveBeenCalledTimes(1);
        for (const anchor of [a, b]) {
            expect(anchor.textContent).toBe(anchor.getAttribute('href'));
            expect(anchor.children.length).toBe(0);
            expect(anchor.hasAttribute('title')).toBe(false);
            expect(anchor.classList.contains('ll-resolved')).toBe(false);
        }
    });

    it('leaves anchors untouched on a non-2xx response', async () => {
        const a = makeAnchor('https://example.com/a');
        const fetchFn = vi.fn(async () => ({ ok: false, status: 413, json: async () => ({}) }) as unknown as Response);

        await run(fetchFn as unknown as ReturnType<typeof fakeFetch>);

        expect(a.classList.contains('ll-resolved')).toBe(false);
    });

    it('stops retrying an anchor after MAX_ATTEMPTS failures', async () => {
        const a = makeAnchor('https://example.com/a');
        const fetchFn = vi.fn(async () => {
            throw new Error('down');
        });
        const optimizer = new LinkOptimizer({
            fetchFn: fetchFn as unknown as ReturnType<typeof fakeFetch>,
            loadSettings: async () => settings,
            ui,
            batchDelayMs: 0,
        });
        await optimizer.start();
        await optimizer.flush();

        // Simulate the anchor being re-added by later mutations.
        for (let i = 0; i < MAX_ATTEMPTS + 2; i++) {
            const parent = a.parentElement as HTMLElement;
            a.remove();
            parent.appendChild(a);
            await new Promise((r) => setTimeout(r, 0));
            await optimizer.flush();
        }
        optimizer.stop();

        expect(fetchFn).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    });

    it('posts to the configured apiUrl with a JSON body and no credentials', async () => {
        makeAnchor('https://example.com/a');
        const fetchFn = fakeFetch((urls) => titlesFor(urls));

        await run(fetchFn);

        const [url, init] = fetchFn.mock.calls[0];
        expect(url).toBe(API_URL);
        expect(init?.method).toBe('POST');
        expect(init?.credentials).toBe('omit');
        expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    });

    it('picks up anchors added after start via the MutationObserver', async () => {
        const fetchFn = fakeFetch((urls) => titlesFor(urls));
        const optimizer = new LinkOptimizer({ fetchFn, loadSettings: async () => settings, ui, batchDelayMs: 0 });
        await optimizer.start();
        const container = document.createElement('div');
        const a = makeAnchor('https://example.com/late', undefined, container);
        document.body.appendChild(container);
        await new Promise((r) => setTimeout(r, 0));
        await optimizer.flush();
        optimizer.stop();

        expect(sentUrls(fetchFn).flat()).toEqual(['https://example.com/late']);
        expect(a.classList.contains('ll-resolved')).toBe(true);
    });

    it('strips fragments before sending and keys rendering by the stripped URL', async () => {
        const a = makeAnchor('https://example.com/doc#section');
        const fetchFn = fakeFetch((urls) => titlesFor(urls));

        await run(fetchFn);

        expect(sentUrls(fetchFn).flat()).toEqual(['https://example.com/doc']);
        expect(a.classList.contains('ll-resolved')).toBe(true);
        expect(a.getAttribute('href')).toBe('https://example.com/doc#section');
    });

    it('shows the tooltip on hover with sanitized details and the original URL', async () => {
        vi.useFakeTimers();
        try {
            const href = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
            const a = makeAnchor(href);
            const fetchFn = fakeFetch(() => ({
                titles: { [href]: 'Never Gonna Give You Up' },
                details: { [href]: { platform: 'YouTube', description: 'Desc\u{202E} here' } },
            }));
            const optimizer = new LinkOptimizer({ fetchFn, loadSettings: async () => settings, ui, batchDelayMs: 0 });
            await optimizer.start();
            await optimizer.flush();
            optimizer.stop();

            a.dispatchEvent(new Event('mouseenter'));
            vi.advanceTimersByTime(600);
            expect(ui.show).toHaveBeenCalledTimes(1);
            const [target, data, theme] = ui.show.mock.calls[0];
            expect(target).toBe(a);
            expect(data).toEqual({
                title: 'Never Gonna Give You Up',
                description: 'Desc here',
                domain: 'www.youtube.com',
                url: href,
                platform: 'youtube',
            });
            expect(theme).toBe('system');
            a.dispatchEvent(new Event('mouseleave'));
            expect(ui.hide).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });
});
