export const MAX_TITLE_LENGTH = 120;
export const MAX_DESCRIPTION_LENGTH = 300;

// C0 controls (except tab/newline/CR, which fold into a space below), DEL, and C1 controls.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x08\x0E-\x1F\x7F-\x9F]/gu;
// Zero-width characters, bidi overrides/isolates and other invisible formatting characters.
const INVISIBLE_CHARS = /[\u{200B}-\u{200F}\u{202A}-\u{202E}\u{2060}-\u{2064}\u{2066}-\u{2069}\u{FEFF}\u{061C}\u{180E}]/gu;
const WHITESPACE = /\s+/gu;

/**
 * Normalizes untrusted text for display: NFC, no control or invisible characters,
 * single spaces, trimmed, and capped at `maxLength` code points (with an ellipsis).
 */
export function sanitizeText(raw: unknown, maxLength: number): string {
    if (typeof raw !== 'string') return '';
    let s = raw.normalize('NFC');
    s = s.replace(INVISIBLE_CHARS, '').replace(CONTROL_CHARS, '');
    s = s.replace(WHITESPACE, ' ').trim();
    const chars = Array.from(s);
    if (chars.length > maxLength) {
        s = chars.slice(0, maxLength - 1).join('').trimEnd() + '…';
    }
    return s;
}

// A title that is itself a URL: has a scheme, starts with www., or is a bare
// host followed by a path with no spaces ("paypal.com/login"). Plain names
// with a dot ("Node.js", "example.com") are ordinary text and are allowed.
const LOOKS_LIKE_URL = /^(?:[a-z][a-z0-9+.-]*:\/\/|www\.|[^\s/]+\.[a-z]{2,}\/\S*$)/i;

export function looksLikeUrl(s: string): boolean {
    return LOOKS_LIKE_URL.test(s.trim());
}

/**
 * Sanitizes a backend-supplied title. Returns '' when the result is empty or
 * is itself a URL: replacing a raw link with text that impersonates another
 * URL is exactly the spoof this extension must not enable.
 */
export function sanitizeTitle(raw: unknown): string {
    const s = sanitizeText(raw, MAX_TITLE_LENGTH);
    if (s === '' || looksLikeUrl(s)) return '';
    return s;
}

export function sanitizeDescription(raw: unknown): string {
    return sanitizeText(raw, MAX_DESCRIPTION_LENGTH);
}
