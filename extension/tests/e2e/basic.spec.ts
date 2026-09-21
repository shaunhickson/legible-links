import { test, expect, fixtureUrl } from './fixtures';

const VIDEO_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const TITLE = 'Rick Astley - Never Gonna Give You Up (Official Music Video)';

test('Legible Links rewrites a raw-URL link and keeps the href', async ({ page }) => {
  // 1. Mock the backend so the test is fast, deterministic and never touches production.
  const requestedUrls: string[][] = [];
  await page.route('**/resolve*', async (route) => {
    const body = route.request().postDataJSON() as { urls?: string[] } | null;
    const urls = body?.urls ?? [];
    requestedUrls.push(urls);
    const titles: Record<string, string> = {};
    const details: Record<string, { platform: string }> = {};
    for (const url of urls) {
      titles[url] = TITLE;
      details[url] = { platform: 'YouTube' };
    }
    await route.fulfill({ json: { titles, details } });
  });

  // 2. Open the fixture over HTTP (the content script does not match file://).
  await page.goto(fixtureUrl('test.html'));

  // 3. The link text becomes the mocked title plus the hostname; the href is untouched.
  const link = page.locator(`a[href="${VIDEO_URL}"]`);
  await expect(link).toContainText('Rick Astley - Never Gonna Give You Up');
  await expect(link).toContainText('www.youtube.com');
  await expect(link).toHaveAttribute('href', VIDEO_URL);
  await expect(link).toHaveAttribute('title', VIDEO_URL);
  await expect(link).toHaveClass(/ll-resolved/);
  await expect(link.locator('svg.ll-icon')).toHaveCount(1);

  // 4. Exactly the raw URL on the page was sent, as a batch POST.
  expect(requestedUrls.flat()).toEqual([VIDEO_URL]);
});
