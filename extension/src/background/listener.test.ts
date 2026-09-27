import { describe, expect, it, vi } from 'vitest';
import { createMessageHandler, pageHostFromSender } from './listener';
import { Router } from './router';

const SELF = 'abcdefghijklmnopabcdefghijklmnop';
const REQUEST = { type: 'RESOLVE', urls: ['https://example.org/'], trigger: 'auto' } as const;

function fakeRouter() {
    const resolve = vi.fn(async () => ({ 'https://example.org/': { status: 'none' as const } }));
    return { router: { resolve } as unknown as Router, resolve };
}

async function dispatch(handler: ReturnType<typeof createMessageHandler>, message: unknown, sender: { id?: string; url?: string }) {
    const sendResponse = vi.fn();
    const kept = handler(message, sender, sendResponse);
    await new Promise((r) => setTimeout(r, 0));
    return { kept, sendResponse };
}

describe('pageHostFromSender', () => {
    it.each<[string | undefined, string | null]>([
        ['https://news.example.org/story', 'news.example.org'],
        ['http://127.0.0.1:4173/test.html', '127.0.0.1'],
        ['chrome-extension://abc/popup.html', null],
        ['file:///tmp/x.html', null],
        ['about:blank', null],
        ['not a url', null],
        [undefined, null],
        ['', null],
    ])('%s -> %s', (url, expected) => {
        expect(pageHostFromSender(url)).toBe(expected);
    });
});

describe('createMessageHandler', () => {
    it('answers a RESOLVE request from our own content script on an http(s) page', async () => {
        const { router, resolve } = fakeRouter();
        const { kept, sendResponse } = await dispatch(createMessageHandler(router, SELF), REQUEST, { id: SELF, url: 'https://news.example.org/story' });
        expect(kept).toBe(true);
        expect(resolve).toHaveBeenCalledWith(['https://example.org/'], 'auto', 'news.example.org');
        expect(sendResponse).toHaveBeenCalledWith({ results: { 'https://example.org/': { status: 'none' } } });
    });

    it('takes the page host from the sender, never from the message', async () => {
        const { router, resolve } = fakeRouter();
        const spoofed = { ...REQUEST, pageHost: 'evil.example', sender: { url: 'https://evil.example/' } };
        await dispatch(createMessageHandler(router, SELF), spoofed, { id: SELF, url: 'https://mail.google.com/mail/u/0/' });
        expect(resolve).toHaveBeenCalledWith(['https://example.org/'], 'auto', 'mail.google.com');
    });

    it.each<[string, { id?: string; url?: string }]>([
        ['another extension', { id: 'someoneelse', url: 'https://news.example.org/' }],
        ['no sender id', { url: 'https://news.example.org/' }],
        ['an extension page', { id: SELF, url: `chrome-extension://${SELF}/popup.html` }],
        ['a file: page', { id: SELF, url: 'file:///home/me/page.html' }],
        ['no sender url', { id: SELF }],
    ])('ignores messages from %s', async (_name, sender) => {
        const { router, resolve } = fakeRouter();
        const { kept, sendResponse } = await dispatch(createMessageHandler(router, SELF), REQUEST, sender);
        expect(kept).toBeUndefined();
        expect(resolve).not.toHaveBeenCalled();
        expect(sendResponse).not.toHaveBeenCalled();
    });

    it('ignores malformed messages', async () => {
        const { router, resolve } = fakeRouter();
        const handler = createMessageHandler(router, SELF);
        for (const message of [null, 'RESOLVE', { type: 'GET_TITLE' }, { type: 'RESOLVE', urls: [], trigger: 'auto' }, { type: 'RESOLVE', urls: ['x'], trigger: 'click' }]) {
            const { kept } = await dispatch(handler, message, { id: SELF, url: 'https://news.example.org/' });
            expect(kept).toBeUndefined();
        }
        expect(resolve).not.toHaveBeenCalled();
    });

    it('fails open with an empty result set when the router throws', async () => {
        const resolve = vi.fn(async () => {
            throw new Error('boom');
        });
        const handler = createMessageHandler({ resolve } as unknown as Router, SELF);
        const { sendResponse } = await dispatch(handler, REQUEST, { id: SELF, url: 'https://news.example.org/' });
        expect(sendResponse).toHaveBeenCalledWith({ results: {} });
    });

    it('never answers when its own id is unknown', async () => {
        const { router, resolve } = fakeRouter();
        const { kept } = await dispatch(createMessageHandler(router, ''), REQUEST, { id: '', url: 'https://news.example.org/' });
        expect(kept).toBeUndefined();
        expect(resolve).not.toHaveBeenCalled();
    });
});
