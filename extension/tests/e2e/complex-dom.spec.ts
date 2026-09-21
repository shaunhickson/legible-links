import { test, expect, fixtureUrl } from './fixtures';

test.describe('Complex DOM Scenarios', () => {

  test.beforeEach(async ({ page }) => {
    await page.route('**/resolve*', async (route) => {
      const body = route.request().postDataJSON() as { urls?: string[] } | null;
      const urls = body?.urls ?? [];

      const titles: Record<string, string> = {};
      for (const url of urls) {
        if (url.includes('shadowdom')) {
          titles[url] = "Shadow DOM Link Resolved";
        } else if (url.includes('SPA')) {
          titles[url] = "React SPA Link Resolved";
        } else if (url.includes('scroll')) {
          titles[url] = `Scroll Link Resolved`;
        } else {
          titles[url] = "Mocked Generic Title";
        }
      }

      await route.fulfill({ json: { titles } });
    });
  });

  test('React SPA Test: Link injected after initial load is resolved', async ({ page }) => {
    await page.goto(fixtureUrl('fixtures/react-spa.html'));

    // Wait for the simulated SPA link injection (500ms in fixture) + batching
    const link = page.locator('a[href="https://www.youtube.com/watch?v=SPA"]');
    await expect(link).toContainText('React SPA Link Resolved');
  });

  test('Infinite Scroll Test: Multiple links injected continuously are resolved', async ({ page }) => {
    const batches: number[] = [];
    await page.route('**/resolve*', async (route) => {
      const body = route.request().postDataJSON() as { urls?: string[] } | null;
      const urls = body?.urls ?? [];
      batches.push(urls.length);
      const titles: Record<string, string> = {};
      for (const url of urls) titles[url] = 'Scroll Link Resolved';
      await route.fulfill({ json: { titles } });
    });

    await page.goto(fixtureUrl('fixtures/infinite-scroll.html'));

    // Pick a few links to verify
    const link0 = page.locator('a[href="https://www.youtube.com/watch?v=scroll0"]');
    const link49 = page.locator('a[href="https://www.youtube.com/watch?v=scroll49"]');

    await expect(link0).toContainText('Scroll Link Resolved');
    await expect(link49).toContainText('Scroll Link Resolved');

    // 50 links are sent in chunks of at most 25 URLs per request.
    expect(Math.max(...batches)).toBeLessThanOrEqual(25);
    expect(batches.reduce((a, b) => a + b, 0)).toBe(50);
  });

  // Note: Currently skipped because our MutationObserver does not pierce Shadow DOM
  test.skip('Shadow DOM Test: Link inside open shadow root is resolved', async ({ page }) => {
    await page.goto(fixtureUrl('fixtures/shadow-dom.html'));

    // We must pierce the shadow DOM to find the link
    const link = page.locator('#host').locator('a');
    await expect(link).toContainText('Shadow DOM Link Resolved');
  });
});
