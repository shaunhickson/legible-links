/**
 * Resolution cache for the service worker: an in-memory Map (L1) mirrored into
 * `chrome.storage.session` (L2) as one blob, so titles survive the worker being
 * idled. Nothing here is durable across a browser restart by design.
 */
import { Source } from '../shared/protocol';

export const CACHE_STORAGE_KEY = 'll-cache-v1';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export interface CachedResolution {
    title: string;
    description?: string;
    platform: string;
    finalUrl?: string;
    source: Exclude<Source, 'cache'>;
}

export type CacheLookup =
    | { kind: 'hit'; value: CachedResolution }
    | { kind: 'negative' }
    | undefined;

/** The subset of chrome.storage.StorageArea the cache needs (promise style). */
export interface CacheStorage {
    get(key: string): Promise<Record<string, unknown>>;
    set(items: Record<string, unknown>): Promise<void>;
}

export interface CacheOptions {
    storage?: CacheStorage;
    now?: () => number;
    maxEntries?: number;
    ttlMs?: number;
    negativeTtlMs?: number;
    /** Delay before a change is written to L2; further changes coalesce. */
    debounceMs?: number;
}

export interface ResolutionCache {
    /** Resolves once L2 has been read (immediately when there is no L2). */
    readonly ready: Promise<void>;
    readonly size: number;
    get(key: string): CacheLookup;
    set(key: string, value: CachedResolution): void;
    setNegative(key: string): void;
    /** Writes pending changes to L2 now. */
    flush(): Promise<void>;
}

interface Entry {
    value: CachedResolution | null; // null marks a negative entry
    expiresAt: number;
}

type SerializedEntry = [key: string, value: CachedResolution | null, expiresAt: number];

const SOURCES: ReadonlySet<string> = new Set(['local', 'platform', 'backend']);

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readResolution(value: unknown): CachedResolution | null | undefined {
    if (value === null) return null;
    if (!isRecord(value)) return undefined;
    if (typeof value.title !== 'string' || typeof value.platform !== 'string') return undefined;
    if (typeof value.source !== 'string' || !SOURCES.has(value.source)) return undefined;
    const out: CachedResolution = { title: value.title, platform: value.platform, source: value.source as CachedResolution['source'] };
    if (typeof value.description === 'string') out.description = value.description;
    if (typeof value.finalUrl === 'string') out.finalUrl = value.finalUrl;
    return out;
}

function readSerialized(blob: unknown): SerializedEntry[] {
    if (!isRecord(blob) || blob.v !== 1 || !Array.isArray(blob.entries)) return [];
    const out: SerializedEntry[] = [];
    for (const item of blob.entries) {
        if (!Array.isArray(item) || item.length !== 3) continue;
        const [key, rawValue, expiresAt] = item as unknown[];
        if (typeof key !== 'string' || typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) continue;
        const value = readResolution(rawValue);
        if (value === undefined) continue;
        out.push([key, value, expiresAt]);
    }
    return out;
}

export function createCache(options: CacheOptions = {}): ResolutionCache {
    const storage = options.storage;
    const now = options.now ?? (() => Date.now());
    const maxEntries = options.maxEntries ?? 2000;
    const ttlMs = options.ttlMs ?? DAY_MS;
    const negativeTtlMs = options.negativeTtlMs ?? HOUR_MS;
    const debounceMs = options.debounceMs ?? 500;

    const entries = new Map<string, Entry>();
    let timer: ReturnType<typeof setTimeout> | null = null;

    function evict(): void {
        while (entries.size > maxEntries) {
            const oldest = entries.keys().next();
            if (oldest.done) break;
            entries.delete(oldest.value);
        }
    }

    async function write(): Promise<void> {
        if (!storage) return;
        const t = now();
        const serialized: SerializedEntry[] = [];
        for (const [key, entry] of entries) {
            if (entry.expiresAt > t) serialized.push([key, entry.value, entry.expiresAt]);
        }
        try {
            await storage.set({ [CACHE_STORAGE_KEY]: { v: 1, entries: serialized } });
        } catch {
            // L2 is an optimisation; losing it costs a refetch, nothing more.
        }
    }

    function scheduleWrite(): void {
        if (!storage || timer !== null) return;
        timer = setTimeout(() => {
            timer = null;
            void write();
        }, debounceMs);
    }

    function put(key: string, value: CachedResolution | null, ttl: number): void {
        entries.delete(key); // re-insert so the entry counts as newest
        entries.set(key, { value, expiresAt: now() + ttl });
        evict();
        scheduleWrite();
    }

    const ready: Promise<void> = (async () => {
        if (!storage) return;
        try {
            const items = await storage.get(CACHE_STORAGE_KEY);
            const t = now();
            for (const [key, value, expiresAt] of readSerialized(items[CACHE_STORAGE_KEY])) {
                if (expiresAt > t && !entries.has(key)) entries.set(key, { value, expiresAt });
            }
            evict();
        } catch {
            // Start empty.
        }
    })();

    return {
        ready,
        get size() {
            return entries.size;
        },
        get(key) {
            const entry = entries.get(key);
            if (!entry) return undefined;
            if (entry.expiresAt <= now()) {
                entries.delete(key);
                return undefined;
            }
            return entry.value === null ? { kind: 'negative' } : { kind: 'hit', value: entry.value };
        },
        set(key, value) {
            put(key, value, ttlMs);
        },
        setNegative(key) {
            put(key, null, negativeTtlMs);
        },
        async flush() {
            if (timer !== null) {
                clearTimeout(timer);
                timer = null;
            }
            await write();
        },
    };
}
