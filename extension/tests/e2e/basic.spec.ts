import { test, expect, fixtureUrl, mockBackend, mockYouTube } from './fixtures';

const VIDEO_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const WIKI_URL = 'https://en.wikipedia.org/wiki/Alan_Turing';
const ARTICLE_URL = 'https://example.org/blog/2026/post';

test('default install: platform link resolves at YouTube, generic link waits for hover, zero backend calls until then', async ({ context, page }) => {
  // 1. Fake the two places the worker may reach; the test never touches production.
  const oembedCalls = await mockYouTube(context);
  const backendBatches = await mockBackend(context, () => 'An example post');

  // 2. Open the fixture over HTTP (the content script does not match file://).
  await page.goto(fixtureUrl('test.html'));

  // 3. The YouTube link is rewritten from the platform's answer; the href is untouched.
  const video = page.locator(`a[href="${VIDEO_URL}"]`);
  await expect(video).toContainText('Rick Astley - Never Gonna Give You Up');
  await expect(video).toContainText('www.youtube.com');
  await expect(video).toHaveAttribute('href', VIDEO_URL);
  await expect(video).toHaveAttribute('title', VIDEO_URL);
  await expect(video).toHaveClass(/ll-resolved/);
  await expect(video.locator('svg.ll-icon')).toHaveCount(1);
  expect(oembedCalls).toEqual([
    'https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ&format=json',
  ]);

  // 4. The Wikipedia link is rewritten from the URL alone.
  const wiki = page.locator(`a[href="${WIKI_URL}"]`);
  await expect(wiki).toContainText('Alan Turing');
  await expect(wiki).toContainText('en.wikipedia.org');

  // 5. The generic link is still raw, and our server has not been contacted.
  const article = page.locator(`a[href="${ARTICLE_URL}"]`);
  await expect(article).toHaveText(ARTICLE_URL);
  await expect(article).not.toHaveClass(/ll-resolved/);
  expect(backendBatches).toEqual([]);

  // 6. Hovering it makes exactly one backend call, with exactly that URL, and rewrites it.
  await article.hover();
  await expect(article).toContainText('An example post');
  await expect(article).toContainText('example.org');
  await expect(article).toHaveAttribute('href', ARTICLE_URL);
  expect(backendBatches).toEqual([[ARTICLE_URL]]);
  expect(oembedCalls).toHaveLength(1);
});
