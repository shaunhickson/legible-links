import { fetchOEmbed, oembedEndpoint, stringField } from './oembed';
import { PlatformResolver } from './types';

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const HOSTS = new Set([
    'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com',
    'youtube-nocookie.com', 'www.youtube-nocookie.com',
]);
const PATH_KINDS = new Set(['shorts', 'live', 'embed', 'v']);

/** Extracts the 11-character video id from any of YouTube's URL forms. */
export function youtubeVideoId(u: URL): string | null {
    const host = u.hostname.toLowerCase();
    const segments = u.pathname.split('/').filter((s) => s !== '');
    let id: string | undefined;
    if (host === 'youtu.be') {
        id = segments[0];
    } else if (HOSTS.has(host)) {
        if (segments[0] === 'watch') {
            id = u.searchParams.get('v') ?? undefined;
        } else if (segments.length === 2 && PATH_KINDS.has(segments[0])) {
            id = segments[1];
        }
    }
    return id !== undefined && VIDEO_ID.test(id) ? id : null;
}

export function canonicalYouTubeUrl(id: string): string {
    return `https://www.youtube.com/watch?v=${id}`;
}

export const youtube: PlatformResolver = {
    id: 'youtube',
    tier: 'A',
    canHandle: (u) => youtubeVideoId(u) !== null,
    async resolve(u, ctx) {
        const id = youtubeVideoId(u);
        if (!id) return null;
        const endpoint = oembedEndpoint('https://www.youtube.com/oembed', canonicalYouTubeUrl(id), { format: 'json' });
        const data = await fetchOEmbed(endpoint, ctx);
        if (!data) return null;
        const title = stringField(data, 'title');
        if (!title) return null;
        return { title, description: stringField(data, 'author_name'), platform: 'youtube' };
    },
};
