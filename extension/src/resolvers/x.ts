import { sanitizeText } from '../utils/sanitize';
import { fetchOEmbed, oembedEndpoint, stringField } from './oembed';
import { PlatformResolver } from './types';

export const X_TITLE_MAX = 100;

const HOSTS = new Set(['twitter.com', 'www.twitter.com', 'mobile.twitter.com', 'x.com', 'www.x.com', 'mobile.x.com']);
const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const STATUS_ID = /^\d+$/;

export function xStatus(u: URL): { user: string; id: string } | null {
    if (!HOSTS.has(u.hostname.toLowerCase())) return null;
    const [user, kind, id] = u.pathname.split('/').filter((s) => s !== '');
    if (!user || kind !== 'status' || !id || !HANDLE.test(user) || !STATUS_ID.test(id)) return null;
    return { user, id };
}

const NAMED_ENTITIES: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    mdash: '—', ndash: '–', hellip: '…',
    lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
    laquo: '«', raquo: '»', bull: '•', middot: '·',
    copy: '©', reg: '®', trade: '™', euro: '€', pound: '£', yen: '¥',
};

export function decodeEntities(s: string): string {
    return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, body: string) => {
        if (body[0] === '#') {
            const hex = body[1] === 'x' || body[1] === 'X';
            const cp = hex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
            if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return match;
            return String.fromCodePoint(cp);
        }
        return NAMED_ENTITIES[body.toLowerCase()] ?? match;
    });
}

/** Tags out first, entities second: `&lt;b&gt;` must survive as literal text. */
export function stripTags(html: string): string {
    return html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '');
}

/** The text of the first `<p>` in an oEmbed `html` blob, as plain text. */
export function firstParagraphText(html: string): string | null {
    const m = /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(html);
    if (!m) return null;
    return decodeEntities(stripTags(m[1]));
}

function handleFromAuthorUrl(authorUrl: string | undefined): string | null {
    if (!authorUrl) return null;
    let u: URL;
    try {
        u = new URL(authorUrl);
    } catch {
        return null;
    }
    const last = u.pathname.split('/').filter((s) => s !== '').pop();
    return last && HANDLE.test(last) ? last : null;
}

export const x: PlatformResolver = {
    id: 'x',
    tier: 'A',
    canHandle: (u) => xStatus(u) !== null,
    async resolve(u, ctx) {
        const status = xStatus(u);
        if (!status) return null;
        const endpoint = oembedEndpoint(
            'https://publish.x.com/oembed',
            `https://twitter.com/${status.user}/status/${status.id}`,
            { omit_script: 'true' },
        );
        const data = await fetchOEmbed(endpoint, ctx);
        if (!data) return null;
        const html = stringField(data, 'html');
        const text = html ? firstParagraphText(html) : null;
        if (!text) return null;
        const handle = handleFromAuthorUrl(stringField(data, 'author_url')) ?? status.user;
        const title = sanitizeText(`@${handle}: ${text}`, X_TITLE_MAX);
        if (!title) return null;
        return { title, platform: 'x' };
    },
};
