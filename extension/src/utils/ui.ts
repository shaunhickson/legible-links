/**
 * UI manager for Legible Links.
 * Hosts the hover tooltip in a closed shadow root. Every node is built with
 * createElement/textContent; no markup strings are ever parsed.
 */

const TOOLTIP_HOST_ID = 'll-tooltip-root';
const SVG_NS = 'http://www.w3.org/2000/svg';

export interface TooltipData {
    title: string;
    description?: string;
    domain: string;
    url: string;
    platform: string;
}

export interface IconData {
    viewBox: string;
    path: string;
}

/**
 * Platform icons as path data (rendered via createElementNS, never as markup).
 */
export const ICONS: Record<string, IconData> = {
    youtube: {
        viewBox: '0 0 24 24',
        path: 'M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z',
    },
    x: {
        viewBox: '0 0 24 24',
        path: 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z',
    },
    reddit: {
        viewBox: '0 0 24 24',
        path: 'M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10-4.477 10-10 10zm-3.23-5.26c-1.464 0-2.65-1.186-2.65-2.65 0-.58.188-1.116.51-1.554-1.353-.872-2.225-2.27-2.225-3.864 0-2.583 2.276-4.675 5.085-4.675 1.574 0 2.983.655 3.924 1.688l2.67-1.895.894 1.988-2.695 1.913c.094.343.144.707.144 1.082 0 2.582-2.276 4.674-5.086 4.674h-.57c0 1.463-1.187 2.65-2.652 2.65zm0-3.61c.53 0 .96.43.96.96s-.43.96-.96.96-.96-.43-.96-.96.43-.96.96-.96z',
    },
    wikipedia: {
        viewBox: '0 0 24 24',
        path: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 14.5h-2v-2h2v2zm0-4h-2V7h2v5.5z',
    },
    spotify: {
        viewBox: '0 0 24 24',
        path: 'M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.496 17.316c-.23.364-.707.474-1.071.246-2.936-1.79-6.626-2.193-10.978-1.201-.412.094-.82-.165-.913-.575-.094-.412.165-.82.576-.913 4.757-1.08 8.825-.63 12.14 1.371.364.22.474.7.246 1.072zm1.488-3.29c-.292.476-.914.629-1.39.336-3.37-2.068-8.528-2.673-12.217-1.464-.542.176-1.119-.115-1.294-.658-.176-.543.115-1.119.658-1.294 4.248-1.391 10.026-.714 13.906 1.67.477.291.63.913.337 1.39zm.135-3.468c-4.045-2.4-10.741-2.62-14.622-1.448-.654.198-1.344-.173-1.542-.828-.198-.654.173-1.344.828-1.542 4.475-1.35 11.879-1.087 16.541 1.68.588.349.782 1.108.433 1.696-.349.588-1.108.782-1.638.442z',
    },
    generic: {
        viewBox: '0 0 24 24',
        path: 'M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z',
    },
    link: {
        viewBox: '0 0 24 24',
        path: 'M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z',
    },
};
// The backend may still name the platform "twitter".
ICONS.twitter = ICONS.x;

export function isKnownPlatform(platform: string): boolean {
    return Object.prototype.hasOwnProperty.call(ICONS, platform);
}

/**
 * Builds an inline SVG icon for a platform from path data. Unknown platforms get the generic icon.
 */
export function createIconElement(doc: Document, platform: string, className: string): SVGSVGElement {
    const icon = isKnownPlatform(platform) ? ICONS[platform] : ICONS.generic;
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', icon.viewBox);
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('width', '1em');
    svg.setAttribute('height', '1em');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', className);
    const path = doc.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', icon.path);
    svg.appendChild(path);
    return svg;
}

const TOOLTIP_STYLES = `
    :host {
        --ll-bg: #ffffff;
        --ll-text: #333333;
        --ll-header: #888888;
        --ll-title: #000000;
        --ll-border: #eeeeee;
        --ll-shadow: rgba(0,0,0,0.15);
    }

    .tooltip.dark {
        --ll-bg: #1e1e1e;
        --ll-text: #cccccc;
        --ll-header: #aaaaaa;
        --ll-title: #ffffff;
        --ll-border: #333333;
        --ll-shadow: rgba(0,0,0,0.5);
    }

    @media (prefers-color-scheme: dark) {
        .tooltip.system {
            --ll-bg: #1e1e1e;
            --ll-text: #cccccc;
            --ll-header: #aaaaaa;
            --ll-title: #ffffff;
            --ll-border: #333333;
            --ll-shadow: rgba(0,0,0,0.5);
        }
    }

    .tooltip {
        position: absolute;
        z-index: 1000000;
        background: var(--ll-bg);
        color: var(--ll-text);
        padding: 12px;
        border-radius: 8px;
        box-shadow: 0 4px 12px var(--ll-shadow);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-size: 14px;
        line-height: 1.4;
        width: 280px;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.2s ease-in-out;
        border: 1px solid var(--ll-border);
        visibility: hidden;
    }
    .tooltip.visible {
        opacity: 1;
        visibility: visible;
    }
    .header {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--ll-header);
        margin-bottom: 4px;
        display: flex;
        align-items: center;
    }
    .title {
        font-weight: 600;
        color: var(--ll-title);
        margin-bottom: 6px;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }
    .description {
        font-size: 13px;
        color: var(--ll-text);
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }
    .url {
        margin-top: 6px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 11px;
        color: var(--ll-header);
        word-break: break-all;
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }
    .platform-icon {
        width: 12px;
        height: 12px;
        margin-right: 4px;
        flex-shrink: 0;
    }
`;

export interface UIManagerOptions {
    doc?: Document;
    hostId?: string;
}

export class UIManager {
    private readonly doc: Document | null;
    private readonly hostId: string;
    private host: HTMLDivElement | null = null;
    private shadow: ShadowRoot | null = null;
    private tooltip: HTMLDivElement | null = null;

    constructor(options: UIManagerOptions = {}) {
        this.doc = options.doc ?? (typeof document === 'undefined' ? null : document);
        this.hostId = options.hostId ?? TOOLTIP_HOST_ID;
        if (!this.doc) return;
        this.createShadowRoot(this.doc);
    }

    private createShadowRoot(doc: Document) {
        if (doc.getElementById(this.hostId) || !doc.body) return;

        this.host = doc.createElement('div');
        this.host.id = this.hostId;
        doc.body.appendChild(this.host);

        this.shadow = this.host.attachShadow({ mode: 'closed' });

        const style = doc.createElement('style');
        style.textContent = TOOLTIP_STYLES;
        this.shadow.appendChild(style);

        this.tooltip = doc.createElement('div');
        this.tooltip.className = 'tooltip';
        this.shadow.appendChild(this.tooltip);
    }

    private block(doc: Document, className: string, text: string): HTMLDivElement {
        const div = doc.createElement('div');
        div.className = className;
        div.textContent = text;
        return div;
    }

    public show(target: HTMLElement, data: TooltipData, theme: string = 'system') {
        const doc = this.doc;
        const tooltip = this.tooltip;
        if (!doc || !tooltip) return;

        const header = doc.createElement('div');
        header.className = 'header';
        const domain = doc.createElement('span');
        domain.textContent = data.domain;
        header.append(createIconElement(doc, data.platform, 'platform-icon'), domain);

        const parts: HTMLElement[] = [header, this.block(doc, 'title', data.title)];
        if (data.description) {
            parts.push(this.block(doc, 'description', data.description));
        }
        parts.push(this.block(doc, 'url', data.url));
        tooltip.replaceChildren(...parts);

        tooltip.classList.remove('light', 'dark', 'system');
        tooltip.classList.add(theme === 'light' || theme === 'dark' ? theme : 'system');

        const rect = target.getBoundingClientRect();
        const view = doc.defaultView;
        const scrollX = view ? view.scrollX : 0;
        const scrollY = view ? view.scrollY : 0;
        tooltip.style.top = `${rect.bottom + scrollY + 8}px`;
        tooltip.style.left = `${rect.left + scrollX}px`;
        tooltip.classList.add('visible');
    }

    public hide() {
        if (this.tooltip) {
            this.tooltip.classList.remove('visible');
        }
    }
}

export const uiManager = new UIManager();
