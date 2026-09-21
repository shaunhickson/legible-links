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
