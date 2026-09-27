/**
 * Shared oEmbed fetch for Tier A. One GET straight to the platform, with no
 * cookies, no referrer and no HTTP cache. Chrome service workers have no
 * DOMParser, so anything pulled out of `html` is handled as a string.
 */
import { ResolveContext } from './types';

/** A non-2xx answer. 429 and 5xx are transient (the router backs off); other 4xx are definitive. */
export class OEmbedHttpError extends Error {
    constructor(public readonly status: number) {
        super(`oEmbed HTTP ${status}`);
        this.name = 'OEmbedHttpError';
    }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function stringField(data: Record<string, unknown>, key: string): string | undefined {
    const value = data[key];
    return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/** Returns the JSON object, or null when the body is not one. Throws on HTTP and network errors. */
export async function fetchOEmbed(endpoint: string, ctx: ResolveContext): Promise<Record<string, unknown> | null> {
    const init: RequestInit = {
        method: 'GET',
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        redirect: 'follow',
    };
    if (ctx.signal) init.signal = ctx.signal;
    const response = await ctx.fetchFn(endpoint, init);
    if (!response.ok) throw new OEmbedHttpError(response.status);
    let data: unknown;
    try {
        data = await response.json();
    } catch {
        return null;
    }
    return isRecord(data) ? data : null;
}

export function oembedEndpoint(base: string, targetUrl: string, extra: Record<string, string> = {}): string {
    const params = new URLSearchParams({ url: targetUrl, ...extra });
    return `${base}?${params.toString()}`;
}
