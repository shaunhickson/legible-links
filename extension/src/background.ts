/**
 * Service worker (Chrome) / background script (Firefox). All network for the
 * extension happens here; the content script only sends RESOLVE messages.
 */
import { createMessageHandler } from './background/listener';
import { createRouter } from './background/router';
import { CacheStorage, createCache } from './utils/cache';
import { getSettings } from './utils/settings';

/** Callback style so the same code works in Chrome and Firefox without a polyfill. */
function sessionStorage(): CacheStorage | undefined {
    const area = chrome.storage?.session;
    if (!area) return undefined; // older Firefox: memory only
    return {
        get: (key) => new Promise((resolve, reject) => {
            area.get(key, (items) => {
                const err = chrome.runtime.lastError;
                if (err) reject(new Error(err.message));
                else resolve(items);
            });
        }),
        set: (items) => new Promise((resolve, reject) => {
            area.set(items, () => {
                const err = chrome.runtime.lastError;
                if (err) reject(new Error(err.message));
                else resolve();
            });
        }),
    };
}

const cache = createCache({ storage: sessionStorage() });
const router = createRouter({
    fetchFn: (input, init) => fetch(input, init),
    cache,
    getSettings,
});

chrome.runtime.onMessage.addListener(createMessageHandler(router, chrome.runtime.id));
