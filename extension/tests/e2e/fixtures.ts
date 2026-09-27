import { test as base, chromium, type BrowserContext, type Worker } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

// All network now happens in the service worker; this flag lets context.route()
// see and answer those requests.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Fixtures are served by tests/e2e/server.mjs (started by playwright.config.ts webServer). */
export const FIXTURE_BASE = 'http://127.0.0.1:4173';

export function fixtureUrl(file: string): string {
  return `${FIXTURE_BASE}/${file}`;
}

export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
}>({
  context: async ({}, use) => {
    const pathToExtension = path.join(__dirname, '../../dist');
    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--headless=new`,
        `--disable-extensions-except=${pathToExtension}`,
        `--load-extension=${pathToExtension}`,
      ],
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    const background = await backgroundWorker(context);
    const extensionId = background.url().split('/')[2];
    await use(extensionId);
  },
});
export const expect = test.expect;

export async function backgroundWorker(context: BrowserContext): Promise<Worker> {
  let [background] = context.serviceWorkers();
  if (!background) background = await context.waitForEvent('serviceworker');
  return background;
}

/** Writes settings through the worker, exactly as the options page would. */
export async function applySettings(context: BrowserContext, settings: Record<string, unknown>): Promise<void> {
  const worker = await backgroundWorker(context);
  await worker.evaluate((s) => new Promise<void>((resolve) => chrome.storage.local.set(s, () => resolve())), settings);
}

export const YOUTUBE_OEMBED = {
  title: 'Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)',
  author_name: 'Rick Astley',
  provider_name: 'YouTube',
  type: 'video',
};

/** Answers every YouTube oEmbed request from the worker and records the URLs asked for. */
export async function mockYouTube(context: BrowserContext): Promise<string[]> {
  const calls: string[] = [];
  await context.route('https://www.youtube.com/oembed**', async (route) => {
    calls.push(route.request().url());
    await route.fulfill({ json: YOUTUBE_OEMBED });
  });
  return calls;
}

/** Answers every POST to our server with a title per URL and records each batch. */
export async function mockBackend(context: BrowserContext, title: (url: string) => string = () => 'Resolved by our server'): Promise<string[][]> {
  const batches: string[][] = [];
  await context.route('**/resolve*', async (route) => {
    const body = route.request().postDataJSON() as { urls?: string[] } | null;
    const urls = body?.urls ?? [];
    batches.push(urls);
    const titles: Record<string, string> = {};
    for (const url of urls) titles[url] = title(url);
    await route.fulfill({ json: { titles } });
  });
  return batches;
}
