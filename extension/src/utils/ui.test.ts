import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { UIManager, ICONS, createIconElement, isKnownPlatform } from './ui';

describe('UIManager tooltip', () => {
    let shadow: ShadowRoot;
    let ui: UIManager;
    let anchor: HTMLAnchorElement;
    let spy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        spy = vi.spyOn(Element.prototype, 'attachShadow');
        ui = new UIManager({ hostId: 'll-test-tooltip-' + Math.random().toString(36).slice(2) });
        shadow = spy.mock.results[0].value as ShadowRoot;
        anchor = document.createElement('a');
        document.body.appendChild(anchor);
    });

    afterEach(() => {
        spy.mockRestore();
    });

    it('never renders markup from the domain, title or description', () => {
        ui.show(anchor, {
            title: '<i>title</i>',
            description: '<script>window.__pwned=1</script>',
            domain: '<b>x</b>',
            url: 'https://example.com/p?q=1',
            platform: 'generic',
        });
        expect(shadow.querySelector('b')).toBeNull();
        expect(shadow.querySelector('i')).toBeNull();
        expect(shadow.querySelector('script')).toBeNull();
        expect(shadow.querySelector('.header')?.textContent).toBe('<b>x</b>');
        expect(shadow.querySelector('.title')?.textContent).toBe('<i>title</i>');
        expect(shadow.querySelector('.description')?.textContent).toBe('<script>window.__pwned=1</script>');
        expect((window as unknown as { __pwned?: unknown }).__pwned).toBeUndefined();
    });

    it('shows the original URL as text', () => {
        const url = 'https://example.com/path?token=<b>&x=1';
        ui.show(anchor, { title: 'T', domain: 'example.com', url, platform: 'generic' });
        const line = shadow.querySelector('.url');
        expect(line).not.toBeNull();
        expect(line?.textContent).toBe(url);
        expect(line?.children.length).toBe(0);
    });

    it('omits the description block when there is none', () => {
        ui.show(anchor, { title: 'T', domain: 'example.com', url: 'https://example.com/', platform: 'generic' });
        expect(shadow.querySelector('.description')).toBeNull();
    });

    it('replaces previous content on each show', () => {
        ui.show(anchor, { title: 'One', domain: 'a.example', url: 'https://a.example/', platform: 'generic' });
        ui.show(anchor, { title: 'Two', domain: 'b.example', url: 'https://b.example/', platform: 'youtube' });
        expect(shadow.querySelectorAll('.title').length).toBe(1);
        expect(shadow.querySelector('.title')?.textContent).toBe('Two');
    });

    it('applies the theme class and toggles visibility', () => {
        ui.show(anchor, { title: 'T', domain: 'd', url: 'https://d/', platform: 'generic' }, 'dark');
        const tooltip = shadow.querySelector('.tooltip');
        expect(tooltip?.classList.contains('dark')).toBe(true);
        expect(tooltip?.classList.contains('visible')).toBe(true);
        ui.hide();
        expect(tooltip?.classList.contains('visible')).toBe(false);
        ui.show(anchor, { title: 'T', domain: 'd', url: 'https://d/', platform: 'generic' }, 'weird');
        expect(tooltip?.classList.contains('system')).toBe(true);
    });

    it('uses a closed shadow root', () => {
        expect(spy).toHaveBeenCalledWith({ mode: 'closed' });
    });
});

describe('ICONS', () => {
    it('is path data, not markup', () => {
        for (const [name, icon] of Object.entries(ICONS)) {
            expect(typeof icon.viewBox, name).toBe('string');
            expect(typeof icon.path, name).toBe('string');
            expect(icon.path, name).not.toContain('<');
        }
        expect(isKnownPlatform('youtube')).toBe(true);
        expect(isKnownPlatform('constructor')).toBe(false);
        expect(isKnownPlatform('linkedin')).toBe(false);
    });

    it('createIconElement builds an svg with a single path', () => {
        const svg = createIconElement(document, 'reddit', 'cls');
        expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
        expect(svg.getAttribute('class')).toBe('cls');
        expect(svg.children.length).toBe(1);
        expect(svg.firstElementChild?.getAttribute('d')).toBe(ICONS.reddit.path);
    });
});
