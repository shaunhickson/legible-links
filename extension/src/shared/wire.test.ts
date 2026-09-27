import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseResolveResponse } from './wire';

// The same fixture is decoded by the backend's wire_test.go, so the two sides
// of the /resolve contract cannot drift apart silently.
const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
    readFileSync(resolve(here, '../../../testdata/resolve-response.json'), 'utf8'),
) as unknown;

describe('/resolve wire contract', () => {
    it('parses the shared fixture', () => {
        const parsed = parseResolveResponse(fixture);
        expect(parsed).not.toBeNull();
        expect(parsed!.titles.get('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toContain('Rick Astley');
        expect(parsed!.details.get('https://www.youtube.com/watch?v=dQw4w9WgXcQ')?.platform).toBe('YouTube');
        expect(parsed!.details.get('https://example.org/post')?.description).toBe('A description');
        expect(parsed!.details.get('https://example.org/post')?.finalUrl).toBeUndefined();
        expect(parsed!.titles.size).toBe(2);
    });

    it('reads finalUrl from details when the backend followed redirects', () => {
        const parsed = parseResolveResponse({
            titles: { 'https://bit.ly/3abc': 'Landing page' },
            details: { 'https://bit.ly/3abc': { platform: 'Generic', finalUrl: 'https://example.org/landing' } },
        });
        expect(parsed!.details.get('https://bit.ly/3abc')?.finalUrl).toBe('https://example.org/landing');
    });

    it('rejects malformed responses and drops non-string entries', () => {
        expect(parseResolveResponse(null)).toBeNull();
        expect(parseResolveResponse({ titles: 'x' })).toBeNull();
        expect(parseResolveResponse({ titles: ['a'] })).toBeNull();
        const parsed = parseResolveResponse({ titles: { a: 1, b: 'ok' }, details: { b: 'nope', c: { finalUrl: 7 } } });
        expect(parsed?.titles.get('b')).toBe('ok');
        expect(parsed?.titles.has('a')).toBe(false);
        expect(parsed?.details.has('b')).toBe(false);
        expect(parsed?.details.get('c')?.finalUrl).toBeUndefined();
    });
});
