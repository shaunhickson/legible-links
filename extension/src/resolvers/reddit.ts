import { fetchOEmbed, oembedEndpoint, stringField } from './oembed';
import { PlatformResolver } from './types';

const HOSTS = new Set(['reddit.com', 'www.reddit.com', 'old.reddit.com', 'new.reddit.com', 'np.reddit.com', 'm.reddit.com']);
const NAME = /^[A-Za-z0-9_]{1,21}$/;
const POST_ID = /^[a-z0-9]{1,12}$/i;

/** `/r/<sub>/comments/<id>` in any host form; the slug (if any) is ignored here. */
export function redditPost(u: URL): { sub: string; id: string } | null {
    if (!HOSTS.has(u.hostname.toLowerCase())) return null;
    const [r, sub, comments, id] = u.pathname.split('/').filter((s) => s !== '');
    if (r !== 'r' || !sub || comments !== 'comments' || !id || !NAME.test(sub) || !POST_ID.test(id)) return null;
    return { sub, id };
}

export const reddit: PlatformResolver = {
    id: 'reddit',
    tier: 'A',
    canHandle: (u) => redditPost(u) !== null,
    async resolve(u, ctx) {
        const post = redditPost(u);
        if (!post) return null;
        const endpoint = oembedEndpoint('https://www.reddit.com/oembed', `https://www.reddit.com/r/${post.sub}/comments/${post.id}/`);
        const data = await fetchOEmbed(endpoint, ctx);
        if (!data) return null;
        const title = stringField(data, 'title');
        if (!title) return null;
        const author = stringField(data, 'author_name');
        return { title, description: author ? `u/${author}` : undefined, platform: 'reddit' };
    },
};
