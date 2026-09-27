/**
 * Tier A resolvers against real oEmbed responses captured in __fixtures__/.
 * Each table lists which URL forms are handled, the exact endpoint contacted,
 * and what comes back.
 */
import { describe, expect, it, vi } from 'vitest';
import redditFixture from './__fixtures__/reddit.json';
import spotifyFixture from './__fixtures__/spotify.json';
import vimeoFixture from './__fixtures__/vimeo.json';
import xFixture from './__fixtures__/x.json';
import youtubeFixture from './__fixtures__/youtube.json';
import { fetchOEmbed, OEmbedHttpError } from './oembed';
import { PLATFORM_RESOLVERS } from './index';
import { reddit } from './reddit';
import { spotify } from './spotify';
import { FetchFn, PlatformResolver } from './types';
import { vimeo } from './vimeo';
import { decodeEntities, firstParagraphText, stripTags, x, X_TITLE_MAX } from './x';
import { youtube } from './youtube';

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function fetchReturning(response: Response | (() => Response | Promise<Response>)) {
    return vi.fn<FetchFn>(async () => (typeof response === 'function' ? response() : response));
}

function handles(resolver: PlatformResolver, rows: [url: string, handled: boolean][]) {
    it.each(rows)('canHandle(%s) is %s', (url, handled) => {
        expect(resolver.canHandle(new URL(url))).toBe(handled);
    });
}

async function resolveWith(resolver: PlatformResolver, url: string, body: unknown) {
    const fetchFn = fetchReturning(json(body));
    const result = await resolver.resolve(new URL(url), { fetchFn });
    return { result, fetchFn, endpoint: fetchFn.mock.calls[0]?.[0], init: fetchFn.mock.calls[0]?.[1] };
}

describe('fetchOEmbed', () => {
    it('sends one GET with no cookies, no referrer, no HTTP cache, and the timeout signal', async () => {
        const fetchFn = fetchReturning(json({ title: 'T' }));
        const signal = new AbortController().signal;
        await fetchOEmbed('https://platform.example/oembed?url=x', { fetchFn, signal });
        expect(fetchFn).toHaveBeenCalledTimes(1);
        const [url, init] = fetchFn.mock.calls[0];
        expect(url).toBe('https://platform.example/oembed?url=x');
        expect(init).toMatchObject({ method: 'GET', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal });
    });

    it('throws OEmbedHttpError with the status on non-2xx', async () => {
        const fetchFn = fetchReturning(json({ error: 'nope' }, 404));
        await expect(fetchOEmbed('https://p.example/o', { fetchFn })).rejects.toBeInstanceOf(OEmbedHttpError);
        await expect(fetchOEmbed('https://p.example/o', { fetchFn })).rejects.toMatchObject({ status: 404 });
    });

    it('returns null for a body that is not a JSON object', async () => {
        expect(await fetchOEmbed('https://p.example/o', { fetchFn: fetchReturning(new Response('<html>', { status: 200 })) })).toBeNull();
        expect(await fetchOEmbed('https://p.example/o', { fetchFn: fetchReturning(json([1, 2])) })).toBeNull();
        expect(await fetchOEmbed('https://p.example/o', { fetchFn: fetchReturning(json('str')) })).toBeNull();
    });

    it('propagates network failures', async () => {
        const fetchFn = vi.fn(async () => {
            throw new TypeError('Failed to fetch');
        });
        await expect(fetchOEmbed('https://p.example/o', { fetchFn })).rejects.toThrow('Failed to fetch');
    });
});

describe('registry', () => {
    it('lists the five platform resolvers in order', () => {
        expect(PLATFORM_RESOLVERS.map((r) => r.id)).toEqual(['youtube', 'spotify', 'x', 'reddit', 'vimeo']);
        expect(PLATFORM_RESOLVERS.every((r) => r.tier === 'A')).toBe(true);
    });
});

describe('youtube', () => {
    handles(youtube, [
        ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', true],
        ['https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s', true],
        ['https://m.youtube.com/watch?v=dQw4w9WgXcQ', true],
        ['https://music.youtube.com/watch?v=dQw4w9WgXcQ', true],
        ['https://youtu.be/dQw4w9WgXcQ', true],
        ['https://youtu.be/dQw4w9WgXcQ?si=abc', true],
        ['https://www.youtube.com/shorts/dQw4w9WgXcQ', true],
        ['https://www.youtube.com/live/dQw4w9WgXcQ', true],
        ['https://www.youtube.com/embed/dQw4w9WgXcQ', true],
        ['https://www.youtube.com/v/dQw4w9WgXcQ', true],
        ['https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', true],
        ['https://www.youtube.com/watch?v=short', false],
        ['https://www.youtube.com/watch?v=SPA', false],
        ['https://www.youtube.com/playlist?list=PLxyz', false],
        ['https://www.youtube.com/@RickAstleyYT', false],
        ['https://www.youtube.com/', false],
        ['https://youtu.be/', false],
        ['https://www.youtube.com.evil.example/watch?v=dQw4w9WgXcQ', false],
        ['https://example.com/watch?v=dQw4w9WgXcQ', false],
    ]);

    it('canonicalises every form to the same oEmbed endpoint', async () => {
        const endpoint = 'https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ&format=json';
        for (const url of ['https://youtu.be/dQw4w9WgXcQ?si=tracking', 'https://www.youtube.com/shorts/dQw4w9WgXcQ', 'https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=1']) {
            const { endpoint: called } = await resolveWith(youtube, url, youtubeFixture);
            expect(called, url).toBe(endpoint);
        }
    });

    it('returns the title, the channel as description, and platform youtube', async () => {
        const { result, init } = await resolveWith(youtube, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', youtubeFixture);
        expect(result).toEqual({
            title: 'Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)',
            description: 'Rick Astley',
            platform: 'youtube',
        });
        expect(init?.credentials).toBe('omit');
    });

    it('returns null without a title', async () => {
        expect((await resolveWith(youtube, 'https://youtu.be/dQw4w9WgXcQ', { author_name: 'x' })).result).toBeNull();
        expect((await resolveWith(youtube, 'https://youtu.be/dQw4w9WgXcQ', { title: '   ' })).result).toBeNull();
    });

    it('lets HTTP errors through for the router to classify', async () => {
        const fetchFn = fetchReturning(json({}, 401));
        await expect(youtube.resolve(new URL('https://youtu.be/dQw4w9WgXcQ'), { fetchFn })).rejects.toMatchObject({ status: 401 });
    });
});

describe('spotify', () => {
    handles(spotify, [
        ['https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT', true],
        ['https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=abc', true],
        ['https://open.spotify.com/album/4cOdK2wGLETKBW3PvgPWqT', true],
        ['https://open.spotify.com/playlist/4cOdK2wGLETKBW3PvgPWqT', true],
        ['https://open.spotify.com/artist/4cOdK2wGLETKBW3PvgPWqT', true],
        ['https://open.spotify.com/episode/4cOdK2wGLETKBW3PvgPWqT', true],
        ['https://open.spotify.com/show/4cOdK2wGLETKBW3PvgPWqT', true],
        ['https://open.spotify.com/intl-de/track/4cOdK2wGLETKBW3PvgPWqT', true],
        ['https://open.spotify.com/user/someone', false],
        ['https://open.spotify.com/track/short', false],
        ['https://open.spotify.com/', false],
        ['https://spotify.com/track/4cOdK2wGLETKBW3PvgPWqT', false],
        ['https://play.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT', false],
    ]);

    it('asks the oEmbed endpoint for the canonical URL and returns the title', async () => {
        const { result, endpoint } = await resolveWith(spotify, 'https://open.spotify.com/intl-de/track/4cOdK2wGLETKBW3PvgPWqT?si=x', spotifyFixture);
        expect(endpoint).toBe('https://open.spotify.com/oembed?url=https%3A%2F%2Fopen.spotify.com%2Ftrack%2F4cOdK2wGLETKBW3PvgPWqT');
        expect(result).toEqual({ title: 'Never Gonna Give You Up', platform: 'spotify' });
    });
});

describe('x', () => {
    handles(x, [
        ['https://twitter.com/jack/status/20', true],
        ['https://x.com/jack/status/20', true],
        ['https://mobile.twitter.com/jack/status/20', true],
        ['https://www.x.com/jack/status/20?s=20', true],
        ['https://x.com/jack', false],
        ['https://x.com/jack/status/', false],
        ['https://x.com/jack/status/abc', false],
        ['https://x.com/i/web/status/20', false],
        ['https://x.com/way_too_long_handle_here/status/20', false],
        ['https://t.co/abc', false],
    ]);

    it('asks publish.x.com for the twitter.com form with omit_script', async () => {
        const { endpoint } = await resolveWith(x, 'https://x.com/jack/status/20?s=20', xFixture);
        expect(endpoint).toBe('https://publish.x.com/oembed?url=https%3A%2F%2Ftwitter.com%2Fjack%2Fstatus%2F20&omit_script=true');
    });

    it('builds "@handle: text" from the first paragraph and author_url', async () => {
        const { result } = await resolveWith(x, 'https://twitter.com/jack/status/20', xFixture);
        expect(result).toEqual({ title: '@jack: just setting up my twttr', platform: 'x' });
    });

    it('decodes entities and strips tags from the paragraph, in that order', async () => {
        const html = '<blockquote class="twitter-tweet"><p lang="en" dir="ltr">Tom &amp; Jerry &lt;script&gt;alert(1)&lt;/script&gt; <a href="https://t.co/x">link</a><br>next &#8212; &#x1F600; &mdash; &quot;q&quot;</p>&mdash; Someone (@someone)</blockquote>';
        const { result } = await resolveWith(x, 'https://x.com/someone/status/1', { html, author_url: 'https://x.com/someone' });
        expect(result?.title).toBe('@someone: Tom & Jerry <script>alert(1)</script> link next — 😀 — "q"');
    });

    it('caps the title at 100 characters', async () => {
        const html = `<p>${'word '.repeat(40)}</p>`;
        const { result } = await resolveWith(x, 'https://x.com/someone/status/1', { html, author_url: 'https://x.com/someone' });
        expect(Array.from(result!.title).length).toBeLessThanOrEqual(X_TITLE_MAX);
        expect(result!.title.endsWith('…')).toBe(true);
    });

    it('falls back to the handle in the link when author_url is missing or odd', async () => {
        const html = '<p>hi</p>';
        expect((await resolveWith(x, 'https://x.com/fromlink/status/1', { html })).result?.title).toBe('@fromlink: hi');
        expect((await resolveWith(x, 'https://x.com/fromlink/status/1', { html, author_url: 'not a url' })).result?.title).toBe('@fromlink: hi');
        expect((await resolveWith(x, 'https://x.com/fromlink/status/1', { html, author_url: 'https://x.com/' })).result?.title).toBe('@fromlink: hi');
    });

    it('returns null without a paragraph', async () => {
        expect((await resolveWith(x, 'https://x.com/a/status/1', { html: '<blockquote>no p</blockquote>' })).result).toBeNull();
        expect((await resolveWith(x, 'https://x.com/a/status/1', { html: '<p></p>' })).result).toBeNull();
        expect((await resolveWith(x, 'https://x.com/a/status/1', { author_url: 'https://x.com/a' })).result).toBeNull();
    });

    describe('string helpers', () => {
        it.each<[string, string]>([
            ['&amp;&lt;&gt;&quot;&apos;', '&<>"\''],
            ['&#65;&#x42;&#X43;', 'ABC'],
            ['&nbsp;&mdash;&ndash;&hellip;', ' —–…'],
            ['&unknown;', '&unknown;'],
            ['&#0;&#xD800;&#1114112;', '&#0;&#xD800;&#1114112;'],
            ['no entities', 'no entities'],
        ])('decodeEntities(%s)', (input, expected) => {
            expect(decodeEntities(input)).toBe(expected);
        });

        it('stripTags removes tags and turns <br> into spaces', () => {
            expect(stripTags('a<br>b<br/>c<BR />d<span class="x">e</span>')).toBe('a b c de');
        });

        it('firstParagraphText takes only the first paragraph', () => {
            expect(firstParagraphText('<p>one</p><p>two</p>')).toBe('one');
            expect(firstParagraphText('<P lang="en">multi\nline</P>')).toBe('multi\nline');
            expect(firstParagraphText('<div>none</div>')).toBeNull();
        });
    });
});

describe('reddit (oEmbed)', () => {
    handles(reddit, [
        ['https://www.reddit.com/r/programming/comments/1g7f0j9/', true],
        ['https://www.reddit.com/r/programming/comments/1g7f0j9', true],
        ['https://old.reddit.com/r/programming/comments/1g7f0j9/some_slug/', true],
        ['https://www.reddit.com/r/programming/', false],
        ['https://www.reddit.com/user/spez', false],
        ['https://www.reddit.com/r/programming/s/AbCdEf', false],
        ['https://redd.it/1g7f0j9', false],
        ['https://www.reddit.com/r/programming/comments/not%20ok/', false],
    ]);

    it('asks www.reddit.com for the canonical post URL and returns title and author', async () => {
        const { result, endpoint } = await resolveWith(reddit, 'https://old.reddit.com/r/programming/comments/1g7f0j9', redditFixture);
        expect(endpoint).toBe('https://www.reddit.com/oembed?url=https%3A%2F%2Fwww.reddit.com%2Fr%2Fprogramming%2Fcomments%2F1g7f0j9%2F');
        expect(result).toEqual({
            title: 'What are some of the biggest housing projects going on in BC?',
            description: 'u/iv2892',
            platform: 'reddit',
        });
    });

    it('omits the description without an author', async () => {
        const { result } = await resolveWith(reddit, 'https://www.reddit.com/r/a/comments/b1', { title: 'T' });
        expect(result).toEqual({ title: 'T', description: undefined, platform: 'reddit' });
    });
});

describe('vimeo', () => {
    handles(vimeo, [
        ['https://vimeo.com/1084537', true],
        ['https://www.vimeo.com/1084537', true],
        ['https://vimeo.com/1084537?share=copy', true],
        ['https://vimeo.com/channels/staffpicks/1084537', false],
        ['https://vimeo.com/user123', false],
        ['https://vimeo.com/1084537/abcdef', false],
        ['https://player.vimeo.com/video/1084537', false],
        ['https://vimeo.com/', false],
    ]);

    it('asks the JSON oEmbed endpoint and returns title and author', async () => {
        const { result, endpoint } = await resolveWith(vimeo, 'https://vimeo.com/1084537?share=copy', vimeoFixture);
        expect(endpoint).toBe('https://vimeo.com/api/oembed.json?url=https%3A%2F%2Fvimeo.com%2F1084537');
        expect(result).toEqual({ title: 'Big Buck Bunny', description: 'Blender', platform: 'vimeo' });
    });
});
