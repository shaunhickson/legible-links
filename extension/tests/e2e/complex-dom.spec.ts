import { test, expect, fixtureUrl, applySettings, mockBackend, mockYouTube } from './fixtures';

test.describe('Complex DOM Scenarios', () => {
  test('React SPA Test: Link injected after initial load is resolved', async ({ context, page }) => {
    const oembedCalls = await mockYouTube(context);
    await page.goto(fixtureUrl('fixtures/react-spa.html'));

    // Wait for the simulated SPA link injection (500ms in fixture) + batching
    const link = page.locator('a[href="https://www.youtube.com/watch?v=spa00000001"]');
    await expect(link).toContainText('Rick Astley');
    expect(oembedCalls).toHaveLength(1);
  });

  test('Infinite Scroll Test: 50 generic links in Everything mode are sent in batches of at most 25', async ({ context, page }) => {
    const batches = await mockBackend(context, () => 'Scroll Link Resolved');
    await applySettings(context, { genericMode: 'auto' });

    await page.goto(fixtureUrl('fixtures/infinite-scroll.html'));

    const link0 = page.locator('a[href="https://example.org/scroll/0"]');
    const link49 = page.locator('a[href="https://example.org/scroll/49"]');
    await expect(link0).toContainText('Scroll Link Resolved');
    await expect(link49).toContainText('Scroll Link Resolved');

    expect(Math.max(...batches.map((b) => b.length))).toBeLessThanOrEqual(25);
    expect(batches.reduce((a, b) => a + b.length, 0)).toBe(50);
  });

  // Note: Currently skipped because our MutationObserver does not pierce Shadow DOM
  test.skip('Shadow DOM Test: Link inside open shadow root is resolved', async ({ page }) => {
    await page.goto(fixtureUrl('fixtures/shadow-dom.html'));

    // We must pierce the shadow DOM to find the link
    const link = page.locator('#host').locator('a');
    await expect(link).toContainText('Shadow DOM Link Resolved');
  });
});
