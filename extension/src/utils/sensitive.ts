/**
 * Decides which URLs may leave the browser and which anchors may be rewritten.
 * Everything here fails closed: when in doubt, the link is left alone.
 */

const SKIP_HOST_SUFFIXES = [
    '.local', '.localhost', '.internal', '.onion', '.home.arpa', '.corp', '.lan',
    '.intranet', '.test', '.example', '.invalid',
];

// Query parameter names, compared after lowercasing and stripping non-alphanumerics
// (so `access_token`, `Access-Token` and `accessToken` all become `accesstoken`).
const SENSITIVE_PARAMS = new Set([
    'token', 'accesstoken', 'refreshtoken', 'idtoken', 'key', 'apikey', 'sig', 'signature',
    'code', 'otp', 'secret', 'password', 'passwd', 'pwd', 'session', 'sessionid', 'sid',
    'reset', 'resettoken', 'verify', 'verification', 'confirm', 'confirmation',
    'unsubscribe', 'invite', 'invitation', 'magic', 'jwt', 'auth', 'authorization',
    'xamzsignature', 'xamzcredential',
]);

const SENSITIVE_SEGMENTS = new Set([
    'reset', 'reset-password', 'verify', 'verify-email', 'confirm', 'unsubscribe',
    'invite', 'invitation', 'magic', 'magic-link', 'auth', 'oauth', 'callback',
    'signin', 'sign-in', 'login', 'activate', 'activation', 'sso',
]);

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

function safeDecode(segment: string): string {
    try {
        return decodeURIComponent(segment);
    } catch {
        return segment;
    }
}

/**
 * 'skip' for anything that looks private, local, authenticated, or single-use.
 */
export function classifyUrl(href: string): 'ok' | 'skip' {
    let u: URL;
    try {
        u = new URL(href);
    } catch {
        return 'skip';
    }

    if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'skip';
    if (u.username || u.password) return 'skip';

    const host = u.hostname.toLowerCase();
    if (!host) return 'skip';
    if (host.startsWith('[')) return 'skip'; // bracketed IPv6 literal
    if (IPV4.test(host)) return 'skip';
    if (host === 'localhost' || !host.includes('.')) return 'skip';
    if (SKIP_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return 'skip';

    if (u.port && u.port !== '80' && u.port !== '443') return 'skip';

    for (const name of u.searchParams.keys()) {
        const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (SENSITIVE_PARAMS.has(normalized)) return 'skip';
    }

    for (const segment of u.pathname.split('/')) {
        if (!segment) continue;
        if (SENSITIVE_SEGMENTS.has(safeDecode(segment).toLowerCase())) return 'skip';
    }

    return 'ok';
}

const HOST_EQUIVALENTS: Record<string, string> = {
    'youtu.be': 'youtube.com',
    'm.youtube.com': 'youtube.com',
    'x.com': 'twitter.com',
    'mobile.twitter.com': 'twitter.com',
};

function canonicalHost(hostname: string): string {
    let host = hostname.toLowerCase();
    if (host.startsWith('www.')) host = host.slice(4);
    return Object.prototype.hasOwnProperty.call(HOST_EQUIVALENTS, host) ? HOST_EQUIVALENTS[host] : host;
}

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * When the visible text names a host, it must be the host the link goes to.
 * Text that names no host (plain words) has nothing to compare, so it passes.
 */
export function textDomainMatchesHref(text: string, href: string): boolean {
    const trimmed = text.trim();
    let textHost: string;
    try {
        textHost = new URL(HAS_SCHEME.test(trimmed) ? trimmed : 'https://' + trimmed).hostname;
    } catch {
        return true;
    }
    if (!textHost || !textHost.includes('.')) return true;

    let hrefHost: string;
    try {
        hrefHost = new URL(href).hostname;
    } catch {
        return false;
    }
    return canonicalHost(textHost) === canonicalHost(hrefHost);
}

function isEditableElement(el: Element): boolean {
    const tag = el.localName;
    if (tag === 'textarea' || tag === 'input') return true;
    const contentEditable = el.getAttribute('contenteditable');
    if (contentEditable !== null) {
        const value = contentEditable.toLowerCase();
        if (value === '' || value === 'true' || value === 'plaintext-only') return true;
    }
    const role = el.getAttribute('role');
    if (role !== null) {
        const value = role.toLowerCase();
        if (value === 'textbox' || value === 'combobox') return true;
    }
    return false;
}

/**
 * True when the element sits inside anything the user can type into
 * (walking out through shadow roots), or the document is in design mode.
 */
export function isEditableContext(el: Element): boolean {
    const doc = el.ownerDocument;
    if (doc && typeof doc.designMode === 'string' && doc.designMode.toLowerCase() === 'on') return true;

    let node: Node | null = el;
    while (node) {
        if (node.nodeType === 1 && isEditableElement(node as Element)) return true;
        const parent: Node | null = node.parentNode;
        if (parent) {
            node = parent;
        } else {
            const root = node.getRootNode();
            node = root instanceof ShadowRoot ? root.host : null;
        }
    }
    return false;
}

// ---------------------------------------------------------------------------
// What is removed before a URL leaves the browser, and what never leaves at all
// via the generic tier.

// Tracking parameters carry campaign and click identifiers, never content.
const TRACKING_PARAMS = new Set([
    'fbclid', 'gclid', 'dclid', 'msclkid', 'mc_cid', 'mc_eid', 'igshid', 'si', 'ref_src', 'ref_url',
    'feature', '_hsenc', '_hsmi', 'vero_id', 'yclid', 'twclid', 'ttclid', 'gbraid', 'wbraid',
]);

function isTrackingParam(rawName: string): boolean {
    const name = safeDecode(rawName.replace(/\+/g, ' ')).toLowerCase();
    return name.startsWith('utm_') || TRACKING_PARAMS.has(name);
}

/**
 * The form of a URL that may be sent anywhere: no fragment, no tracking parameters.
 * Surviving parameters keep their original encoding and order. Also the cache key.
 */
export function stripForTransmission(href: string): string {
    let u: URL;
    try {
        u = new URL(href);
    } catch {
        return href;
    }
    u.hash = '';
    if (u.search.length > 1) {
        const kept = u.search.slice(1).split('&').filter((pair) => {
            if (pair === '') return false;
            const eq = pair.indexOf('=');
            return !isTrackingParam(eq === -1 ? pair : pair.slice(0, eq));
        });
        u.search = kept.length > 0 ? '?' + kept.join('&') : '';
    }
    return u.href;
}

// Pages whose links are overwhelmingly private: webmail, chat, and documents.
// Links on these pages are resolved through our server only on an explicit hover.
const SENSITIVE_PAGE_HOSTS = new Set([
    'mail.google.com', 'mail.yahoo.com', 'mail.proton.me',
    'app.slack.com', 'discord.com', 'teams.microsoft.com', 'web.whatsapp.com', 'web.telegram.org', 'www.messenger.com',
    'docs.google.com', 'drive.google.com', 'www.notion.so',
]);

const SENSITIVE_PAGE_SUFFIXES = ['.slack.com', '.notion.site', '.atlassian.net', '.zendesk.com', '.freshdesk.com', '.intercom.io'];

/**
 * True for webmail, chat and document hosts. Only disables *automatic* Tier B
 * resolution; hover still works, and Tier 0/A are unaffected.
 */
export function isSensitivePageHost(host: string): boolean {
    const h = host.toLowerCase().replace(/\.$/, '');
    if (!h) return false;
    if (SENSITIVE_PAGE_HOSTS.has(h)) return true;
    if (h === 'outlook.com' || h.startsWith('outlook.')) return true; // outlook.live.com, outlook.office.com, ...
    return SENSITIVE_PAGE_SUFFIXES.some((suffix) => h.endsWith(suffix));
}

const HEX_32 = /^[0-9a-f]{32,}$/i;

function isHighEntropy(value: string): boolean {
    if (HEX_32.test(value.replace(/-/g, ''))) return true; // hashes, UUIDs
    for (const run of value.split(/[^A-Za-z0-9]+/)) {
        if (run.length >= 20 && /[A-Za-z]/.test(run) && /[0-9]/.test(run)) return true;
    }
    return false;
}

/**
 * True when a path segment or query value looks like an opaque identifier:
 * a separator-free run of 20+ characters mixing letters and digits, or 32+ hex
 * digits. Such URLs are often private share links, so the generic tier never
 * sees them. Hyphenated slugs that merely contain a year do not trip this.
 */
export function hasHighEntropySegment(href: string): boolean {
    let u: URL;
    try {
        u = new URL(href);
    } catch {
        return false;
    }
    for (const segment of u.pathname.split('/')) {
        if (segment && isHighEntropy(safeDecode(segment))) return true;
    }
    for (const value of u.searchParams.values()) {
        if (isHighEntropy(value)) return true;
    }
    return false;
}
