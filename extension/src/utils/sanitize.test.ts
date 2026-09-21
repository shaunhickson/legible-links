import { describe, it, expect } from 'vitest';
import { sanitizeTitle, sanitizeText, sanitizeDescription } from './sanitize';

describe('sanitizeTitle', () => {
    it('strips C0 and C1 control characters', () => {
        expect(sanitizeTitle('Hel\x00lo\x07 Wor\x1Fld\x7F\x85!')).toBe('Hello World!');
    });

    it('folds tabs and newlines into single spaces', () => {
        expect(sanitizeTitle('Line one\n\tLine two\r\nLine three')).toBe('Line one Line two Line three');
    });

    it('removes bidi override characters', () => {
        const out = sanitizeTitle('\u{202E}evil\u{202C}');
        expect(out).toBe('evil');
        expect(out).not.toContain('\u{202E}');
        expect(out).not.toContain('\u{202C}');
    });

    it('removes bidi isolates and the Arabic letter mark', () => {
        expect(sanitizeTitle('\u{2066}a\u{2067}b\u{2069}c\u{061C}')).toBe('abc');
    });

    it('removes zero-width and invisible formatting characters', () => {
        expect(sanitizeTitle('a\u{200B}b\u{200C}c\u{200D}d\u{FEFF}e\u{2060}f\u{180E}g')).toBe('abcdefg');
    });

    it('collapses runs of whitespace and trims', () => {
        expect(sanitizeTitle('   Hello    \u{00A0}  World   ')).toBe('Hello World');
    });

    it('collapses whitespace left behind by stripped characters', () => {
        expect(sanitizeTitle('a \u{200B} b')).toBe('a b');
    });

    it('caps long titles at 120 characters with an ellipsis', () => {
        const out = sanitizeTitle('a'.repeat(5000));
        expect(out.length).toBe(120);
        expect(out.endsWith('…')).toBe(true);
        expect(out.startsWith('a'.repeat(119))).toBe(true);
    });

    it('counts code points, not UTF-16 units, when capping', () => {
        const out = sanitizeTitle('😀'.repeat(200));
        expect(Array.from(out).length).toBe(120);
        expect(out.endsWith('…')).toBe(true);
    });

    it('does not cap titles at or under the limit', () => {
        const exact = 'b'.repeat(120);
        expect(sanitizeTitle(exact)).toBe(exact);
    });

    it('NFC-normalizes', () => {
        expect(sanitizeTitle('e\u{0301}')).toBe('\u{00E9}');
    });

    it('rejects titles that are themselves URLs', () => {
        expect(sanitizeTitle('https://example.com/')).toBe('');
        expect(sanitizeTitle('HTTP://EXAMPLE.COM')).toBe('');
        expect(sanitizeTitle('www.paypal.com')).toBe('');
        expect(sanitizeTitle('paypal.com/login')).toBe('');
        expect(sanitizeTitle('  https://x.test/a b')).toBe('');
    });

    it('keeps ordinary names that merely contain a dot', () => {
        expect(sanitizeTitle('Node.js')).toBe('Node.js');
        expect(sanitizeTitle('Vue.js - The Progressive Framework')).toBe('Vue.js - The Progressive Framework');
        expect(sanitizeTitle('example.com')).toBe('example.com');
        expect(sanitizeTitle('v1.2 released')).toBe('v1.2 released');
    });

    it('returns empty for empty or whitespace-only input', () => {
        expect(sanitizeTitle('')).toBe('');
        expect(sanitizeTitle('   \n\t ')).toBe('');
        expect(sanitizeTitle('\u{200B}\u{202E}')).toBe('');
    });

    it('returns empty for non-strings', () => {
        expect(sanitizeTitle(undefined)).toBe('');
        expect(sanitizeTitle(null)).toBe('');
        expect(sanitizeTitle(42)).toBe('');
        expect(sanitizeTitle({ toString: () => 'x' })).toBe('');
        expect(sanitizeTitle(['a'])).toBe('');
    });

    it('leaves markup as literal text (rendering is what makes it safe)', () => {
        expect(sanitizeTitle('<img src=x onerror="alert(1)">')).toBe('<img src=x onerror="alert(1)">');
    });
});

describe('sanitizeText / sanitizeDescription', () => {
    it('sanitizeText honours the given cap', () => {
        expect(sanitizeText('abcdef', 4)).toBe('abc…');
    });

    it('sanitizeDescription allows URL-looking text but caps at 300', () => {
        expect(sanitizeDescription('https://example.com/')).toBe('https://example.com/');
        expect(sanitizeDescription('x'.repeat(1000)).length).toBe(300);
    });
});
