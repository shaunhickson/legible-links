/**
 * Messages between the content script and the service worker.
 *
 * The worker validates every request structurally and the content script
 * validates every response the same way: neither side trusts the other's shape.
 */

export type Trigger = 'auto' | 'hover';

/** Where a title came from. `cache` means a previous `local`, `platform` or `backend` answer. */
export type Source = 'local' | 'platform' | 'backend' | 'cache';

export interface ResolveRequest {
    type: 'RESOLVE';
    urls: string[];
    trigger: Trigger;
}

export interface ResolvedOutcome {
    status: 'resolved';
    title: string;
    description?: string;
    platform: string;
    source: Source;
    /** Where an unshortened link actually lands, when the backend followed redirects. */
    finalUrl?: string;
}

export type Outcome =
    | ResolvedOutcome
    /** Resolvable, but only on hover in the current mode. */
    | { status: 'hover' }
    | { status: 'none' };

export interface ResolveResponse {
    results: Record<string, Outcome>;
}

export const MAX_URLS_PER_MESSAGE = 100;
const MAX_URL_LENGTH = 2048;
const SOURCES: ReadonlySet<string> = new Set<Source>(['local', 'platform', 'backend', 'cache']);

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): value is string | undefined {
    return value === undefined || typeof value === 'string';
}

export function isResolveRequest(value: unknown): value is ResolveRequest {
    if (!isRecord(value) || value.type !== 'RESOLVE') return false;
    if (value.trigger !== 'auto' && value.trigger !== 'hover') return false;
    const urls = value.urls;
    if (!Array.isArray(urls) || urls.length === 0 || urls.length > MAX_URLS_PER_MESSAGE) return false;
    return urls.every((u) => typeof u === 'string' && u.length > 0 && u.length <= MAX_URL_LENGTH);
}

export function isOutcome(value: unknown): value is Outcome {
    if (!isRecord(value)) return false;
    switch (value.status) {
        case 'hover':
        case 'none':
            return true;
        case 'resolved':
            return typeof value.title === 'string'
                && typeof value.platform === 'string'
                && typeof value.source === 'string' && SOURCES.has(value.source)
                && isOptionalString(value.description)
                && isOptionalString(value.finalUrl);
        default:
            return false;
    }
}

/**
 * Reads a worker response in the content script. Returns null when the whole
 * message is malformed; entries that are not well-formed outcomes are dropped.
 */
export function readResolveResponse(value: unknown): Map<string, Outcome> | null {
    if (!isRecord(value) || !isRecord(value.results)) return null;
    const out = new Map<string, Outcome>();
    for (const [url, outcome] of Object.entries(value.results)) {
        if (isOutcome(outcome)) out.set(url, outcome);
    }
    return out;
}
