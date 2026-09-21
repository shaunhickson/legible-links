import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseResolveResponse } from './optimizer';

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
        expect(parsed!.titles.size).toBe(2);
    });
});
