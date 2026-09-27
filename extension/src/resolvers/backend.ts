/**
 * Tier B: everything else, and unshortening, through our server.
 * Exactly what M0's content script did: JSON POST, chunks of 25, no cookies,
 * no referrer, no HTTP cache, 10 s timeout.
 */
import { parseResolveResponse, validFinalUrl } from '../shared/wire';
import { FetchFn, ResolveResult, timeoutSignal } from './types';

/** URLs per POST (the backend's own cap is 50). */
export const BACKEND_CHUNK_SIZE = 25;
export const BACKEND_TIMEOUT_MS = 10000;

export interface BackendOptions {
    apiUrl: string;
    fetchFn: FetchFn;
}

/**
 * What the backend said about one URL: a title (with the destination when it
 * followed redirects), or only the destination when it could not title the
 * page itself (a platform page, say) and leaves the rest to the extension.
 */
export type BackendAnswer = ResolveResult | { finalUrl: string };

export function hasTitle(answer: BackendAnswer): answer is ResolveResult {
    return 'title' in answer;
}

export interface BackendOutcome {
    /** URLs the backend answered, with a title or with just the destination. */
    answered: Map<string, BackendAnswer>;
    /** URLs whose request failed in transit (network, timeout, non-2xx, malformed body). */
    failed: Set<string>;
}

async function postChunk(urls: string[], options: BackendOptions): Promise<Map<string, BackendAnswer> | null> {
    try {
        const init: RequestInit = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ urls }),
            credentials: 'omit',
            cache: 'no-store',
            referrerPolicy: 'no-referrer',
        };
        const signal = timeoutSignal(BACKEND_TIMEOUT_MS);
        if (signal) init.signal = signal;
        const response = await options.fetchFn(options.apiUrl, init);
        if (!response.ok) return null;
        const parsed = parseResolveResponse(await response.json());
        if (!parsed) return null;

        const out = new Map<string, BackendAnswer>();
        for (const url of urls) {
            const title = parsed.titles.get(url);
            const details = parsed.details.get(url);
            const finalUrl = validFinalUrl(details?.finalUrl);
            if (title !== undefined) {
                out.set(url, {
                    title,
                    description: details?.description,
                    platform: details?.platform ?? 'generic',
                    finalUrl,
                });
            } else if (finalUrl !== undefined) {
                out.set(url, { finalUrl });
            }
        }
        return out;
    } catch {
        return null;
    }
}

/** URLs not in `answered` and not in `failed` were answered with neither a title nor a destination. */
export async function resolveViaBackend(urls: string[], options: BackendOptions): Promise<BackendOutcome> {
    const answered = new Map<string, BackendAnswer>();
    const failed = new Set<string>();
    for (let i = 0; i < urls.length; i += BACKEND_CHUNK_SIZE) {
        const chunk = urls.slice(i, i + BACKEND_CHUNK_SIZE);
        const result = await postChunk(chunk, options);
        if (result === null) {
            for (const url of chunk) failed.add(url);
            continue;
        }
        for (const [url, r] of result) answered.set(url, r);
    }
    return { answered, failed };
}
