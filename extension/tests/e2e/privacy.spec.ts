import { test, expect, fixtureUrl, applySettings, mockBackend, mockYouTube } from './fixtures';

const VIDEO_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const WIKI_URL = 'https://en.wikipedia.org/wiki/Alan_Turing';
const ARTICLE_URL = 'https://example.org/blog/2026/post';

test('Private mode: nothing leaves the browser on load; hovering a YouTube link asks YouTube once', async ({ context, page }) => {
  const oembedCalls = await mockYouTube(context);
  const backendBatches = await mockBackend(context);
  await applySettings(context, { platformMode: 'hover', genericMode: 'off' });

  await page.goto(fixtureUrl('test.html'));

  // Local titles still appear; that proves the extension ran on this page.
  await expect(page.locator(`a[href="${WIKI_URL}"]`)).toContainText('Alan Turing');
  await page.waitForTimeout(1500); // longer than the batch delay
  expect(oembedCalls).toEqual([]);
  expect(backendBatches).toEqual([]);
  const video = page.locator(`a[href="${VIDEO_URL}"]`);
  const article = page.locator(`a[href="${ARTICLE_URL}"]`);
  await expect(video).toHaveText(VIDEO_URL);
  await expect(article).toHaveText(ARTICLE_URL);

  await video.hover();
  await expect(video).toContainText('Rick Astley');
  expect(oembedCalls).toHaveLength(1);
  expect(backendBatches).toEqual([]);

  // Generic links stay raw in Private mode even when hovered.
  await article.hover();
  await page.waitForTimeout(800);
  await expect(article).toHaveText(ARTICLE_URL);
  expect(backendBatches).toEqual([]);
});
