import { fetchOEmbed, oembedEndpoint, stringField } from './oembed';
import { PlatformResolver } from './types';

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
/** Public playlist ids (PL…, UU…, OLAK5uy_…) are 18 to 41 characters; WL and LL are per-user and never public. */
const PLAYLIST_ID = /^[A-Za-z0-9_-]{13,64}$/;
const HOSTS = new Set([
    'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com',
    'youtube-nocookie.com', 'www.youtube-nocookie.com',
]);
const PATH_KINDS = new Set(['shorts', 'live', 'embed', 'v']);

export type YouTubeTarget = { kind: 'video'; id: string } | { kind: 'playlist'; id: string };

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

/** The playlist id of a `/playlist?list=<id>` URL on youtube.com or music.youtube.com. */
export function youtubePlaylistId(u: URL): string | null {
    if (!HOSTS.has(u.hostname.toLowerCase())) return null;
    const segments = u.pathname.split('/').filter((s) => s !== '');
    if (segments.length !== 1 || segments[0] !== 'playlist') return null;
    const id = u.searchParams.get('list');
    return id !== null && PLAYLIST_ID.test(id) ? id : null;
}

/** A video wins over a playlist: `watch?v=…&list=…` is the video. */
export function youtubeTarget(u: URL): YouTubeTarget | null {
    const video = youtubeVideoId(u);
    if (video) return { kind: 'video', id: video };
    const playlist = youtubePlaylistId(u);
    if (playlist) return { kind: 'playlist', id: playlist };
    return null;
}

export function canonicalYouTubeUrl(target: YouTubeTarget | string): string {
    if (typeof target === 'string') return `https://www.youtube.com/watch?v=${target}`;
    return target.kind === 'video'
        ? `https://www.youtube.com/watch?v=${target.id}`
        : `https://www.youtube.com/playlist?list=${target.id}`;
}

export const youtube: PlatformResolver = {
    id: 'youtube',
    tier: 'A',
    canHandle: (u) => youtubeTarget(u) !== null,
    async resolve(u, ctx) {
        const target = youtubeTarget(u);
        if (!target) return null;
        const endpoint = oembedEndpoint('https://www.youtube.com/oembed', canonicalYouTubeUrl(target), { format: 'json' });
        const data = await fetchOEmbed(endpoint, ctx);
        if (!data) return null;
        const title = stringField(data, 'title');
        if (!title) return null;
        return { title, description: stringField(data, 'author_name'), platform: 'youtube' };
    },
};
