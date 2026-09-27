/**
 * Tier B: everything else, and unshortening, through our server.
 * Exactly what M0's content script did: JSON POST, chunks of 25, no cookies,
 * no referrer, no HTTP cache, 10 s timeout.
 */
import { parseResolveResponse } from '../shared/wire';
import { FetchFn, ResolveResult, timeoutSignal } from './types';

/** URLs per POST (the backend's own cap is 50). */
export const BACKEND_CHUNK_SIZE = 25;
export const BACKEND_TIMEOUT_MS = 10000;

export interface BackendOptions {
    apiUrl: string;
    fetchFn: FetchFn;
}

export interface BackendOutcome {
    /** URLs the backend answered with a title. */
    resolved: Map<string, ResolveResult>;
    /** URLs whose request failed in transit (network, timeout, non-2xx, malformed body). */
    failed: Set<string>;
}

async function postChunk(urls: string[], options: BackendOptions): Promise<Map<string, ResolveResult> | null> {
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

        const out = new Map<string, ResolveResult>();
        for (const url of urls) {
            const title = parsed.titles.get(url);
            if (title === undefined) continue;
            const details = parsed.details.get(url);
            out.set(url, {
                title,
                description: details?.description,
                platform: details?.platform ?? 'generic',
                finalUrl: details?.finalUrl,
            });
        }
        return out;
    } catch {
        return null;
    }
}

/** URLs not in `resolved` and not in `failed` were answered without a title. */
export async function resolveViaBackend(urls: string[], options: BackendOptions): Promise<BackendOutcome> {
    const resolved = new Map<string, ResolveResult>();
    const failed = new Set<string>();
    for (let i = 0; i < urls.length; i += BACKEND_CHUNK_SIZE) {
        const chunk = urls.slice(i, i + BACKEND_CHUNK_SIZE);
        const result = await postChunk(chunk, options);
        if (result === null) {
            for (const url of chunk) failed.add(url);
            continue;
        }
        for (const [url, r] of result) resolved.set(url, r);
    }
    return { resolved, failed };
}
