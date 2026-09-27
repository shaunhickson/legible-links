/**
 * Decides, per URL, which tier may answer and whether the current mode and
 * trigger allow it. Pure: every dependency (fetch, cache, settings, clock,
 * resolvers) is injected, so the whole policy is testable without a browser.
 *
 * Per URL:
 *   1. classifyUrl !== 'ok'                      -> none
 *   2. key = stripForTransmission(url); cache    -> resolved (cache) | none
 *   3. Tier 0 match                              -> resolved (local), cached
 *   4. Tier A match: auto mode or hover trigger  -> fetch platform; else hover
 *   5. Tier B: high entropy -> none; mode/trigger/page host decide backend | hover | none
 */
import { Outcome, ResolvedOutcome, Trigger } from '../shared/protocol';
import { resolveViaBackend } from '../resolvers/backend';
import { RESOLVERS } from '../resolvers/index';
import { OEmbedHttpError } from '../resolvers/oembed';
import { FetchFn, LocalResolver, PlatformResolver, Resolver, ResolveResult, timeoutSignal } from '../resolvers/types';
import { CachedResolution, ResolutionCache } from '../utils/cache';
import { sanitizeDescription, sanitizeTitle } from '../utils/sanitize';
import { classifyUrl, hasHighEntropySegment, isSensitivePageHost, stripForTransmission } from '../utils/sensitive';
import { Settings } from '../utils/settings';

export const PLATFORM_TIMEOUT_MS = 4000;
export const MAX_IN_FLIGHT_PER_HOST = 4;
export const MAX_IN_FLIGHT = 8;
export const BACKOFF_MS = 10 * 60 * 1000;
const MAX_FINAL_URL_LENGTH = 2048;

export interface RouterOptions {
    fetchFn: FetchFn;
    cache: ResolutionCache;
    getSettings: () => Promise<Settings> | Settings;
    now?: () => number;
    resolvers?: Resolver[];
}

export interface Router {
    resolve(urls: string[], trigger: Trigger, pageHost: string): Promise<Record<string, Outcome>>;
}

const NONE: Outcome = { status: 'none' };
const HOVER: Outcome = { status: 'hover' };

/** Thrown by the guarded fetch while a host is backing off; never reaches the network. */
export class HostBackoffError extends Error {
    constructor(public readonly host: string) {
        super(`backing off ${host}`);
        this.name = 'HostBackoffError';
    }
}

interface Limiter {
    acquire(host: string): Promise<void>;
    release(host: string): void;
}

/** At most `perHost` requests in flight to one host and `total` overall; FIFO otherwise. */
export function createLimiter(perHost: number, total: number): Limiter {
    let inFlight = 0;
    const perHostCount = new Map<string, number>();
    const waiters: Array<{ host: string; wake: () => void }> = [];

    const canRun = (host: string) => inFlight < total && (perHostCount.get(host) ?? 0) < perHost;
    const take = (host: string) => {
        inFlight++;
        perHostCount.set(host, (perHostCount.get(host) ?? 0) + 1);
    };

    return {
        acquire(host) {
            if (canRun(host)) {
                take(host);
                return Promise.resolve();
            }
            return new Promise((wake) => waiters.push({ host, wake }));
        },
        release(host) {
            inFlight--;
            const count = (perHostCount.get(host) ?? 1) - 1;
            if (count <= 0) perHostCount.delete(host);
            else perHostCount.set(host, count);
            for (let i = 0; i < waiters.length; i++) {
                if (canRun(waiters[i].host)) {
                    const [next] = waiters.splice(i, 1);
                    take(next.host);
                    next.wake();
                    break;
                }
            }
        },
    };
}

function validFinalUrl(value: string | undefined): string | undefined {
    if (!value || value.length > MAX_FINAL_URL_LENGTH) return undefined;
    let u: URL;
    try {
        u = new URL(value);
    } catch {
        return undefined;
    }
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password) return undefined;
    return u.href;
}

/** Sanitizes a resolver's answer; null when nothing displayable is left. */
function toCached(r: ResolveResult, source: CachedResolution['source']): CachedResolution | null {
    const title = sanitizeTitle(r.title);
    if (!title) return null;
    const value: CachedResolution = { title, platform: r.platform.toLowerCase(), source };
    const description = sanitizeDescription(r.description);
    if (description) value.description = description;
    const finalUrl = validFinalUrl(r.finalUrl);
    if (finalUrl) value.finalUrl = finalUrl;
    return value;
}

function resolved(value: CachedResolution, source: ResolvedOutcome['source']): ResolvedOutcome {
    const out: ResolvedOutcome = { status: 'resolved', title: value.title, platform: value.platform, source };
    if (value.description !== undefined) out.description = value.description;
    if (value.finalUrl !== undefined) out.finalUrl = value.finalUrl;
    return out;
}

type Plan =
    | { kind: 'done'; outcome: Outcome }
    | { kind: 'platform'; key: string; target: URL; resolver: PlatformResolver }
    | { kind: 'backend'; key: string };

export function createRouter(options: RouterOptions): Router {
    const { fetchFn, cache } = options;
    const now = options.now ?? (() => Date.now());
    const resolvers = options.resolvers ?? RESOLVERS;
    const localResolvers = resolvers.filter((r): r is LocalResolver => r.tier === 0);
    const platformResolvers = resolvers.filter((r): r is PlatformResolver => r.tier === 'A');

    const limiter = createLimiter(MAX_IN_FLIGHT_PER_HOST, MAX_IN_FLIGHT);
    const backoffUntil = new Map<string, number>();

    /** Every outbound request goes through here: backoff, concurrency limits, and backoff marking. */
    const guardedFetch: FetchFn = async (input, init) => {
        const host = new URL(input).host;
        const until = backoffUntil.get(host);
        if (until !== undefined) {
            if (until > now()) throw new HostBackoffError(host);
            backoffUntil.delete(host);
        }
        await limiter.acquire(host);
        try {
            const response = await fetchFn(input, init);
            if (response.status === 429 || response.status >= 500) backoffUntil.set(host, now() + BACKOFF_MS);
            return response;
        } finally {
            limiter.release(host);
        }
    };

    function plan(url: string, settings: Settings, trigger: Trigger, pageHost: string): Plan {
        if (classifyUrl(url) !== 'ok') return { kind: 'done', outcome: NONE };
        const key = stripForTransmission(url);

        const cached = cache.get(key);
        if (cached?.kind === 'hit') return { kind: 'done', outcome: resolved(cached.value, 'cache') };
        if (cached?.kind === 'negative') return { kind: 'done', outcome: NONE };

        let target: URL;
        try {
            target = new URL(key);
        } catch {
            return { kind: 'done', outcome: NONE };
        }

        for (const resolver of localResolvers) {
            if (!resolver.canHandle(target)) continue;
            const r = resolver.resolve(target);
            const value = r && toCached(r, 'local');
            if (!value) continue;
            cache.set(key, value);
            return { kind: 'done', outcome: resolved(value, 'local') };
        }

        for (const resolver of platformResolvers) {
            if (!resolver.canHandle(target)) continue;
            if (settings.platformMode === 'auto' || trigger === 'hover') return { kind: 'platform', key, target, resolver };
            return { kind: 'done', outcome: HOVER };
        }

        if (hasHighEntropySegment(key)) return { kind: 'done', outcome: NONE };
        const automatic = settings.genericMode === 'auto' && !isSensitivePageHost(pageHost);
        const onHover = settings.genericMode !== 'off' && trigger === 'hover';
        if (automatic || onHover) return { kind: 'backend', key };
        if (settings.genericMode === 'off') return { kind: 'done', outcome: NONE };
        return { kind: 'done', outcome: HOVER };
    }

    async function runPlatform(resolver: PlatformResolver, target: URL, key: string): Promise<Outcome> {
        try {
            const r = await resolver.resolve(target, { fetchFn: guardedFetch, signal: timeoutSignal(PLATFORM_TIMEOUT_MS) });
            const value = r && toCached(r, 'platform');
            if (!value) {
                cache.setNegative(key);
                return NONE;
            }
            cache.set(key, value);
            return resolved(value, 'platform');
        } catch (err) {
            // A definitive 4xx (private, deleted, unknown) is remembered; transient failures are not.
            if (err instanceof OEmbedHttpError && err.status !== 429 && err.status < 500) cache.setNegative(key);
            return NONE;
        }
    }

    async function runBackend(keys: string[], settings: Settings): Promise<Map<string, Outcome>> {
        const outcomes = new Map<string, Outcome>();
        const { resolved: answered, failed } = await resolveViaBackend(keys, { apiUrl: settings.apiUrl, fetchFn: guardedFetch });
        for (const key of keys) {
            const r = answered.get(key);
            const value = r && toCached(r, 'backend');
            if (value) {
                cache.set(key, value);
                outcomes.set(key, resolved(value, 'backend'));
            } else {
                if (!failed.has(key)) cache.setNegative(key);
                outcomes.set(key, NONE);
            }
        }
        return outcomes;
    }

    return {
        async resolve(urls, trigger, pageHost) {
            const settings = await options.getSettings();
            await cache.ready;

            const results: Record<string, Outcome> = {};
            const platformJobs = new Map<string, Promise<Outcome>>(); // by key: one fetch per distinct key
            const platformUrls = new Map<string, string[]>();
            const backendUrls = new Map<string, string[]>();

            for (const url of new Set(urls)) {
                const p = plan(url, settings, trigger, pageHost);
                if (p.kind === 'done') {
                    results[url] = p.outcome;
                } else if (p.kind === 'platform') {
                    if (!platformJobs.has(p.key)) platformJobs.set(p.key, runPlatform(p.resolver, p.target, p.key));
                    platformUrls.set(p.key, [...(platformUrls.get(p.key) ?? []), url]);
                } else {
                    backendUrls.set(p.key, [...(backendUrls.get(p.key) ?? []), url]);
                }
            }

            const backendJob = backendUrls.size > 0
                ? runBackend(Array.from(backendUrls.keys()), settings)
                : Promise.resolve(new Map<string, Outcome>());

            const [platformOutcomes, backendOutcomes] = await Promise.all([
                Promise.all(Array.from(platformJobs, async ([key, job]) => [key, await job] as const)),
                backendJob,
            ]);

            for (const [key, outcome] of platformOutcomes) {
                for (const url of platformUrls.get(key) ?? []) results[url] = outcome;
            }
            for (const [key, list] of backendUrls) {
                for (const url of list) results[url] = backendOutcomes.get(key) ?? NONE;
            }
            return results;
        },
    };
}
