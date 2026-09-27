import { destinationHost, hostnameOf } from './destination';

export { destinationHost };
import { createIconElement } from './ui';

export interface ResolvedLink {
    title: string;
    href: string;
    platform: string;
    /** Where an unshortened link lands; shown next to the original host when it differs. */
    finalUrl?: string;
}

/**
 * Replaces an anchor's visible text with `[icon] Title · hostname`, or
 * `[icon] Title · final-host via hostname` for an unshortened link.
 * Text goes in via textContent only; `href` is never touched; the original
 * text is kept in data-ll-original-text and the target URL in `title`.
 * Returns false (and changes nothing) when `href` cannot be parsed.
 */
export function renderResolvedLink(anchor: HTMLAnchorElement, r: ResolvedLink): boolean {
    const hostname = hostnameOf(r.href);
    if (!hostname) return false;
    const finalHost = destinationHost(r.href, r.finalUrl);

    const doc = anchor.ownerDocument;

    if (anchor.dataset.llOriginalText === undefined) {
        anchor.dataset.llOriginalText = anchor.textContent ?? '';
    }
    if (!anchor.hasAttribute('title')) {
        anchor.title = finalHost ? `${r.finalUrl} (via ${r.href})` : r.href;
        anchor.dataset.llSetTitle = '1';
    }
    anchor.classList.add('ll-resolved');

    const icon = createIconElement(doc, r.platform, 'll-icon');
    icon.style.verticalAlign = 'middle';
    icon.style.marginRight = '4px';

    const titleSpan = doc.createElement('span');
    titleSpan.className = 'll-title';
    titleSpan.textContent = r.title;

    const domainSpan = doc.createElement('span');
    domainSpan.className = 'll-domain';
    domainSpan.textContent = finalHost ? ` · ${finalHost} via ${hostname}` : ' · ' + hostname;
    domainSpan.style.opacity = '0.7';
    domainSpan.style.fontSize = '0.85em';

    anchor.replaceChildren(icon, titleSpan, domainSpan);
    return true;
}

/**
 * Puts the original visible text back and removes what renderResolvedLink added.
 */
export function restoreLink(anchor: HTMLAnchorElement): void {
    const original = anchor.dataset.llOriginalText;
    if (original === undefined) return;
    anchor.replaceChildren(anchor.ownerDocument.createTextNode(original));
    anchor.classList.remove('ll-resolved');
    if (anchor.dataset.llSetTitle) {
        anchor.removeAttribute('title');
        delete anchor.dataset.llSetTitle;
    }
    delete anchor.dataset.llOriginalText;
}
