import { fetchOEmbed, oembedEndpoint, stringField } from './oembed';
import { PlatformResolver } from './types';

const VIDEO_ID = /^\d{1,12}$/;

export function vimeoVideoId(u: URL): string | null {
    const host = u.hostname.toLowerCase();
    if (host !== 'vimeo.com' && host !== 'www.vimeo.com') return null;
    const [id, ...rest] = u.pathname.split('/').filter((s) => s !== '');
    if (!id || rest.length > 0 || !VIDEO_ID.test(id)) return null;
    return id;
}

export const vimeo: PlatformResolver = {
    id: 'vimeo',
    tier: 'A',
    canHandle: (u) => vimeoVideoId(u) !== null,
    async resolve(u, ctx) {
        const id = vimeoVideoId(u);
        if (!id) return null;
        const endpoint = oembedEndpoint('https://vimeo.com/api/oembed.json', `https://vimeo.com/${id}`);
        const data = await fetchOEmbed(endpoint, ctx);
        if (!data) return null;
        const title = stringField(data, 'title');
        if (!title) return null;
        return { title, description: stringField(data, 'author_name'), platform: 'vimeo' };
    },
};
