import { fetchOEmbed, oembedEndpoint, stringField } from './oembed';
import { PlatformResolver } from './types';

const KINDS = new Set(['track', 'album', 'playlist', 'artist', 'episode', 'show']);
const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;

/** `open.spotify.com/<kind>/<id>`, also behind an `intl-xx` locale prefix. */
export function spotifyTarget(u: URL): { kind: string; id: string } | null {
    if (u.hostname.toLowerCase() !== 'open.spotify.com') return null;
    const segments = u.pathname.split('/').filter((s) => s !== '');
    if (segments[0]?.startsWith('intl-')) segments.shift();
    const [kind, id] = segments;
    if (!kind || !id || !KINDS.has(kind) || !SPOTIFY_ID.test(id)) return null;
    return { kind, id };
}

export const spotify: PlatformResolver = {
    id: 'spotify',
    tier: 'A',
    canHandle: (u) => spotifyTarget(u) !== null,
    async resolve(u, ctx) {
        const target = spotifyTarget(u);
        if (!target) return null;
        const endpoint = oembedEndpoint('https://open.spotify.com/oembed', `https://open.spotify.com/${target.kind}/${target.id}`);
        const data = await fetchOEmbed(endpoint, ctx);
        if (!data) return null;
        const title = stringField(data, 'title');
        if (!title) return null;
        return { title, platform: 'spotify' };
    },
};
