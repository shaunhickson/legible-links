import { describe, expect, it } from 'vitest';
import { amazon, github, LOCAL_RESOLVERS, redditLocal, stackoverflow, wikipedia } from './local';
import { LocalResolver } from './types';

type Row = [url: string, title: string | null, description?: string];

function table(resolver: LocalResolver, rows: Row[]) {
    it.each(rows)('%s -> %s', (url, title, description) => {
        const u = new URL(url);
        expect(resolver.canHandle(u)).toBe(title !== null);
        const result = resolver.resolve(u);
        if (title === null) {
            expect(result).toBeNull();
        } else {
            expect(result?.title).toBe(title);
            expect(result?.platform).toBe(resolver.id === 'reddit-local' ? 'reddit' : resolver.id);
            if (description !== undefined) expect(result?.description).toBe(description);
        }
    });
}

describe('Tier 0 resolvers never touch the network', () => {
    it('are all tier 0 and synchronous', () => {
        for (const r of LOCAL_RESOLVERS) {
            expect(r.tier).toBe(0);
            expect(r.resolve.length).toBe(1);
        }
    });
});

describe('wikipedia', () => {
    table(wikipedia, [
        ['https://en.wikipedia.org/wiki/Alan_Turing', 'Alan Turing', 'en.wikipedia.org'],
        ['https://de.wikipedia.org/wiki/K%C3%B6ln', 'Köln', 'de.wikipedia.org'],
        ['https://en.m.wikipedia.org/wiki/Mobile_page', 'Mobile page', 'en.wikipedia.org'],
        ['https://simple.wikipedia.org/wiki/Earth', 'Earth', 'simple.wikipedia.org'],
        ['https://zh-yue.wikipedia.org/wiki/%E9%A6%99%E6%B8%AF', '香港', 'zh-yue.wikipedia.org'],
        ['https://en.wikipedia.org/wiki/C%2B%2B', 'C++'],
        ['https://en.wikipedia.org/wiki/AC/DC', 'AC/DC'],
        ['https://en.wikipedia.org/wiki/Category:Physics', 'Category:Physics'],
        ['https://en.wikipedia.org/wiki/Special:Random', null],
        ['https://en.wikipedia.org/wiki/', null],
        ['https://en.wikipedia.org/w/index.php?title=Alan_Turing', null],
        ['https://www.wikipedia.org/', null],
        ['https://wikipedia.org/wiki/Foo', null],
        ['https://en.wikipedia.org.evil.example/wiki/Foo', null],
        ['https://en.wikipedia.org/', null],
    ]);
});

describe('github', () => {
    table(github, [
        ['https://github.com/shaunhickson/legible-links', 'shaunhickson/legible-links'],
        ['https://github.com/shaunhickson/legible-links/', 'shaunhickson/legible-links'],
        ['https://www.github.com/shaunhickson/legible-links.git', 'shaunhickson/legible-links'],
        ['https://github.com/shaunhickson/legible-links/issues/93', 'shaunhickson/legible-links issue #93'],
        ['https://github.com/shaunhickson/legible-links/pull/104', 'shaunhickson/legible-links pull request #104'],
        ['https://github.com/shaunhickson/legible-links/pull/104/files', 'shaunhickson/legible-links pull request #104'],
        ['https://github.com/shaunhickson/legible-links/discussions/7', 'shaunhickson/legible-links discussion #7'],
        ['https://github.com/shaunhickson/legible-links/blob/main/extension/src/content.ts', 'shaunhickson/legible-links: extension/src/content.ts'],
        ['https://github.com/shaunhickson/legible-links/tree/main/docs', 'shaunhickson/legible-links: docs'],
        ['https://github.com/shaunhickson/legible-links/tree/main', 'shaunhickson/legible-links'],
        ['https://github.com/shaunhickson/legible-links/releases/tag/v0.10.0', 'shaunhickson/legible-links release v0.10.0'],
        ['https://github.com/shaunhickson/legible-links/commit/490e29118f2a3b4c5d6e7f8091a2b3c4d5e6f708', 'shaunhickson/legible-links commit 490e291'],
        ['https://github.com/shaunhickson/legible-links/commit/490e291', 'shaunhickson/legible-links commit 490e291'],
        ['https://github.com/shaunhickson/legible-links/issues', 'shaunhickson/legible-links'],
        ['https://github.com/shaunhickson/legible-links/actions/runs/1', 'shaunhickson/legible-links'],
        ['https://github.com/shaunhickson/legible-links/issues/not-a-number', 'shaunhickson/legible-links'],
        ['https://github.com/shaunhickson', null],
        ['https://github.com/', null],
        ['https://github.com/settings/profile', null],
        ['https://github.com/orgs/acme/people', null],
        ['https://github.com/login/oauth', null],
        ['https://github.com/marketplace/actions', null],
        ['https://github.com/topics/privacy', null],
        ['https://github.com/search?q=x', null],
        ['https://github.com/issues/assigned', null],
        ['https://github.com/pulls/mentioned', null],
        ['https://github.com/notifications/x', null],
        ['https://github.com/-bad/repo', null],
        ['https://gist.github.com/user/abc', null],
        ['https://github.com.evil.example/user/repo', null],
    ]);
});

describe('reddit (local)', () => {
    table(redditLocal, [
        ['https://www.reddit.com/r/programming/comments/1g7f0j9/what_are_some_of_the_biggest_housing_projects/', 'r/programming: what are some of the biggest housing projects'],
        ['https://old.reddit.com/r/programming/comments/1g7f0j9/what_are_some/', 'r/programming: what are some'],
        ['https://www.reddit.com/r/programming/comments/1g7f0j9/what_are_some/k1abc2/', 'r/programming: what are some'],
        ['https://www.reddit.com/r/programming/', 'r/programming'],
        ['https://reddit.com/r/programming', 'r/programming'],
        ['https://www.reddit.com/user/spez', 'u/spez'],
        ['https://www.reddit.com/u/spez/', 'u/spez'],
        ['https://www.reddit.com/r/programming/comments/1g7f0j9/', null],
        ['https://www.reddit.com/r/programming/comments/1g7f0j9', null],
        ['https://www.reddit.com/r/programming/s/AbCdEf', null],
        ['https://www.reddit.com/r/programming/new/', null],
        ['https://www.reddit.com/', null],
        ['https://www.reddit.com/user/spez/comments/', null],
        ['https://redd.it/1g7f0j9', null],
        ['https://www.reddit.com/r/bad%20name/', null],
    ]);
});

describe('stackoverflow', () => {
    table(stackoverflow, [
        ['https://stackoverflow.com/questions/11227809/why-is-processing-a-sorted-array-faster-than-processing-an-unsorted-array', 'Why is processing a sorted array faster than processing an unsorted array'],
        ['https://stackoverflow.com/questions/11227809/why-is-processing/11227902#11227902', 'Why is processing'],
        ['https://superuser.com/questions/1/how-to', 'How to'],
        ['https://serverfault.com/questions/2/nginx-config', 'Nginx config'],
        ['https://askubuntu.com/questions/3/apt-broken', 'Apt broken'],
        ['https://math.stackexchange.com/questions/4/euler-identity', 'Euler identity'],
        ['https://meta.stackoverflow.com/questions/5/meta-question', 'Meta question'],
        ['https://mathoverflow.net/questions/6/open-problem', 'Open problem'],
        ['https://stackoverflow.com/q/11227809', null],
        ['https://stackoverflow.com/questions/11227809', null],
        ['https://stackoverflow.com/questions/abc/slug', null],
        ['https://stackoverflow.com/users/1/someone', null],
        ['https://stackoverflow.com/', null],
        ['https://stackoverflow.com.evil.example/questions/1/x', null],
    ]);
});

describe('amazon', () => {
    table(amazon, [
        ['https://www.amazon.com/Apple-AirPods-Pro-2nd-Generation/dp/B0CHWRXH8B', 'Apple AirPods Pro 2nd Generation'],
        ['https://www.amazon.com/Apple-AirPods-Pro/dp/B0CHWRXH8B/ref=sr_1_1?keywords=airpods', 'Apple AirPods Pro'],
        ['https://amazon.co.uk/Some-Book-Title/dp/0123456789', 'Some Book Title'],
        ['https://www.amazon.de/Ein-Buch/dp/B000000001', 'Ein Buch'],
        ['https://www.amazon.com.au/Thing/dp/B000000002', 'Thing'],
        ['https://smile.amazon.com/Thing/dp/B000000002', 'Thing'],
        ['https://www.amazon.com/dp/B0CHWRXH8B', null],
        ['https://www.amazon.com/gp/product/B0CHWRXH8B', null],
        ['https://www.amazon.com/Thing/dp/tooshort', null],
        ['https://www.amazon.com/s?k=airpods', null],
        ['https://www.amazon.com/', null],
        ['https://amazon.example.com/Thing/dp/B000000002', null],
    ]);
});
