import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CHUNK_SIZE, LinkOptimizer, MAX_ATTEMPTS, ResolveFn } from './optimizer';
import { Outcome, ResolveRequest } from '../shared/protocol';
import { DEFAULT_SETTINGS, Settings } from '../utils/settings';

const settings: Settings = { ...DEFAULT_SETTINGS };

function makeAnchor(href: string, text = href, parent: Element = document.body): HTMLAnchorElement {
    const a = document.createElement('a');
    a.setAttribute('href', href);
    a.textContent = text;
    parent.appendChild(a);
    return a;
}

type Answer = (url: string, trigger: 'auto' | 'hover') => Outcome;

const resolvedWith = (title: string, extra: Partial<Extract<Outcome, { status: 'resolved' }>> = {}): Outcome =>
    ({ status: 'resolved', title, platform: 'generic', source: 'backend', ...extra });

/** A fake worker that answers per URL and records every request. */
function fakeWorker(answer: Answer = (u) => resolvedWith(`Title for ${u}`)) {
    const requests: ResolveRequest[] = [];
    const resolveFn = vi.fn(async (request: ResolveRequest) => {
        requests.push(request);
        const results: Record<string, Outcome> = {};
        for (const url of request.urls) results[url] = answer(url, request.trigger);
        return { results };
    });
    return { resolveFn: resolveFn as unknown as ResolveFn, requests, mock: resolveFn };
}

const ui = { show: vi.fn(), hide: vi.fn() };

function optimizer(resolveFn: ResolveFn, extra: { hoverDelayMs?: number } = {}) {
    return new LinkOptimizer({ resolveFn, loadSettings: async () => settings, ui, batchDelayMs: 0, hoverDelayMs: 0, ...extra });
}

async function run(resolveFn: ResolveFn) {
    const o = optimizer(resolveFn);
    await o.start();
    await o.flush();
    o.stop();
    return o;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('LinkOptimizer', () => {
    beforeEach(() => {
        document.body.replaceChildren();
        vi.clearAllMocks();
    });

    it('renders every anchor that shares a URL from one request', async () => {
        const href = 'https://www.example.com/article';
        const a1 = makeAnchor(href);
        const a2 = makeAnchor(href);
        const worker = fakeWorker(() => resolvedWith('Shared Title'));

        await run(worker.resolveFn);

        expect(worker.requests).toEqual([{ type: 'RESOLVE', urls: [href], trigger: 'auto' }]);
        for (const a of [a1, a2]) {
            expect(a.classList.contains('ll-resolved')).toBe(true);
            expect(a.querySelector('.ll-title')?.textContent).toBe('Shared Title');
            expect(a.querySelector('.ll-domain')?.textContent).toBe(' · www.example.com');
            expect(a.getAttribute('href')).toBe(href);
            expect(a.getAttribute('title')).toBe(href);
        }
    });

    it('sends 60 URLs as 25/25/10 sequential messages', async () => {
        const anchors: HTMLAnchorElement[] = [];
        for (let i = 0; i < 60; i++) anchors.push(makeAnchor(`https://example.com/page/${i}`));
        const worker = fakeWorker();

        await run(worker.resolveFn);

        expect(worker.requests.map((r) => r.urls.length)).toEqual([CHUNK_SIZE, CHUNK_SIZE, 10]);
        expect(anchors.every((a) => a.classList.contains('ll-resolved'))).toBe(true);
    });

    it('never sends anchors inside editable areas', async () => {
        const editor = document.createElement('div');
        editor.setAttribute('contenteditable', 'true');
        document.body.appendChild(editor);
        const inside = makeAnchor('https://example.com/draft', undefined, editor);
        const outside = makeAnchor('https://example.com/public');
        const worker = fakeWorker();

        await run(worker.resolveFn);

        expect(worker.requests.flatMap((r) => r.urls)).toEqual(['https://example.com/public']);
        expect(inside.textContent).toBe('https://example.com/draft');
        expect(inside.classList.contains('ll-resolved')).toBe(false);
        expect(outside.classList.contains('ll-resolved')).toBe(true);
    });

    it('never sends anchors whose text names a different host than the href', async () => {
        const a = makeAnchor('https://evil.example.net/login', 'https://paypal.com/account');
        const worker = fakeWorker();

        await run(worker.resolveFn);

        expect(worker.mock).not.toHaveBeenCalled();
        expect(a.textContent).toBe('https://paypal.com/account');
    });

    it('never sends sensitive-looking URLs', async () => {
        const token = makeAnchor('https://accounts.example.com/reset?token=abc');
        const local = makeAnchor('http://localhost:3000/dev');
        const ip = makeAnchor('http://10.0.0.5/admin');
        const worker = fakeWorker();

        await run(worker.resolveFn);

        expect(worker.mock).not.toHaveBeenCalled();
        for (const a of [token, local, ip]) expect(a.classList.contains('ll-resolved')).toBe(false);
    });

    it('skips non-http(s) hrefs and anchors whose text is not a raw URL', async () => {
        makeAnchor('javascript:alert(1)', 'https://example.com/');
        makeAnchor('mailto:a@example.com', 'https://example.com/');
        makeAnchor('https://example.com/', 'Read more');
        const worker = fakeWorker();

        await run(worker.resolveFn);

        expect(worker.mock).not.toHaveBeenCalled();
    });

    it('renders a hostile title as inert text', async () => {
        const a = makeAnchor('https://example.com/x');
        const payload = '<img src=x onerror="window.__pwned=1">';
        const worker = fakeWorker(() => resolvedWith(payload));

        await run(worker.resolveFn);

        expect(a.querySelector('img')).toBeNull();
        expect(a.querySelector('.ll-title')?.textContent).toBe(payload);
        expect((window as unknown as { __pwned?: unknown }).__pwned).toBeUndefined();
    });

    it('sanitizes again on its side: drops titles that are empty after sanitizing or look like URLs', async () => {
        const url1 = makeAnchor('https://example.com/a');
        const empty = makeAnchor('https://example.com/b');
        const worker = fakeWorker((u) => resolvedWith(u.endsWith('/a') ? 'https://elsewhere.example/' : '\u{200B}\u{202E}'));

        await run(worker.resolveFn);

        expect(url1.classList.contains('ll-resolved')).toBe(false);
        expect(empty.classList.contains('ll-resolved')).toBe(false);
    });

    it('ignores malformed responses and outcomes', async () => {
        const a = makeAnchor('https://example.com/a');
        const b = makeAnchor('https://example.com/b');
        const resolveFn: ResolveFn = async (request) => ({
            results: {
                [request.urls[0]]: { status: 'resolved' }, // missing title: dropped
                [request.urls[1]]: 'resolved',
            },
        });

        await run(resolveFn);

        expect(a.classList.contains('ll-resolved')).toBe(false);
        expect(b.classList.contains('ll-resolved')).toBe(false);

        const c = makeAnchor('https://example.com/c');
        await run(async () => 'not an object');
        expect(c.classList.contains('ll-resolved')).toBe(false);
    });

    it('leaves anchors untouched when the worker does not answer', async () => {
        const a = makeAnchor('https://example.com/a');
        const b = makeAnchor('https://example.com/b');
        const resolveFn = vi.fn(async () => {
            throw new Error('Extension context invalidated');
        });

        await run(resolveFn);

        expect(resolveFn).toHaveBeenCalledTimes(1);
        for (const anchor of [a, b]) {
            expect(anchor.textContent).toBe(anchor.getAttribute('href'));
            expect(anchor.children.length).toBe(0);
            expect(anchor.hasAttribute('title')).toBe(false);
            expect(anchor.classList.contains('ll-resolved')).toBe(false);
        }
        const c = makeAnchor('https://example.com/c');
        await run(async () => undefined);
        expect(c.classList.contains('ll-resolved')).toBe(false);
    });

    it('stops retrying an anchor after MAX_ATTEMPTS failed messages', async () => {
        const a = makeAnchor('https://example.com/a');
        const resolveFn = vi.fn(async () => {
            throw new Error('down');
        });
        const o = optimizer(resolveFn);
        await o.start();
        await o.flush();

        // Simulate the anchor being re-added by later mutations.
        for (let i = 0; i < MAX_ATTEMPTS + 2; i++) {
            const parent = a.parentElement as HTMLElement;
            a.remove();
            parent.appendChild(a);
            await tick();
            await o.flush();
        }
        o.stop();

        expect(resolveFn).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    });

    it('marks anchors done on a none outcome and never asks again', async () => {
        const a = makeAnchor('https://example.com/a');
        const worker = fakeWorker(() => ({ status: 'none' }));
        const o = optimizer(worker.resolveFn);
        await o.start();
        await o.flush();
        const parent = a.parentElement as HTMLElement;
        a.remove();
        parent.appendChild(a);
        await tick();
        await o.flush();
        o.stop();

        expect(worker.mock).toHaveBeenCalledTimes(1);
        expect(a.classList.contains('ll-resolved')).toBe(false);
        expect(a.textContent).toBe('https://example.com/a');
    });

    it('picks up anchors added after start via the MutationObserver', async () => {
        const worker = fakeWorker();
        const o = optimizer(worker.resolveFn);
        await o.start();
        const container = document.createElement('div');
        const a = makeAnchor('https://example.com/late', undefined, container);
        document.body.appendChild(container);
        await tick();
        await o.flush();
        o.stop();

        expect(worker.requests.flatMap((r) => r.urls)).toEqual(['https://example.com/late']);
        expect(a.classList.contains('ll-resolved')).toBe(true);
    });

    it('strips fragments before sending and keys rendering by the stripped URL', async () => {
        const a = makeAnchor('https://example.com/doc#section');
        const worker = fakeWorker();

        await run(worker.resolveFn);

        expect(worker.requests.flatMap((r) => r.urls)).toEqual(['https://example.com/doc']);
        expect(a.classList.contains('ll-resolved')).toBe(true);
        expect(a.getAttribute('href')).toBe('https://example.com/doc#section');
        expect(a.getAttribute('title')).toBe('https://example.com/doc');
    });

    it('renders finalUrl as "final host via original host" and puts both in the title attribute', async () => {
        const a = makeAnchor('https://bit.ly/3abc');
        const worker = fakeWorker(() => resolvedWith('Landing page', { finalUrl: 'https://example.org/landing' }));

        await run(worker.resolveFn);

        expect(a.textContent).toBe('Landing page · example.org via bit.ly');
        expect(a.getAttribute('title')).toBe('https://example.org/landing (via https://bit.ly/3abc)');
        expect(a.getAttribute('href')).toBe('https://bit.ly/3abc');
    });

    it('uses the platform icon the worker names, falling back to generic', async () => {
        const yt = makeAnchor('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
        const odd = makeAnchor('https://example.com/odd');
        const worker = fakeWorker((u) => resolvedWith('T', { platform: u.includes('youtube') ? 'YouTube' : 'constructor' }));

        await run(worker.resolveFn);

        expect(yt.querySelector('svg path')?.getAttribute('d')).not.toBe(odd.querySelector('svg path')?.getAttribute('d'));
    });

    it('shows the tooltip on hover with sanitized details and the original URL', async () => {
        vi.useFakeTimers();
        try {
            const href = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
            const a = makeAnchor(href);
            const worker = fakeWorker(() => resolvedWith('Never Gonna Give You Up', { platform: 'youtube', source: 'platform', description: 'Desc\u{202E} here' }));
            const o = optimizer(worker.resolveFn);
            await o.start();
            await o.flush();
            o.stop();

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
                finalUrl: undefined,
            });
            expect(theme).toBe('system');
            a.dispatchEvent(new Event('mouseleave'));
            expect(ui.hide).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });

    describe('deferred (hover) anchors', () => {
        const href = 'https://example.org/blog/post';
        const hoverThenResolve: Answer = (u, trigger) => (trigger === 'hover' ? resolvedWith(`Hovered ${u}`) : { status: 'hover' });

        it('carry no visible marker and send nothing until hovered', async () => {
            const a = makeAnchor(href);
            const worker = fakeWorker(hoverThenResolve);
            await run(worker.resolveFn);

            expect(worker.requests).toEqual([{ type: 'RESOLVE', urls: [href], trigger: 'auto' }]);
            expect(a.textContent).toBe(href);
            expect(a.children).toHaveLength(0);
            expect(a.classList.length).toBe(0);
            expect(a.hasAttribute('title')).toBe(false);
            expect(Object.keys(a.dataset)).toEqual([]);
        });

        it('resolve with trigger hover after the pointer rests, render, and open the tooltip at once', async () => {
            const a = makeAnchor(href);
            const worker = fakeWorker(hoverThenResolve);
            const o = optimizer(worker.resolveFn);
            await o.start();
            await o.flush();

            a.dispatchEvent(new Event('mouseenter'));
            await tick();
            await o.flush();
            o.stop();

            expect(worker.requests[1]).toEqual({ type: 'RESOLVE', urls: [href], trigger: 'hover' });
            expect(worker.requests).toHaveLength(2);
            expect(a.classList.contains('ll-resolved')).toBe(true);
            expect(a.querySelector('.ll-title')?.textContent).toBe(`Hovered ${href}`);
            expect(ui.show).toHaveBeenCalledTimes(1);
            expect(ui.show.mock.calls[0][0]).toBe(a);
        });

        it('do not send when the pointer leaves before the delay', async () => {
            vi.useFakeTimers();
            try {
                const a = makeAnchor(href);
                const worker = fakeWorker(hoverThenResolve);
                const o = optimizer(worker.resolveFn, { hoverDelayMs: 300 });
                await o.start();
                await o.flush();

                a.dispatchEvent(new Event('mouseenter'));
                vi.advanceTimersByTime(200);
                a.dispatchEvent(new Event('mouseleave'));
                vi.advanceTimersByTime(500);
                await o.flush();
                o.stop();

                expect(worker.requests).toHaveLength(1);
                expect(a.classList.contains('ll-resolved')).toBe(false);
            } finally {
                vi.useRealTimers();
            }
        });

        it('render without opening the tooltip when the pointer left during the request', async () => {
            const a = makeAnchor(href);
            let release: () => void = () => undefined;
            const slowWorker: ResolveFn = async (request) => {
                if (request.trigger === 'hover') await new Promise<void>((r) => (release = r));
                const results: Record<string, Outcome> = {};
                for (const url of request.urls) results[url] = hoverThenResolve(url, request.trigger);
                return { results };
            };
            const o = optimizer(slowWorker);
            await o.start();
            await o.flush();

            a.dispatchEvent(new Event('mouseenter'));
            await tick(); // the hover request is now in flight, waiting on the worker
            a.dispatchEvent(new Event('mouseleave'));
            release();
            await o.flush();
            o.stop();

            expect(a.classList.contains('ll-resolved')).toBe(true);
            expect(ui.show).not.toHaveBeenCalled();
        });

        it('one hover resolves every anchor sharing the URL, with one request', async () => {
            const a1 = makeAnchor(href);
            const a2 = makeAnchor(href);
            const worker = fakeWorker(hoverThenResolve);
            const o = optimizer(worker.resolveFn);
            await o.start();
            await o.flush();

            a2.dispatchEvent(new Event('mouseenter'));
            await tick();
            await o.flush();
            a1.dispatchEvent(new Event('mouseenter'));
            await tick();
            await o.flush();
            o.stop();

            expect(worker.requests.filter((r) => r.trigger === 'hover')).toHaveLength(1);
            expect(a1.classList.contains('ll-resolved')).toBe(true);
            expect(a2.classList.contains('ll-resolved')).toBe(true);
        });

        it('give up on the anchor when the hover answer is none, and stay deferred when the worker fails', async () => {
            const a = makeAnchor(href);
            let hoverAnswer: Outcome | 'throw' = 'throw';
            const worker = fakeWorker((_u, trigger) => {
                if (trigger !== 'hover') return { status: 'hover' };
                if (hoverAnswer === 'throw') throw new Error('worker asleep');
                return hoverAnswer;
            });
            const o = optimizer(worker.resolveFn);
            await o.start();
            await o.flush();

            a.dispatchEvent(new Event('mouseenter'));
            await tick();
            await o.flush();
            a.dispatchEvent(new Event('mouseleave'));
            expect(a.classList.contains('ll-resolved')).toBe(false);

            hoverAnswer = { status: 'none' };
            a.dispatchEvent(new Event('mouseenter'));
            await tick();
            await o.flush();
            a.dispatchEvent(new Event('mouseleave'));

            a.dispatchEvent(new Event('mouseenter'));
            await tick();
            await o.flush();
            o.stop();

            expect(worker.requests.filter((r) => r.trigger === 'hover')).toHaveLength(2);
            expect(a.classList.contains('ll-resolved')).toBe(false);
            expect(a.textContent).toBe(href);
        });
    });
});
