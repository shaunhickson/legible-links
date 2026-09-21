/**
 * The privacy contract: what may leave the browser, and what may change on the page.
 *
 * Each row runs the real content-script optimizer against real DOM with a recording
 * backend, and asserts exactly one outcome. This file is the specification: the README
 * and the privacy policy may only claim what it proves. New guards add rows here first.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { LinkOptimizer } from './content/optimizer';
import { DEFAULT_SETTINGS, Settings } from './utils/settings';

type Outcome = 'sent+rendered' | 'sent+untouched' | 'untouched';

interface Row {
    name: string;
    href: string;
    text?: string;                 // visible anchor text; defaults to href
    wrap?: 'contenteditable' | 'textbox' | 'textarea-sibling';
    backendTitle?: string;         // what the fake backend answers; default 'Resolved title'
    backend?: 'ok' | 'error' | 'malformed';
    settings?: Partial<Settings>;
    expect: Outcome;
    sentUrl?: string;              // when the URL on the wire must differ from href
    renderedText?: string;         // substring expected in the rewritten anchor
}

const rows: Row[] = [
    // Ordinary public links are sent and rewritten, and the destination is shown.
    { name: 'YouTube watch link', href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', expect: 'sent+rendered', renderedText: '· www.youtube.com' },
    { name: 'plain article link', href: 'https://example.org/blog/2026/post', expect: 'sent+rendered', renderedText: '· example.org' },
    { name: 'shortened link', href: 'https://bit.ly/3abc', expect: 'sent+rendered' },
    { name: 'fragment is dropped before sending', href: 'https://example.org/page#section-2', expect: 'sent+rendered', sentUrl: 'https://example.org/page' },
    { name: 'tracking params are sent as-is until M1 strips them', href: 'https://example.org/?utm_source=x', expect: 'sent+rendered' },

    // Single-use and authenticated links never leave the browser.
    { name: 'password reset token', href: 'https://accounts.example.org/reset?token=9f8e7d6c', expect: 'untouched' },
    { name: 'magic login link', href: 'https://example.org/magic-link/abc', expect: 'untouched' },
    { name: 'unsubscribe link', href: 'https://mail.example.org/unsubscribe?u=1', expect: 'untouched' },
    { name: 'invite link', href: 'https://team.example.org/invite/xyz', expect: 'untouched' },
    { name: 'oauth callback with code', href: 'https://example.org/oauth/callback?code=abc&state=1', expect: 'untouched' },
    { name: 'login page', href: 'https://example.org/login', expect: 'untouched' },
    { name: 'pre-signed S3 URL', href: 'https://bucket.s3.amazonaws.com/f?X-Amz-Signature=abc', expect: 'untouched' },
    { name: 'credentials in URL', href: 'https://user:pw@example.org/', text: 'https://example.org/', expect: 'untouched' },

    // Private, local and internal hosts never leave the browser.
    { name: 'private IPv4', href: 'http://192.168.1.1/admin', expect: 'untouched' },
    { name: 'IPv6 literal', href: 'http://[::1]/', expect: 'untouched' },
    { name: 'localhost', href: 'http://localhost/', expect: 'untouched' },
    { name: 'single-label intranet host', href: 'https://intranet/wiki/Onboarding', expect: 'untouched' },
    { name: '.local host', href: 'https://printer.local/', expect: 'untouched' },
    { name: '.internal host', href: 'https://wiki.corp.internal/page', expect: 'untouched' },
    { name: '.onion host', href: 'http://abc.onion/', expect: 'untouched' },
    { name: 'non-web port', href: 'https://example.org:8443/', expect: 'untouched' },

    // Non-http schemes and non-raw text are ignored.
    { name: 'mailto', href: 'mailto:someone@example.org', text: 'mailto:someone@example.org', expect: 'untouched' },
    { name: 'javascript: href', href: 'javascript:void(0)', text: 'https://example.org/', expect: 'untouched' },
    { name: 'descriptive link text is left alone', href: 'https://example.org/', text: 'Read the article', expect: 'untouched' },

    // Phishing shapes are never "helped".
    { name: 'visible text names a different domain than the href', href: 'https://evil.example.org/x', text: 'https://paypal.com/login', expect: 'untouched' },
    { name: 'backend returns a URL as the title', href: 'https://example.org/a', backendTitle: 'https://paypal.com/secure-login', expect: 'sent+untouched' },

    // Editable areas are never rewritten.
    { name: 'inside contenteditable', href: 'https://example.org/', wrap: 'contenteditable', expect: 'untouched' },
    { name: 'inside role=textbox', href: 'https://example.org/', wrap: 'textbox', expect: 'untouched' },

    // Untrusted titles are text, never markup, and never bidi-spoofed.
    { name: 'XSS payload title renders as text', href: 'https://example.org/xss', backendTitle: '<img src=x onerror="window.__pwned=1">', expect: 'sent+rendered', renderedText: '<img src=x' },
    { name: 'bidi override stripped from title', href: 'https://example.org/bidi', backendTitle: 'gpj.‮exe', expect: 'sent+rendered', renderedText: 'gpj.exe' },

    // Failures fail open.
    { name: 'backend error leaves the page untouched', href: 'https://example.org/err', backend: 'error', expect: 'sent+untouched' },
    { name: 'malformed backend response leaves the page untouched', href: 'https://example.org/bad', backend: 'malformed', expect: 'sent+untouched' },

    // User settings win.
    { name: 'extension disabled', href: 'https://example.org/', settings: { enabled: false }, expect: 'untouched' },
    { name: 'target domain blocklisted', href: 'https://example.org/', settings: { domainList: ['example.org'] }, expect: 'untouched' },
];

interface Recorded { url: string; init: RequestInit | undefined }

function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function mountAnchor(row: Row): HTMLAnchorElement {
    const a = document.createElement('a');
    a.setAttribute('href', row.href);
    a.textContent = row.text ?? row.href;
    const container: HTMLElement = document.createElement('div');
    if (row.wrap === 'contenteditable') container.setAttribute('contenteditable', 'true');
    if (row.wrap === 'textbox') container.setAttribute('role', 'textbox');
    container.appendChild(a);
    document.body.appendChild(container);
    return a;
}

async function run(row: Row): Promise<{ anchor: HTMLAnchorElement; requests: Recorded[] }> {
    const anchor = mountAnchor(row);
    const requests: Recorded[] = [];
    const fetchFn = async (url: string, init?: RequestInit): Promise<Response> => {
        requests.push({ url, init });
        if (row.backend === 'error') return jsonResponse(500, { error: 'boom' });
        if (row.backend === 'malformed') return jsonResponse(200, { titles: 'not-an-object' });
        const urls = (JSON.parse(String(init?.body)) as { urls: string[] }).urls;
        const titles: Record<string, string> = {};
        for (const u of urls) titles[u] = row.backendTitle ?? 'Resolved title';
        return jsonResponse(200, { titles });
    };
    const optimizer = new LinkOptimizer({
        fetchFn,
        doc: document,
        loadSettings: async () => ({ ...DEFAULT_SETTINGS, ...row.settings }),
        ui: { show() {}, hide() {} },
        batchDelayMs: 0,
    });
    await optimizer.start();
    await optimizer.flush();
    optimizer.stop();
    return { anchor, requests };
}

function sentUrls(requests: Recorded[]): string[] {
    return requests.flatMap((r) => (JSON.parse(String(r.init?.body)) as { urls: string[] }).urls);
}

describe('privacy contract', () => {
    afterEach(() => {
        document.body.replaceChildren();
        delete (window as unknown as { __pwned?: unknown }).__pwned;
    });

    for (const row of rows) {
        it(`${row.name} → ${row.expect}`, async () => {
            const originalText = row.text ?? row.href;
            const { anchor, requests } = await run(row);
            const wire = sentUrls(requests);

            if (row.expect === 'untouched') {
                expect(requests, 'nothing may be sent').toHaveLength(0);
            } else {
                expect(wire).toEqual([row.sentUrl ?? row.href]);
                for (const r of requests) {
                    expect(r.url).toBe(DEFAULT_SETTINGS.apiUrl);
                    expect(r.init?.credentials).toBe('omit');
                    expect(r.init?.referrerPolicy).toBe('no-referrer');
                }
            }

            // The href is never modified, whatever happens.
            expect(anchor.getAttribute('href')).toBe(row.href);
            expect((window as unknown as { __pwned?: unknown }).__pwned).toBeUndefined();

            if (row.expect === 'sent+rendered') {
                expect(anchor.classList.contains('ll-resolved')).toBe(true);
                expect(anchor.querySelector('img, script, iframe, object, embed')).toBeNull();
                expect(anchor.querySelectorAll('svg')).toHaveLength(1);
                expect(anchor.textContent).toContain(row.renderedText ?? 'Resolved title');
                expect(anchor.textContent).toContain('· ' + new URL(row.href).hostname);
                expect(anchor.textContent).not.toContain('‮');
                expect(anchor.getAttribute('title')).toBe(row.sentUrl ?? row.href);
            } else {
                expect(anchor.classList.contains('ll-resolved')).toBe(false);
                expect(anchor.textContent).toBe(originalText);
                expect(anchor.children).toHaveLength(0);
            }
        });
    }
});
