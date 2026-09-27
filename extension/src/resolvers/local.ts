/**
 * Tier 0: titles derived from the URL itself. Nothing leaves the browser.
 * Each resolver's canHandle is exact, so a match always produces a title.
 */
import { hostUnder, LocalResolver, pathSegments, ResolveResult } from './types';

function words(slug: string): string {
    return slug.replace(/[-_]+/g, ' ').trim();
}

function capitalize(s: string): string {
    return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

function local(id: string, match: (u: URL) => ResolveResult | null): LocalResolver {
    return {
        id,
        tier: 0,
        canHandle: (u) => match(u) !== null,
        resolve: match,
    };
}

// --- Wikipedia --------------------------------------------------------------

const WIKI_HOST = /^([a-z][a-z0-9-]*)\.(?:m\.)?wikipedia\.org$/;

export const wikipedia = local('wikipedia', (u) => {
    const m = WIKI_HOST.exec(u.hostname.toLowerCase());
    if (!m || m[1] === 'www') return null;
    const [first, ...rest] = pathSegments(u);
    if (first !== 'wiki' || rest.length === 0) return null;
    const title = rest.join('/').replace(/_/g, ' ').trim();
    if (!title || /^special:/i.test(title)) return null;
    return { title, description: `${m[1]}.wikipedia.org`, platform: 'wikipedia' };
});

// --- GitHub -----------------------------------------------------------------

const GITHUB_RESERVED = new Set([
    'settings', 'orgs', 'login', 'join', 'marketplace', 'explore', 'topics', 'sponsors', 'features',
    'pricing', 'about', 'site', 'security', 'contact', 'apps', 'notifications', 'new', 'codespaces',
    'enterprise', 'collections', 'events', 'trending', 'search', 'pulls', 'issues', 'dashboard',
]);
const GITHUB_OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;
const GITHUB_REPO = /^[A-Za-z0-9_.-]+$/;
const DIGITS = /^\d+$/;
const SHA = /^[0-9a-f]{7,40}$/i;

export const github = local('github', (u) => {
    const host = u.hostname.toLowerCase();
    if (host !== 'github.com' && host !== 'www.github.com') return null;
    const [owner, repoRaw, kind, ...rest] = pathSegments(u);
    if (!owner || !repoRaw) return null;
    if (GITHUB_RESERVED.has(owner.toLowerCase())) return null;
    if (!GITHUB_OWNER.test(owner) || !GITHUB_REPO.test(repoRaw)) return null;
    const repo = repoRaw.replace(/\.git$/, '');
    const base = `${owner}/${repo}`;
    const platform = 'github';

    if (kind === 'issues' && rest.length === 1 && DIGITS.test(rest[0])) return { title: `${base} issue #${rest[0]}`, platform };
    if (kind === 'pull' && rest.length >= 1 && DIGITS.test(rest[0])) return { title: `${base} pull request #${rest[0]}`, platform };
    if (kind === 'discussions' && rest.length === 1 && DIGITS.test(rest[0])) return { title: `${base} discussion #${rest[0]}`, platform };
    if ((kind === 'blob' || kind === 'tree') && rest.length >= 2) return { title: `${base}: ${rest.slice(1).join('/')}`, platform };
    if (kind === 'releases' && rest[0] === 'tag' && rest.length === 2 && rest[1]) return { title: `${base} release ${rest[1]}`, platform };
    if (kind === 'commit' && rest.length === 1 && SHA.test(rest[0])) return { title: `${base} commit ${rest[0].slice(0, 7)}`, platform };
    return { title: base, platform };
});

// --- Reddit (slugged posts, subreddits, users) ------------------------------

const REDDIT_HOSTS = new Set(['reddit.com', 'www.reddit.com', 'old.reddit.com', 'new.reddit.com', 'np.reddit.com', 'm.reddit.com']);
const REDDIT_NAME = /^[A-Za-z0-9_]{1,21}$/;

export const redditLocal = local('reddit-local', (u) => {
    if (!REDDIT_HOSTS.has(u.hostname.toLowerCase())) return null;
    const segments = pathSegments(u);
    const platform = 'reddit';
    if (segments[0] === 'r' && segments[1] && REDDIT_NAME.test(segments[1])) {
        const sub = segments[1];
        if (segments.length === 2) return { title: `r/${sub}`, platform };
        if (segments[2] === 'comments' && segments[3] && segments[4]) {
            const slug = words(segments[4]);
            if (slug) return { title: `r/${sub}: ${slug}`, platform };
        }
        return null; // slug-less post URLs go to the platform (Tier A)
    }
    if ((segments[0] === 'user' || segments[0] === 'u') && segments.length === 2 && REDDIT_NAME.test(segments[1])) {
        return { title: `u/${segments[1]}`, platform };
    }
    return null;
});

// --- Stack Exchange network -------------------------------------------------

const STACK_BASES = ['stackoverflow.com', 'stackexchange.com', 'superuser.com', 'serverfault.com', 'askubuntu.com', 'mathoverflow.net', 'stackapps.com'];

export const stackoverflow = local('stackoverflow', (u) => {
    const host = u.hostname.toLowerCase();
    if (!STACK_BASES.some((base) => hostUnder(host, base))) return null;
    const [kind, id, slug] = pathSegments(u);
    if (kind !== 'questions' || !id || !DIGITS.test(id) || !slug) return null;
    const title = capitalize(words(slug));
    if (!title) return null;
    return { title, platform: 'stackoverflow' };
});

// --- Amazon -----------------------------------------------------------------

const AMAZON_HOST = /^(?:[a-z0-9-]+\.)?amazon\.(?:com?\.)?[a-z]{2,3}$/;
const ASIN = /^[A-Z0-9]{10}$/;

export const amazon = local('amazon', (u) => {
    if (!AMAZON_HOST.test(u.hostname.toLowerCase())) return null;
    const segments = pathSegments(u);
    const dp = segments.indexOf('dp');
    if (dp < 1 || !segments[dp + 1] || !ASIN.test(segments[dp + 1])) return null;
    const title = words(segments[dp - 1]);
    if (!title) return null;
    return { title, platform: 'amazon' };
});

export const LOCAL_RESOLVERS: LocalResolver[] = [wikipedia, github, redditLocal, stackoverflow, amazon];
