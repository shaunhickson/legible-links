import { describe, it, expect, beforeEach } from 'vitest';
import { renderResolvedLink, restoreLink } from './render';

const HREF = 'https://www.example.com/path?q=1';

function makeAnchor(href = HREF, text = href): HTMLAnchorElement {
    const a = document.createElement('a');
    a.setAttribute('href', href);
    a.textContent = text;
    document.body.appendChild(a);
    return a;
}

describe('renderResolvedLink', () => {
    beforeEach(() => {
        document.body.replaceChildren();
        delete (window as unknown as { __pwned?: unknown }).__pwned;
    });

    it.each([
        ['<img src=x onerror="window.__pwned=1">'],
        ['"><svg onload=alert(1)>'],
        ['<script>window.__pwned=1</script>'],
    ])('renders %s as inert text', (payload) => {
        const a = makeAnchor();
        expect(renderResolvedLink(a, { title: payload, href: HREF, platform: 'generic' })).toBe(true);

        expect(a.querySelector('img, script')).toBeNull();
        const svgs = a.querySelectorAll('svg');
        expect(svgs.length).toBe(1);
        expect(svgs[0].getAttribute('class')).toBe('ll-icon');
        expect(svgs[0].hasAttribute('onload')).toBe(false);
        expect(a.querySelector('.ll-title')?.textContent).toBe(payload);
        expect(a.textContent).toContain(payload.startsWith('<img') ? '<img' : payload);
        expect((window as unknown as { __pwned?: unknown }).__pwned).toBeUndefined();
    });

    it('shows the hostname next to the title', () => {
        const a = makeAnchor();
        renderResolvedLink(a, { title: 'Example Title', href: HREF, platform: 'generic' });
        const domain = a.querySelector('.ll-domain');
        expect(domain).not.toBeNull();
        expect(domain?.textContent).toBe(' · www.example.com');
        expect(a.textContent).toBe('Example Title · www.example.com');
    });

    it('never changes href', () => {
        const a = makeAnchor();
        const before = a.getAttribute('href');
        renderResolvedLink(a, { title: 'T', href: 'https://elsewhere.example.org/', platform: 'generic' });
        expect(a.getAttribute('href')).toBe(before);
    });

    it('puts the target URL in the title attribute when none exists', () => {
        const a = makeAnchor();
        renderResolvedLink(a, { title: 'T', href: HREF, platform: 'generic' });
        expect(a.getAttribute('title')).toBe(HREF);
    });

    it('keeps an existing title attribute', () => {
        const a = makeAnchor();
        a.setAttribute('title', 'author tooltip');
        renderResolvedLink(a, { title: 'T', href: HREF, platform: 'generic' });
        expect(a.getAttribute('title')).toBe('author tooltip');
    });

    it('stores the original text once and marks the anchor', () => {
        const a = makeAnchor(HREF, '  https://www.example.com/path?q=1  ');
        renderResolvedLink(a, { title: 'First', href: HREF, platform: 'generic' });
        expect(a.dataset.llOriginalText).toBe('  https://www.example.com/path?q=1  ');
        expect(a.classList.contains('ll-resolved')).toBe(true);
        renderResolvedLink(a, { title: 'Second', href: HREF, platform: 'generic' });
        expect(a.dataset.llOriginalText).toBe('  https://www.example.com/path?q=1  ');
        expect(a.querySelector('.ll-title')?.textContent).toBe('Second');
    });

    it('uses the platform icon path, falling back to generic', () => {
        const a = makeAnchor();
        renderResolvedLink(a, { title: 'T', href: HREF, platform: 'youtube' });
        const yt = a.querySelector('svg path')?.getAttribute('d');
        const b = makeAnchor();
        renderResolvedLink(b, { title: 'T', href: HREF, platform: 'constructor' });
        const generic = b.querySelector('svg path')?.getAttribute('d');
        expect(yt).toBeTruthy();
        expect(generic).toBeTruthy();
        expect(yt).not.toBe(generic);
        expect(b.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 24 24');
    });

    it('returns false and leaves the anchor untouched on an unparseable href', () => {
        const a = makeAnchor('not a url', 'not a url');
        expect(renderResolvedLink(a, { title: 'T', href: 'not a url', platform: 'generic' })).toBe(false);
        expect(a.textContent).toBe('not a url');
        expect(a.children.length).toBe(0);
        expect(a.hasAttribute('title')).toBe(false);
        expect(a.dataset.llOriginalText).toBeUndefined();
        expect(a.classList.contains('ll-resolved')).toBe(false);
    });
});

describe('restoreLink', () => {
    it('puts the original text back and removes what was added', () => {
        const a = makeAnchor();
        renderResolvedLink(a, { title: 'T', href: HREF, platform: 'generic' });
        restoreLink(a);
        expect(a.textContent).toBe(HREF);
        expect(a.children.length).toBe(0);
        expect(a.hasAttribute('title')).toBe(false);
        expect(a.classList.contains('ll-resolved')).toBe(false);
        expect(a.dataset.llOriginalText).toBeUndefined();
    });

    it('keeps a pre-existing title attribute', () => {
        const a = makeAnchor();
        a.setAttribute('title', 'mine');
        renderResolvedLink(a, { title: 'T', href: HREF, platform: 'generic' });
        restoreLink(a);
        expect(a.getAttribute('title')).toBe('mine');
    });

    it('is a no-op on an anchor that was never rendered', () => {
        const a = makeAnchor();
        restoreLink(a);
        expect(a.textContent).toBe(HREF);
    });
});
