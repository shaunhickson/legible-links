/**
 * The privacy contract: what may leave the browser, and what may change on the page.
 *
 * Each row runs the real content-script optimizer, the real worker message boundary
 * and the real router (Tier 0 local, Tier A platform oEmbed, Tier B our server) against
 * real DOM, with the only fake being the network. Every row states exactly which hosts
 * are contacted and how many times, and what the page looks like afterwards.
 *
 * This file is the specification: the README and the privacy policy may only claim
 * what it proves. A new guard, resolver, or mode adds rows here first.
 */
import { afterEach, describe, expect, it } from 'vitest';
import manifest from '../public/manifest.json';
import { createMessageHandler } from './background/listener';
import { createRouter } from './background/router';
import { LinkOptimizer } from './content/optimizer';
import redditFixture from './resolvers/__fixtures__/reddit.json';
import spotifyFixture from './resolvers/__fixtures__/spotify.json';
import vimeoFixture from './resolvers/__fixtures__/vimeo.json';
import xFixture from './resolvers/__fixtures__/x.json';
import youtubeFixture from './resolvers/__fixtures__/youtube.json';
import { FetchFn } from './resolvers/types';
import { createCache } from './utils/cache';
import { DEFAULT_SETTINGS, ModeName, MODE_PRESETS, Settings } from './utils/settings';

/** Hosts contacted, and how many times. `server` is our own backend (DEFAULT_SETTINGS.apiUrl). */
type Contacts = Record<string, number>;

interface Row {
    name: string;
    href: string;
    text?: string;                 // visible anchor text; defaults to href
    copies?: number;               // how many identical anchors are on the page
    wrap?: 'contenteditable' | 'textbox';
    page?: string;                 // host of the page the link is on; default news.example.org
    mode?: Exclude<ModeName, 'custom'>; // default balanced, the default install
    settings?: Partial<Settings>;
    hover?: boolean;               // the pointer rests on the link after the page has settled
    server?: { title?: string; finalUrl?: string; reply?: 'ok' | 'error' | 'malformed' };
    platform?: { title?: string; reply?: 'ok' | 'notfound' | 'down' };
    contacts: Contacts;            // exactly which hosts are contacted, and how many times
    wire?: string;                 // the exact URL in the POST body to our server, when it must differ from href
    endpoint?: string;             // the exact platform URL requested, when it matters
    expect: 'rendered' | 'untouched';
    renderedText?: string;         // substring expected in the rewritten anchor
    domainText?: string;           // the domain suffix shown; defaults to "· <href host>"
    titleAttr?: string;            // the title attribute; defaults to href without its fragment
}

const YT = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const YT_OEMBED = 'https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ&format=json';
const RICK = 'Rick Astley - Never Gonna Give You Up';
const ARTICLE = 'https://example.org/blog/2026/post';

const rows: Row[] = [
    // ---- Tier 0: titles come from the URL itself. Nothing is contacted, in any mode.
    { name: 'Wikipedia article', href: 'https://en.wikipedia.org/wiki/Alan_Turing', contacts: {}, expect: 'rendered', renderedText: 'Alan Turing' },
    { name: 'Wikipedia article in Private mode', href: 'https://en.wikipedia.org/wiki/Alan_Turing', mode: 'private', contacts: {}, expect: 'rendered', renderedText: 'Alan Turing' },
    { name: 'GitHub repository', href: 'https://github.com/shaunhickson/legible-links', contacts: {}, expect: 'rendered', renderedText: 'shaunhickson/legible-links' },
    { name: 'GitHub issue', href: 'https://github.com/shaunhickson/legible-links/issues/93', contacts: {}, expect: 'rendered', renderedText: 'issue #93' },
    { name: 'Reddit post with a slug', href: 'https://www.reddit.com/r/programming/comments/1g7f0j9/what_are_some_of_the_biggest/', contacts: {}, expect: 'rendered', renderedText: 'r/programming: what are some of the biggest' },
    { name: 'Stack Overflow question', href: 'https://stackoverflow.com/questions/11227809/why-is-processing-a-sorted-array-faster', contacts: {}, expect: 'rendered', renderedText: 'Why is processing a sorted array faster' },
    { name: 'Amazon product', href: 'https://www.amazon.com/Apple-AirPods-Pro/dp/B0CHWRXH8B', contacts: {}, expect: 'rendered', renderedText: 'Apple AirPods Pro' },

    // ---- Tier A: the platform is asked directly, with no cookies; our server is never involved.
    { name: 'YouTube watch link asks YouTube once, at its oEmbed endpoint', href: YT, contacts: { 'www.youtube.com': 1 }, endpoint: YT_OEMBED, expect: 'rendered', renderedText: RICK },
    { name: 'youtu.be link is canonicalised; the tracking parameter never leaves', href: 'https://youtu.be/dQw4w9WgXcQ?si=Ab12Cd', text: 'https://youtu.be/dQw4w9WgXcQ?si=Ab12Cd', contacts: { 'www.youtube.com': 1 }, endpoint: YT_OEMBED, expect: 'rendered', renderedText: RICK, domainText: '· youtu.be' },
    { name: 'two anchors to the same video make one request', href: YT, copies: 2, contacts: { 'www.youtube.com': 1 }, expect: 'rendered', renderedText: RICK },
    { name: 'hovering an already resolved link makes no further request', href: YT, hover: true, contacts: { 'www.youtube.com': 1 }, expect: 'rendered', renderedText: RICK },
    { name: 'Spotify track', href: 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT', contacts: { 'open.spotify.com': 1 }, expect: 'rendered', renderedText: 'Never Gonna Give You Up' },
    { name: 'X post', href: 'https://x.com/jack/status/20', contacts: { 'publish.x.com': 1 }, expect: 'rendered', renderedText: '@jack: just setting up my twttr' },
    { name: 'Reddit post without a slug', href: 'https://www.reddit.com/r/programming/comments/1g7f0j9/', contacts: { 'www.reddit.com': 1 }, expect: 'rendered', renderedText: 'biggest housing projects' },
    { name: 'Vimeo video', href: 'https://vimeo.com/1084537', contacts: { 'vimeo.com': 1 }, expect: 'rendered', renderedText: 'Big Buck Bunny' },
    { name: 'YouTube link on a webmail page still asks YouTube (the page host only gates our server)', href: YT, page: 'mail.google.com', mode: 'everything', contacts: { 'www.youtube.com': 1 }, expect: 'rendered', renderedText: RICK },
    { name: 'Private mode: YouTube link is left raw', href: YT, mode: 'private', contacts: {}, expect: 'untouched' },
    { name: 'Private mode: hovering the YouTube link asks YouTube once', href: YT, mode: 'private', hover: true, contacts: { 'www.youtube.com': 1 }, expect: 'rendered', renderedText: RICK },

    // ---- Tier B: everything else goes to our server, and only when the mode and trigger allow it.
    { name: 'Balanced (default): a plain article link is left raw', href: ARTICLE, contacts: {}, expect: 'untouched' },
    { name: 'Balanced: hovering the article link asks our server once', href: ARTICLE, hover: true, contacts: { server: 1 }, expect: 'rendered' },
    { name: 'Balanced: hovering a shortened link shows where it lands', href: 'https://bit.ly/3abc', hover: true, server: { title: 'Landing page', finalUrl: 'https://example.org/landing' }, contacts: { server: 1 }, expect: 'rendered', renderedText: 'Landing page', domainText: '· example.org via bit.ly', titleAttr: 'https://example.org/landing (via https://bit.ly/3abc)' },
    { name: 'Everything: the article link is sent automatically', href: ARTICLE, mode: 'everything', contacts: { server: 1 }, expect: 'rendered' },
    { name: 'Everything on Gmail: nothing is sent automatically', href: ARTICLE, mode: 'everything', page: 'mail.google.com', contacts: {}, expect: 'untouched' },
    { name: 'Everything on Gmail: hovering sends it', href: ARTICLE, mode: 'everything', page: 'mail.google.com', hover: true, contacts: { server: 1 }, expect: 'rendered' },
    { name: 'Everything on Slack: nothing is sent automatically', href: ARTICLE, mode: 'everything', page: 'acme.slack.com', contacts: {}, expect: 'untouched' },
    { name: 'Everything on Outlook: nothing is sent automatically', href: ARTICLE, mode: 'everything', page: 'outlook.office.com', contacts: {}, expect: 'untouched' },
    { name: 'Private: the article link is never sent, even when hovered', href: ARTICLE, mode: 'private', hover: true, contacts: {}, expect: 'untouched' },
    { name: 'fragment is dropped before sending', href: 'https://example.org/page#section-2', mode: 'everything', contacts: { server: 1 }, wire: 'https://example.org/page', expect: 'rendered', titleAttr: 'https://example.org/page' },
    { name: 'tracking parameters are stripped before sending; the rest stays as-is', href: 'https://example.org/read?utm_source=nl&utm_medium=email&id=7&fbclid=IwAR0xyz', mode: 'everything', contacts: { server: 1 }, wire: 'https://example.org/read?id=7', expect: 'rendered' },
    { name: 'high-entropy path segment never leaves, even hovered in Everything mode', href: 'https://example.org/share/4f9c2a1b7e3d4c5a9b8f7e6d5c4b3a2f', mode: 'everything', hover: true, contacts: {}, expect: 'untouched' },
    { name: 'document id never leaves, even hovered in Everything mode', href: 'https://docs.example.org/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit', mode: 'everything', hover: true, contacts: {}, expect: 'untouched' },

    // ---- Single-use and authenticated links never leave the browser, in the most permissive mode, even hovered.
    { name: 'password reset token', href: 'https://accounts.example.org/reset?token=9f8e7d6c', mode: 'everything', hover: true, contacts: {}, expect: 'untouched' },
    { name: 'magic login link', href: 'https://example.org/magic-link/abc', mode: 'everything', hover: true, contacts: {}, expect: 'untouched' },
    { name: 'unsubscribe link', href: 'https://mail.example.org/unsubscribe?u=1', mode: 'everything', hover: true, contacts: {}, expect: 'untouched' },
    { name: 'invite link', href: 'https://team.example.org/invite/xyz', mode: 'everything', hover: true, contacts: {}, expect: 'untouched' },
    { name: 'oauth callback with code', href: 'https://example.org/oauth/callback?code=abc&state=1', mode: 'everything', hover: true, contacts: {}, expect: 'untouched' },
    { name: 'login page', href: 'https://example.org/login', mode: 'everything', hover: true, contacts: {}, expect: 'untouched' },
    { name: 'pre-signed S3 URL', href: 'https://bucket.s3.amazonaws.com/f?X-Amz-Signature=abc', mode: 'everything', hover: true, contacts: {}, expect: 'untouched' },
    { name: 'credentials in URL', href: 'https://user:pw@example.org/', text: 'https://example.org/', mode: 'everything', hover: true, contacts: {}, expect: 'untouched' },
    { name: 'YouTube link with a token parameter', href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&token=abc', mode: 'everything', hover: true, contacts: {}, expect: 'untouched' },

    // ---- Private, local and internal hosts never leave the browser.
    { name: 'private IPv4', href: 'http://192.168.1.1/admin', mode: 'everything', hover: true, contacts: {}, expect: 'untouched' },
    { name: 'IPv6 literal', href: 'http://[::1]/', mode: 'everything', hover: true, contacts: {}, expect: 'untouched' },
    { name: 'localhost', href: 'http://localhost/', mode: 'everything', hover: true, contacts: {}, expect: 'untouched' },
    { name: 'single-label intranet host', href: 'https://intranet/wiki/Onboarding', mode: 'everything', hover: true, contacts: {}, expect: 'untouched' },
    { name: '.local host', href: 'https://printer.local/', mode: 'everything', hover: true, contacts: {}, expect: 'untouched' },
    { name: '.internal host', href: 'https://wiki.corp.internal/page', mode: 'everything', hover: true, contacts: {}, expect: 'untouched' },
    { name: '.onion host', href: 'http://abc.onion/', mode: 'everything', hover: true, contacts: {}, expect: 'untouched' },
    { name: 'non-web port', href: 'https://example.org:8443/', mode: 'everything', hover: true, contacts: {}, expect: 'untouched' },

    // ---- Non-http schemes and non-raw text are ignored.
    { name: 'mailto', href: 'mailto:someone@example.org', text: 'mailto:someone@example.org', mode: 'everything', hover: true, contacts: {}, expect: 'untouched' },
    { name: 'javascript: href', href: 'javascript:void(0)', text: 'https://example.org/', mode: 'everything', hover: true, contacts: {}, expect: 'untouched' },
    { name: 'descriptive link text is left alone', href: 'https://example.org/', text: 'Read the article', mode: 'everything', hover: true, contacts: {}, expect: 'untouched' },

    // ---- Phishing shapes are never "helped".
    { name: 'visible text names a different domain than the href', href: 'https://evil.example.org/x', text: 'https://paypal.com/login', mode: 'everything', hover: true, contacts: {}, expect: 'untouched' },
    { name: 'our server returns a URL as the title', href: 'https://example.org/a', mode: 'everything', server: { title: 'https://paypal.com/secure-login' }, contacts: { server: 1 }, expect: 'untouched' },
    { name: 'a platform returns a URL as the title', href: YT, platform: { title: 'https://paypal.com/secure-login' }, contacts: { 'www.youtube.com': 1 }, expect: 'untouched' },

    // ---- Editable areas are never rewritten.
    { name: 'inside contenteditable', href: 'https://example.org/', wrap: 'contenteditable', mode: 'everything', hover: true, contacts: {}, expect: 'untouched' },
    { name: 'inside role=textbox', href: 'https://example.org/', wrap: 'textbox', mode: 'everything', hover: true, contacts: {}, expect: 'untouched' },

    // ---- Untrusted titles are text, never markup, and never bidi-spoofed.
    { name: 'XSS payload from our server renders as text', href: 'https://example.org/xss', mode: 'everything', server: { title: '<img src=x onerror="window.__pwned=1">' }, contacts: { server: 1 }, expect: 'rendered', renderedText: '<img src=x' },
    { name: 'XSS payload from a platform renders as text', href: YT, platform: { title: '<img src=x onerror="window.__pwned=1">' }, contacts: { 'www.youtube.com': 1 }, expect: 'rendered', renderedText: '<img src=x' },
    { name: 'bidi override stripped from a server title', href: 'https://example.org/bidi', mode: 'everything', server: { title: 'gpj.‮exe' }, contacts: { server: 1 }, expect: 'rendered', renderedText: 'gpj.exe' },
    { name: 'bidi override stripped from a platform title', href: YT, platform: { title: 'gpj.‮exe' }, contacts: { 'www.youtube.com': 1 }, expect: 'rendered', renderedText: 'gpj.exe' },

    // ---- Failures fail open.
    { name: 'server error leaves the page untouched', href: 'https://example.org/err', mode: 'everything', server: { reply: 'error' }, contacts: { server: 1 }, expect: 'untouched' },
    { name: 'malformed server response leaves the page untouched', href: 'https://example.org/bad', mode: 'everything', server: { reply: 'malformed' }, contacts: { server: 1 }, expect: 'untouched' },
    { name: 'platform 404 leaves the page untouched', href: YT, platform: { reply: 'notfound' }, contacts: { 'www.youtube.com': 1 }, expect: 'untouched' },
    { name: 'platform unreachable leaves the page untouched', href: YT, platform: { reply: 'down' }, contacts: { 'www.youtube.com': 1 }, expect: 'untouched' },

    // ---- User settings win.
    { name: 'extension disabled', href: YT, mode: 'everything', settings: { enabled: false }, contacts: {}, expect: 'untouched' },
    { name: 'target domain blocklisted', href: YT, mode: 'everything', settings: { domainList: ['youtube.com'] }, contacts: {}, expect: 'untouched' },
];

// ---------------------------------------------------------------------------

interface Recorded { url: string; init: RequestInit | undefined }

const PAGE_HOST = 'news.example.org';
const SERVER_HOST = new URL(DEFAULT_SETTINGS.apiUrl).host;
const SELF_ID = 'privacy-contract-extension-id';

/** Every origin the manifest lets the worker reach. Anything else contacted is a contract violation. */
const PERMITTED_HOSTS = new Set(manifest.host_permissions.map((pattern) => new URL(pattern.replace(/\*$/, '')).host));

const platformFixtures: Record<string, unknown> = {
    'www.youtube.com': youtubeFixture,
    'open.spotify.com': spotifyFixture,
    'publish.x.com': xFixture,
    'www.reddit.com': redditFixture,
    'vimeo.com': vimeoFixture,
};

function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function answer(row: Row, url: string, init?: RequestInit): Response {
    const host = new URL(url).host;
    if (host === SERVER_HOST) {
        if (row.server?.reply === 'error') return jsonResponse(500, { error: 'boom' });
        if (row.server?.reply === 'malformed') return jsonResponse(200, { titles: 'not-an-object' });
        const urls = (JSON.parse(String(init?.body)) as { urls: string[] }).urls;
        const titles: Record<string, string> = {};
        const details: Record<string, { platform: string; finalUrl?: string }> = {};
        for (const u of urls) {
            titles[u] = row.server?.title ?? 'Resolved title';
            details[u] = { platform: 'Generic', finalUrl: row.server?.finalUrl };
        }
        return jsonResponse(200, { titles, details });
    }
    const fixture = platformFixtures[host];
    if (fixture === undefined) throw new Error(`unexpected host contacted: ${host}`);
    if (row.platform?.reply === 'notfound') return jsonResponse(404, {});
    if (row.platform?.reply === 'down') throw new TypeError('Failed to fetch');
    if (row.platform?.title !== undefined) return jsonResponse(200, { ...(fixture as object), title: row.platform.title });
    return jsonResponse(200, fixture);
}

function mountAnchors(row: Row): HTMLAnchorElement[] {
    const anchors: HTMLAnchorElement[] = [];
    for (let i = 0; i < (row.copies ?? 1); i++) {
        const a = document.createElement('a');
        a.setAttribute('href', row.href);
        a.textContent = row.text ?? row.href;
        const container: HTMLElement = document.createElement('div');
        if (row.wrap === 'contenteditable') container.setAttribute('contenteditable', 'true');
        if (row.wrap === 'textbox') container.setAttribute('role', 'textbox');
        container.appendChild(a);
        document.body.appendChild(container);
        anchors.push(a);
    }
    return anchors;
}

async function run(row: Row): Promise<{ anchors: HTMLAnchorElement[]; requests: Recorded[] }> {
    const anchors = mountAnchors(row);
    const requests: Recorded[] = [];
    const fetchFn: FetchFn = async (url, init) => {
        requests.push({ url, init });
        return answer(row, url, init);
    };
    const settings: Settings = { ...DEFAULT_SETTINGS, ...MODE_PRESETS[row.mode ?? 'balanced'], ...row.settings };
    const pageHost = row.page ?? PAGE_HOST;

    // The worker side, as deployed: router behind the message boundary.
    const router = createRouter({ fetchFn, cache: createCache(), getSettings: () => settings });
    const handleMessage = createMessageHandler(router, SELF_ID);
    const sender = { id: SELF_ID, url: `https://${pageHost}/some/page` };

    // The content-script side, as deployed, with sendMessage replaced by the handler above.
    const optimizer = new LinkOptimizer({
        resolveFn: (request) => new Promise((resolve) => {
            if (handleMessage(request, sender, resolve) !== true) resolve(undefined);
        }),
        doc: document,
        loadSettings: async () => settings,
        ui: { show() {}, hide() {} },
        batchDelayMs: 0,
        hoverDelayMs: 0,
    });
    await optimizer.start();
    await optimizer.flush();
    if (row.hover) {
        anchors[0].dispatchEvent(new Event('mouseenter'));
        await new Promise((r) => setTimeout(r, 0));
        await optimizer.flush();
        anchors[0].dispatchEvent(new Event('mouseleave'));
    }
    optimizer.stop();
    return { anchors, requests };
}

function contactsOf(requests: Recorded[]): Contacts {
    const out: Contacts = {};
    for (const r of requests) {
        const host = new URL(r.url).host;
        const name = host === SERVER_HOST ? 'server' : host;
        out[name] = (out[name] ?? 0) + 1;
    }
    return out;
}

function postedUrls(requests: Recorded[]): string[] {
    return requests
        .filter((r) => r.init?.method === 'POST')
        .flatMap((r) => (JSON.parse(String(r.init?.body)) as { urls: string[] }).urls);
}

function withoutFragment(href: string): string {
    try {
        const u = new URL(href);
        u.hash = '';
        return u.href;
    } catch {
        return href;
    }
}

describe('privacy contract', () => {
    afterEach(() => {
        document.body.replaceChildren();
        delete (window as unknown as { __pwned?: unknown }).__pwned;
    });

    for (const row of rows) {
        it(`${row.name} → ${row.expect}, contacts ${JSON.stringify(row.contacts)}`, async () => {
            const originalText = row.text ?? row.href;
            const { anchors, requests } = await run(row);

            // What left the browser: exactly these hosts, exactly this often.
            expect(contactsOf(requests)).toEqual(row.contacts);
            for (const r of requests) {
                const u = new URL(r.url);
                expect(PERMITTED_HOSTS.has(u.host), `${u.host} is not in manifest host_permissions`).toBe(true);
                expect(u.protocol).toBe('https:');
                expect(r.init?.credentials).toBe('omit');
                expect(r.init?.referrerPolicy).toBe('no-referrer');
                expect(r.init?.cache).toBe('no-store');
                if (u.host === SERVER_HOST) {
                    expect(r.url).toBe(DEFAULT_SETTINGS.apiUrl);
                    expect(r.init?.method).toBe('POST');
                } else {
                    expect(r.init?.method).toBe('GET');
                    expect(r.init?.body).toBeUndefined();
                }
            }
            if (row.contacts.server) {
                expect(postedUrls(requests)).toEqual([row.wire ?? withoutFragment(row.href)]);
            } else {
                expect(postedUrls(requests)).toEqual([]);
            }
            if (row.endpoint) {
                expect(requests.map((r) => r.url)).toEqual([row.endpoint]);
            }

            // The href is never modified, and nothing ever runs, whatever happens.
            for (const anchor of anchors) expect(anchor.getAttribute('href')).toBe(row.href);
            expect((window as unknown as { __pwned?: unknown }).__pwned).toBeUndefined();

            for (const anchor of anchors) {
                if (row.expect === 'rendered') {
                    expect(anchor.classList.contains('ll-resolved')).toBe(true);
                    expect(anchor.querySelector('img, script, iframe, object, embed')).toBeNull();
                    expect(anchor.querySelectorAll('svg')).toHaveLength(1);
                    expect(anchor.textContent).toContain(row.renderedText ?? 'Resolved title');
                    expect(anchor.textContent).toContain(row.domainText ?? '· ' + new URL(row.href).hostname);
                    expect(anchor.textContent).not.toContain('‮');
                    expect(anchor.getAttribute('title')).toBe(row.titleAttr ?? withoutFragment(row.href));
                } else {
                    expect(anchor.classList.contains('ll-resolved')).toBe(false);
                    expect(anchor.textContent).toBe(originalText);
                    expect(anchor.children).toHaveLength(0);
                    expect(anchor.hasAttribute('title')).toBe(false);
                }
            }
        });
    }
});
