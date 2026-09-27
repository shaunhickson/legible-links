export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export interface ResolveResult {
    title: string;
    description?: string;
    platform: string;
    finalUrl?: string;
}

export interface ResolveContext {
    fetchFn: FetchFn;
    signal?: AbortSignal;
}

/** Tier 0: the title is derived from the URL itself. No network, synchronous. */
export interface LocalResolver {
    id: string;
    tier: 0;
    canHandle(u: URL): boolean;
    resolve(u: URL): ResolveResult | null;
}

/** Tier A: one request straight to the platform's oEmbed endpoint, cookies omitted. */
export interface PlatformResolver {
    id: string;
    tier: 'A';
    canHandle(u: URL): boolean;
    resolve(u: URL, ctx: ResolveContext): Promise<ResolveResult | null>;
}

export type Resolver = LocalResolver | PlatformResolver;

/** `AbortSignal.timeout` where available (Chrome, Firefox, Node); undefined elsewhere. */
export function timeoutSignal(ms: number): AbortSignal | undefined {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
        return AbortSignal.timeout(ms);
    }
    return undefined;
}

export function safeDecode(segment: string): string {
    try {
        return decodeURIComponent(segment);
    } catch {
        return segment;
    }
}

/** Non-empty, percent-decoded path segments. */
export function pathSegments(u: URL): string[] {
    return u.pathname.split('/').filter((s) => s !== '').map(safeDecode);
}

export function hostIs(u: URL, ...hosts: string[]): boolean {
    const host = u.hostname.toLowerCase();
    return hosts.includes(host);
}

/** `host` equals `base` or is a subdomain of it. */
export function hostUnder(host: string, base: string): boolean {
    return host === base || host.endsWith('.' + base);
}
