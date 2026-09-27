import { isRawUrl } from '../utils/url';
import { DEFAULT_SETTINGS, getDomain, getSettings, isDomainAllowed, normalizeSettings, Settings } from '../utils/settings';
import { isKnownPlatform, TooltipData, uiManager } from '../utils/ui';
import { sanitizeDescription, sanitizeTitle } from '../utils/sanitize';
import { renderResolvedLink } from '../utils/render';
import { classifyUrl, isEditableContext, textDomainMatchesHref } from '../utils/sensitive';
import { Outcome, readResolveResponse, ResolvedOutcome, ResolveRequest, Trigger } from '../shared/protocol';

/** Anchors enqueued over the lifetime of a page. */
export const MAX_ANCHORS_PER_PAGE = 300;
/** Anchors enqueued from a single MutationObserver pass. */
export const MAX_ANCHORS_PER_PASS = 50;
/** URLs per RESOLVE message to the worker (which batches the backend at the same size). */
export const CHUNK_SIZE = 25;
/** Message attempts per anchor before giving up on it. */
export const MAX_ATTEMPTS = 3;
/** How long the pointer must rest on a deferred link before it is resolved. */
export const HOVER_RESOLVE_DELAY_MS = 300;

const BATCH_DELAY_MS = 500;
const TOOLTIP_DELAY_MS = 500;
const XHTML_NS = 'http://www.w3.org/1999/xhtml';
const NONE: Outcome = { status: 'none' };

/** Sends a RESOLVE request to the worker. The content script itself never calls fetch. */
export type ResolveFn = (request: ResolveRequest) => Promise<unknown>;

export interface TooltipUI {
    show(target: HTMLElement, data: TooltipData, theme?: string): void;
    hide(): void;
}

export interface LinkOptimizerOptions {
    resolveFn?: ResolveFn;
    doc?: Document;
    loadSettings?: () => Promise<Settings>;
    ui?: TooltipUI;
    batchDelayMs?: number;
    hoverDelayMs?: number;
}

type AnchorState = 'pending' | 'hover' | 'done';

function isHtmlAnchor(node: Node): node is HTMLAnchorElement {
    return node.nodeType === 1
        && (node as Element).localName === 'a'
        && (node as Element).namespaceURI === XHTML_NS;
}

/** Callback style so the same code works in Chrome and Firefox without a polyfill. */
function sendToWorker(request: ResolveRequest): Promise<unknown> {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(request, (response: unknown) => {
            const err = chrome.runtime.lastError;
            if (err) reject(new Error(err.message));
            else resolve(response);
        });
    });
}

export class LinkOptimizer {
    private readonly resolveFn: ResolveFn;
    private readonly doc: Document;
    private readonly loadSettings: () => Promise<Settings>;
    private readonly ui: TooltipUI;
    private readonly batchDelayMs: number;
    private readonly hoverDelayMs: number;

    private settings: Settings = DEFAULT_SETTINGS;
    private readonly state = new WeakMap<HTMLAnchorElement, AnchorState>();
    private readonly attempts = new WeakMap<HTMLAnchorElement, number>();
    private pending = new Map<string, HTMLAnchorElement[]>();
    /** Anchors waiting for a hover, grouped by URL so one hover resolves all of them. */
    private readonly deferred = new Map<string, Set<HTMLAnchorElement>>();
    private enqueuedTotal = 0;
    private batchTimer: ReturnType<typeof setTimeout> | null = null;
    private chain: Promise<void> = Promise.resolve();
    private observer: MutationObserver | null = null;

    constructor(options: LinkOptimizerOptions = {}) {
        this.resolveFn = options.resolveFn ?? sendToWorker;
        this.doc = options.doc ?? document;
        this.loadSettings = options.loadSettings ?? getSettings;
        this.ui = options.ui ?? uiManager;
        this.batchDelayMs = options.batchDelayMs ?? BATCH_DELAY_MS;
        this.hoverDelayMs = options.hoverDelayMs ?? HOVER_RESOLVE_DELAY_MS;
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

    /** Processes everything queued so far (including hover resolutions in flight) without waiting for timers. */
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
            this.settings = normalizeSettings(next);
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
            const outcomes = await this.resolve(chunk, 'auto');

            if (outcomes === null) {
                // Fail open: leave this and every remaining chunk untouched.
                for (const url of urls.slice(i)) this.markFailed(batch.get(url) ?? []);
                return;
            }

            for (const url of chunk) {
                this.apply(url, batch.get(url) ?? [], outcomes.get(url) ?? NONE);
            }
        }
    }

    private apply(url: string, anchors: HTMLAnchorElement[], outcome: Outcome): TooltipData | null {
        switch (outcome.status) {
            case 'resolved':
                for (const anchor of anchors) this.state.set(anchor, 'done');
                this.deferred.delete(url);
                return this.render(url, anchors, outcome);
            case 'hover':
                for (const anchor of anchors) {
                    if (this.state.get(anchor) === 'done') continue;
                    if (this.state.get(anchor) !== 'hover') {
                        this.state.set(anchor, 'hover');
                        this.attachHoverResolve(anchor, url);
                    }
                }
                return null;
            default:
                for (const anchor of anchors) this.state.set(anchor, 'done');
                this.deferred.delete(url);
                return null;
        }
    }

    /** Rewrites every anchor for `url`; returns the tooltip data when something was rendered. */
    private render(url: string, anchors: HTMLAnchorElement[], outcome: ResolvedOutcome): TooltipData | null {
        const title = sanitizeTitle(outcome.title);
        if (!title) return null;

        const platform = this.pickPlatform(outcome.platform);
        const description = sanitizeDescription(outcome.description);
        const tooltip: TooltipData = {
            title,
            description: description || undefined,
            domain: getDomain(url),
            url,
            platform,
            finalUrl: outcome.finalUrl,
        };

        let rendered = false;
        for (const anchor of anchors) {
            if (renderResolvedLink(anchor, { title, href: url, platform, finalUrl: outcome.finalUrl })) {
                this.attachTooltip(anchor, tooltip);
                rendered = true;
            }
        }
        return rendered ? tooltip : null;
    }

    private async resolve(urls: string[], trigger: Trigger): Promise<Map<string, Outcome> | null> {
        try {
            const response = await this.resolveFn({ type: 'RESOLVE', urls, trigger });
            return readResolveResponse(response);
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

    private pickPlatform(platform: string): string {
        const p = platform.toLowerCase();
        return isKnownPlatform(p) ? p : 'generic';
    }

    /**
     * A deferred anchor carries no visible marker. Resting the pointer on it for
     * HOVER_RESOLVE_DELAY_MS sends one hover-triggered request; on success the
     * link is rendered and the tooltip opens at once, since the pointer is still there.
     */
    private attachHoverResolve(anchor: HTMLAnchorElement, url: string): void {
        let group = this.deferred.get(url);
        if (!group) {
            group = new Set();
            this.deferred.set(url, group);
        }
        group.add(anchor);

        let timer: ReturnType<typeof setTimeout> | null = null;
        let hovered = false;
        let inFlight = false;

        anchor.addEventListener('mouseenter', () => {
            hovered = true;
            if (this.state.get(anchor) !== 'hover' || inFlight || timer !== null) return;
            timer = setTimeout(() => {
                timer = null;
                inFlight = true;
                this.chain = this.chain
                    .then(() => this.resolveOnHover(anchor, url, () => hovered))
                    .catch(() => undefined)
                    .finally(() => {
                        inFlight = false;
                    });
            }, this.hoverDelayMs);
        });
        anchor.addEventListener('mouseleave', () => {
            hovered = false;
            if (timer !== null) {
                clearTimeout(timer);
                timer = null;
            }
        });
    }

    private async resolveOnHover(anchor: HTMLAnchorElement, url: string, stillHovered: () => boolean): Promise<void> {
        if (this.state.get(anchor) !== 'hover') return;
        const outcomes = await this.resolve([url], 'hover');
        if (outcomes === null) return; // fail open; the anchor stays deferred for a later hover

        const anchors = Array.from(this.deferred.get(url) ?? [anchor]);
        const tooltip = this.apply(url, anchors, outcomes.get(url) ?? NONE);
        if (tooltip && stillHovered() && anchor.isConnected) {
            this.ui.show(anchor, tooltip, this.settings.theme);
        }
    }

    private attachTooltip(anchor: HTMLAnchorElement, data: TooltipData): void {
        let timer: ReturnType<typeof setTimeout> | null = null;
        anchor.addEventListener('mouseenter', () => {
            if (timer !== null) clearTimeout(timer);
            timer = setTimeout(() => {
                timer = null;
                this.ui.show(anchor, data, this.settings.theme);
            }, TOOLTIP_DELAY_MS);
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
