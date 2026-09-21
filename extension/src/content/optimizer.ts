import { isRawUrl, isYouTube } from '../utils/url';
import { DEFAULT_SETTINGS, getDomain, getSettings, isDomainAllowed, isValidApiUrl, Settings } from '../utils/settings';
import { isKnownPlatform, TooltipData, uiManager } from '../utils/ui';
import { sanitizeDescription, sanitizeTitle } from '../utils/sanitize';
import { renderResolvedLink } from '../utils/render';
import { classifyUrl, isEditableContext, textDomainMatchesHref } from '../utils/sensitive';

/** Anchors enqueued over the lifetime of a page. */
export const MAX_ANCHORS_PER_PAGE = 300;
/** Anchors enqueued from a single MutationObserver pass. */
export const MAX_ANCHORS_PER_PASS = 50;
/** URLs per POST to the backend (its own cap is 50). */
export const CHUNK_SIZE = 25;
/** Fetch attempts per anchor before giving up on it. */
export const MAX_ATTEMPTS = 3;

const BATCH_DELAY_MS = 500;
const HOVER_DELAY_MS = 500;
const FETCH_TIMEOUT_MS = 10000;
const XHTML_NS = 'http://www.w3.org/1999/xhtml';

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export interface TooltipUI {
    show(target: HTMLElement, data: TooltipData, theme?: string): void;
    hide(): void;
}

export interface LinkOptimizerOptions {
    fetchFn?: FetchFn;
    doc?: Document;
    loadSettings?: () => Promise<Settings>;
    ui?: TooltipUI;
    batchDelayMs?: number;
}

interface ResolveDetails {
    platform?: string;
    description?: string;
}

interface ResolveResponse {
    titles: Map<string, string>;
    details: Map<string, ResolveDetails>;
}

type AnchorState = 'pending' | 'done';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHtmlAnchor(node: Node): node is HTMLAnchorElement {
    return node.nodeType === 1
        && (node as Element).localName === 'a'
        && (node as Element).namespaceURI === XHTML_NS;
}

/**
 * Validates the backend response shape: `titles` must be an object of string -> string.
 * Anything else is treated as a failed request.
 */
export function parseResolveResponse(data: unknown): ResolveResponse | null {
    if (!isRecord(data) || !isRecord(data.titles)) return null;

    const titles = new Map<string, string>();
    for (const [url, title] of Object.entries(data.titles)) {
        if (typeof title === 'string') titles.set(url, title);
    }

    const details = new Map<string, ResolveDetails>();
    if (isRecord(data.details)) {
        for (const [url, entry] of Object.entries(data.details)) {
            if (!isRecord(entry)) continue;
            details.set(url, {
                platform: typeof entry.platform === 'string' ? entry.platform : undefined,
                description: typeof entry.description === 'string' ? entry.description : undefined,
            });
        }
    }

    return { titles, details };
}

export class LinkOptimizer {
    private readonly fetchFn: FetchFn;
    private readonly doc: Document;
    private readonly loadSettings: () => Promise<Settings>;
    private readonly ui: TooltipUI;
    private readonly batchDelayMs: number;

    private settings: Settings = DEFAULT_SETTINGS;
    private readonly state = new WeakMap<HTMLAnchorElement, AnchorState>();
    private readonly attempts = new WeakMap<HTMLAnchorElement, number>();
    private pending = new Map<string, HTMLAnchorElement[]>();
    private enqueuedTotal = 0;
    private batchTimer: ReturnType<typeof setTimeout> | null = null;
    private chain: Promise<void> = Promise.resolve();
    private observer: MutationObserver | null = null;

    constructor(options: LinkOptimizerOptions = {}) {
        this.fetchFn = options.fetchFn ?? ((input, init) => globalThis.fetch(input, init));
        this.doc = options.doc ?? document;
        this.loadSettings = options.loadSettings ?? getSettings;
        this.ui = options.ui ?? uiManager;
        this.batchDelayMs = options.batchDelayMs ?? BATCH_DELAY_MS;
    }

    public async start(): Promise<void> {
        this.settings = await this.loadSettings();
        this.listenForSettingsChanges();

        const currentDomain = getDomain(this.doc.URL);
        if (!isDomainAllowed(currentDomain, this.settings)) return;

        const body = this.doc.body;
        if (!body) return;

        this.enqueue(this.doc.querySelectorAll('a'), MAX_ANCHORS_PER_PAGE);

        this.observer = new MutationObserver((mutations) => {
            if (!isDomainAllowed(currentDomain, this.settings)) return;

            const found = new Set<HTMLAnchorElement>();
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== 1) continue;
                    if (isHtmlAnchor(node)) found.add(node);
                    for (const nested of (node as Element).querySelectorAll('a')) {
                        if (isHtmlAnchor(nested)) found.add(nested);
                    }
                }
            }
            if (found.size > 0) this.enqueue(found, MAX_ANCHORS_PER_PASS);
        });
        this.observer.observe(body, { childList: true, subtree: true });
    }

    public stop(): void {
        this.observer?.disconnect();
        this.observer = null;
        if (this.batchTimer !== null) {
            clearTimeout(this.batchTimer);
            this.batchTimer = null;
        }
    }

    /** Processes everything queued so far without waiting for the batch timer. */
    public flush(): Promise<void> {
        if (this.batchTimer !== null) {
            clearTimeout(this.batchTimer);
            this.batchTimer = null;
        }
        return this.runPending();
    }

    private listenForSettingsChanges(): void {
        const storage = typeof chrome !== 'undefined' ? chrome.storage : undefined;
        if (!storage?.onChanged) return;
        storage.onChanged.addListener((changes, namespace) => {
            if (namespace !== 'local') return;
            const next: Record<string, unknown> = { ...this.settings };
            for (const [key, change] of Object.entries(changes)) {
                if (key in DEFAULT_SETTINGS) next[key] = change.newValue;
            }
            if (typeof next.apiUrl !== 'string' || !isValidApiUrl(next.apiUrl)) {
                next.apiUrl = DEFAULT_SETTINGS.apiUrl;
            }
            this.settings = next as unknown as Settings;
        });
    }

    /** Resolves the href attribute against the document; only http(s) targets qualify. */
    private candidateHref(anchor: HTMLAnchorElement): string | null {
        const raw = anchor.getAttribute('href');
        if (!raw) return null;
        let u: URL;
        try {
            u = new URL(raw, this.doc.baseURI);
        } catch {
            return null;
        }
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
        u.hash = '';
        return u.href;
    }

    private enqueue(anchors: Iterable<Element>, limit: number): void {
        let added = 0;
        for (const el of anchors) {
            if (added >= limit || this.enqueuedTotal >= MAX_ANCHORS_PER_PAGE) break;
            if (!isHtmlAnchor(el) || this.state.has(el)) continue;

            const href = this.candidateHref(el);
            if (!href) continue;
            if (!isDomainAllowed(getDomain(href), this.settings)) continue;

            const text = (el.textContent ?? '').trim();
            if (!isRawUrl(text)) continue;
            if (classifyUrl(href) !== 'ok') continue;
            if (!textDomainMatchesHref(text, href)) continue;
            if (isEditableContext(el)) continue;

            this.state.set(el, 'pending');
            const list = this.pending.get(href);
            if (list) {
                list.push(el);
            } else {
                this.pending.set(href, [el]);
            }
            added++;
            this.enqueuedTotal++;
        }
        if (added > 0) this.scheduleBatch();
    }

    private scheduleBatch(): void {
        if (this.batchTimer !== null) return;
        this.batchTimer = setTimeout(() => {
            this.batchTimer = null;
            void this.runPending();
        }, this.batchDelayMs);
    }

    private runPending(): Promise<void> {
        this.chain = this.chain.then(() => this.processPending()).catch(() => undefined);
        return this.chain;
    }

    private async processPending(): Promise<void> {
        if (this.pending.size === 0) return;
        const batch = this.pending;
        this.pending = new Map();
        const urls = Array.from(batch.keys());

        for (let i = 0; i < urls.length; i += CHUNK_SIZE) {
            const chunk = urls.slice(i, i + CHUNK_SIZE);
            const result = await this.resolve(chunk);

            if (result === null) {
                // Fail open: leave this and every remaining chunk untouched.
                for (const url of urls.slice(i)) this.markFailed(batch.get(url) ?? []);
                return;
            }

            for (const url of chunk) {
                const anchors = batch.get(url) ?? [];
                for (const anchor of anchors) this.state.set(anchor, 'done');

                const title = sanitizeTitle(result.titles.get(url));
                if (!title) continue;

                const details = result.details.get(url);
                const platform = this.pickPlatform(url, details);
                const description = sanitizeDescription(details?.description);
                const tooltip: TooltipData = {
                    title,
                    description: description || undefined,
                    domain: getDomain(url),
                    url,
                    platform,
                };

                for (const anchor of anchors) {
                    if (renderResolvedLink(anchor, { title, href: url, platform })) {
                        this.attachHover(anchor, tooltip);
                    }
                }
            }
        }
    }

    private async resolve(urls: string[]): Promise<ResolveResponse | null> {
        try {
            const init: RequestInit = {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ urls }),
                credentials: 'omit',
                cache: 'no-store',
                referrerPolicy: 'no-referrer',
            };
            if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
                init.signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
            }
            const response = await this.fetchFn(this.settings.apiUrl, init);
            if (!response.ok) return null;
            return parseResolveResponse(await response.json());
        } catch {
            return null;
        }
    }

    private markFailed(anchors: HTMLAnchorElement[]): void {
        for (const anchor of anchors) {
            const count = (this.attempts.get(anchor) ?? 0) + 1;
            this.attempts.set(anchor, count);
            if (count >= MAX_ATTEMPTS) {
                this.state.set(anchor, 'done');
            } else {
                this.state.delete(anchor);
            }
        }
    }

    private pickPlatform(url: string, details?: ResolveDetails): string {
        const platform = details?.platform?.toLowerCase();
        if (platform && isKnownPlatform(platform)) return platform;
        return isYouTube(url) ? 'youtube' : 'generic';
    }

    private attachHover(anchor: HTMLAnchorElement, data: TooltipData): void {
        let timer: ReturnType<typeof setTimeout> | null = null;
        anchor.addEventListener('mouseenter', () => {
            if (timer !== null) clearTimeout(timer);
            timer = setTimeout(() => {
                timer = null;
                this.ui.show(anchor, data, this.settings.theme);
            }, HOVER_DELAY_MS);
        });
        anchor.addEventListener('mouseleave', () => {
            if (timer !== null) {
                clearTimeout(timer);
                timer = null;
            }
            this.ui.hide();
        });
    }
}
