import { describe, expect, it } from 'vitest';
import { isOutcome, isResolveRequest, MAX_URLS_PER_MESSAGE, readResolveResponse } from './protocol';

describe('isResolveRequest', () => {
    it('accepts a well-formed request', () => {
        expect(isResolveRequest({ type: 'RESOLVE', urls: ['https://example.org/'], trigger: 'auto' })).toBe(true);
        expect(isResolveRequest({ type: 'RESOLVE', urls: ['https://example.org/'], trigger: 'hover' })).toBe(true);
    });

    it.each<[string, unknown]>([
        ['null', null],
        ['a string', 'RESOLVE'],
        ['an array', ['RESOLVE']],
        ['wrong type', { type: 'GET_TITLE', urls: ['https://a/'], trigger: 'auto' }],
        ['missing trigger', { type: 'RESOLVE', urls: ['https://a/'] }],
        ['unknown trigger', { type: 'RESOLVE', urls: ['https://a/'], trigger: 'click' }],
        ['urls not an array', { type: 'RESOLVE', urls: 'https://a/', trigger: 'auto' }],
        ['no urls', { type: 'RESOLVE', urls: [], trigger: 'auto' }],
        ['too many urls', { type: 'RESOLVE', urls: Array(MAX_URLS_PER_MESSAGE + 1).fill('https://a/'), trigger: 'auto' }],
        ['non-string url', { type: 'RESOLVE', urls: [42], trigger: 'auto' }],
        ['empty url', { type: 'RESOLVE', urls: [''], trigger: 'auto' }],
        ['oversized url', { type: 'RESOLVE', urls: ['https://a/' + 'x'.repeat(2048)], trigger: 'auto' }],
    ])('rejects %s', (_name, value) => {
        expect(isResolveRequest(value)).toBe(false);
    });
});

describe('isOutcome', () => {
    it('accepts the three statuses', () => {
        expect(isOutcome({ status: 'none' })).toBe(true);
        expect(isOutcome({ status: 'hover' })).toBe(true);
        expect(isOutcome({ status: 'resolved', title: 'T', platform: 'generic', source: 'backend' })).toBe(true);
        expect(isOutcome({ status: 'resolved', title: 'T', platform: 'x', source: 'cache', description: 'd', finalUrl: 'https://b/' })).toBe(true);
    });

    it.each<[string, unknown]>([
        ['unknown status', { status: 'maybe' }],
        ['resolved without title', { status: 'resolved', platform: 'generic', source: 'local' }],
        ['resolved with non-string title', { status: 'resolved', title: 1, platform: 'generic', source: 'local' }],
        ['resolved with unknown source', { status: 'resolved', title: 'T', platform: 'generic', source: 'telepathy' }],
        ['resolved with non-string description', { status: 'resolved', title: 'T', platform: 'generic', source: 'local', description: 5 }],
        ['resolved with non-string finalUrl', { status: 'resolved', title: 'T', platform: 'generic', source: 'local', finalUrl: {} }],
    ])('rejects %s', (_name, value) => {
        expect(isOutcome(value)).toBe(false);
    });
});

describe('readResolveResponse', () => {
    it('returns null for a malformed message', () => {
        expect(readResolveResponse(undefined)).toBeNull();
        expect(readResolveResponse({})).toBeNull();
        expect(readResolveResponse({ results: [] })).toBeNull();
    });

    it('keeps well-formed outcomes and drops the rest', () => {
        const out = readResolveResponse({
            results: {
                'https://a/': { status: 'none' },
                'https://b/': { status: 'resolved', title: 'T', platform: 'generic', source: 'local' },
                'https://c/': { status: 'resolved' },
                'https://d/': 'resolved',
            },
        });
        expect(Array.from(out!.keys())).toEqual(['https://a/', 'https://b/']);
    });
});
