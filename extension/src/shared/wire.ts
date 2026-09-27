/**
 * The backend's `POST /resolve` response. Shared with the backend through
 * `testdata/resolve-response.json`, which both sides decode in their tests.
 */
import { isRecord } from './protocol';

export interface WireDetails {
    platform?: string;
    description?: string;
    /** Set by the unshortener to the destination it landed on. */
    finalUrl?: string;
}

export interface WireResponse {
    titles: Map<string, string>;
    details: Map<string, WireDetails>;
}

function optionalString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

/**
 * Validates the backend response shape: `titles` must be an object of string -> string.
 * Anything else is treated as a failed request.
 */
export function parseResolveResponse(data: unknown): WireResponse | null {
    if (!isRecord(data) || !isRecord(data.titles)) return null;

    const titles = new Map<string, string>();
    for (const [url, title] of Object.entries(data.titles)) {
        if (typeof title === 'string') titles.set(url, title);
    }

    const details = new Map<string, WireDetails>();
    if (isRecord(data.details)) {
        for (const [url, entry] of Object.entries(data.details)) {
            if (!isRecord(entry)) continue;
            details.set(url, {
                platform: optionalString(entry.platform),
                description: optionalString(entry.description),
                finalUrl: optionalString(entry.finalUrl),
            });
        }
    }

    return { titles, details };
}
