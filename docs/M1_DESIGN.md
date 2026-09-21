# M1 design: service worker, resolution tiers, privacy modes

Design record for milestone M1 of [`PLAN_2026-09.md`](PLAN_2026-09.md). Written 2026-09-21; the extension work is delivered as one PR (branch `m1/service-worker`), the backend work as a second (branch `m1/backend`, merged after the first).

## Goal
The default install never contacts our server without a hover. All network moves into the service worker. Resolution is tiered:

| Tier | What | Network |
|---|---|---|
| 0 | Titles derived from the URL itself (Wikipedia, GitHub, Reddit slugs, Stack Overflow, Amazon) | none |
| A | Platform oEmbed (YouTube, Spotify, X, Reddit, Vimeo) | direct to the platform, cookies omitted |
| B | Everything else, and unshortening | `POST apiUrl` |
| never | `classifyUrl` skips, high-entropy segments | none |

## Settings and modes
`platformMode: 'auto' | 'hover'` (default `auto`), `genericMode: 'off' | 'hover' | 'auto'` (default `hover`), `onboarded: boolean`. Presets: **Private** = hover/off, **Balanced** (default) = auto/hover, **Everything** = auto/auto. Tier 0 is always automatic.

## Message protocol
Request `{ type: 'RESOLVE', urls: string[], trigger: 'auto' | 'hover' }`. Response `{ results: Record<url, Outcome> }`:
```ts
type Outcome =
  | { status: 'resolved'; title; description?; platform; source: 'local'|'platform'|'backend'|'cache'; finalUrl? }
  | { status: 'hover' }   // resolvable only on hover in the current mode
  | { status: 'none' };
```
Defined in `src/shared/protocol.ts`; structurally validated in the worker. The worker accepts messages only from `sender.id === chrome.runtime.id` with an http(s) `sender.url`, and takes the page host from `sender.url`, never from message content.

## Router (`src/background/router.ts`, pure and testable)
`createRouter({ fetchFn, cache, getSettings, now?, resolvers? })`. Per URL:
1. `classifyUrl(url) !== 'ok'` → `none`.
2. `key = stripForTransmission(url)`; cache hit → `resolved` (source `cache`) or `none` for a negative entry.
3. Tier 0 match → resolve synchronously → `resolved` (`local`), cached.
4. Tier A match → if `platformMode === 'auto' || trigger === 'hover'` fetch → `resolved` (`platform`) or `none` (negative-cached 1 h); else `hover`.
5. Tier B: `hasHighEntropySegment(key)` → `none`. If `genericMode === 'auto' && !isSensitivePageHost(pageHost)`, or `genericMode !== 'off' && trigger === 'hover'` → batch 25 per POST → `resolved` (`backend`, `finalUrl` from `details[url].finalUrl` when present) or `none`. `genericMode === 'off'` → `none`; otherwise `hover`.

Tier A limits: `AbortSignal.timeout(4000)`, 4 in flight per host, 8 overall, 10-minute in-memory backoff per host after 429/5xx. Every title and description passes through `sanitizeTitle`/`sanitizeDescription` before caching or returning. Chrome service workers have no `DOMParser`; all parsing is string based.

## Resolvers (`src/resolvers/`)
`interface Resolver { id; tier: 0 | 'A'; canHandle(u: URL); resolve(u, { fetchFn, signal }) }`. Fixtures of real oEmbed responses live in `src/resolvers/__fixtures__/`.

Tier 0:
- `wikipedia`: `*.wikipedia.org/wiki/<Title>` → percent-decoded, `_`→space; description `<lang>.wikipedia.org`.
- `github`: `owner/repo`; `/issues/<n>` → `owner/repo issue #n`; `/pull/<n>` → `… pull request #n`; `/blob|tree/<ref>/<path>` → `owner/repo: <path>`; `/releases/tag/<tag>`; `/commit/<sha7>`; `/discussions/<n>`. Reserved first segments (settings, orgs, login, join, marketplace, explore, topics, sponsors, features, pricing, about, site, security, contact, apps, notifications, new, codespaces, enterprise, collections, events, trending, search, pulls, issues, dashboard) never match.
- `reddit`: `/r/<sub>/comments/<id>/<slug>/` → `r/<sub>: <slug>`; `/r/<sub>/` → `r/<sub>`; `/user|u/<name>` → `u/<name>`; slug-less comment URLs fall to Tier A.
- `stackoverflow`: Stack Exchange network `/questions/<id>/<slug>` → slug, first letter capitalised.
- `amazon`: `/<Product-Slug>/dp/<ASIN>` → slug.

Tier A (shared `oembed.ts`: `credentials:'omit'`, `cache:'no-store'`, `referrerPolicy:'no-referrer'`):
- `youtube`: all URL forms (`watch?v=`, `youtu.be`, `/shorts/`, `/live/`, `/embed/`, `/v/`, `m.`, `youtube-nocookie.com`) canonicalised to `https://www.youtube.com/watch?v=<id>`; endpoint `https://www.youtube.com/oembed?url=…&format=json`; title = `title`, description = `author_name`.
- `spotify`: `open.spotify.com/(track|album|playlist|artist|episode|show)/<id>`; endpoint `https://open.spotify.com/oembed?url=…`; title = `title`.
- `x`: `(twitter|x|mobile.twitter).com/<user>/status/<id>`; endpoint `https://publish.x.com/oembed?url=https://twitter.com/<user>/status/<id>&omit_script=true`; text from the first `<p>` in `html` (tags stripped, entities decoded); handle from `author_url`; title `@handle: <text>` capped at 100 chars.
- `reddit`: `/r/<sub>/comments/<id>`; endpoint `https://www.reddit.com/oembed?url=…`; title = `title`, description `u/<author_name>`.
- `vimeo`: `vimeo.com/<digits>`; endpoint `https://vimeo.com/api/oembed.json?url=…`; title, description = `author_name`.

Tier B (`backend.ts`): POST chunks of 25 exactly as M0's content script did (credentials omit, no-store, no-referrer, 10 s timeout); `parseResolveResponse` moves to `src/shared/wire.ts`.

## Cache (`src/utils/cache.ts`)
`createCache({ storage?, now?, maxEntries = 2000, ttlMs = 24h, negativeTtlMs = 1h })`; L1 `Map`, L2 `chrome.storage.session` as one blob key `ll-cache-v1` written debounced (500 ms); oldest-inserted eviction; expired entries are misses.

## Sensitive-URL additions (`src/utils/sensitive.ts`)
- `stripForTransmission(href)`: drop the fragment and `utm_*`, `fbclid, gclid, dclid, msclkid, mc_cid, mc_eid, igshid, si, ref_src, ref_url, feature, _hsenc, _hsmi, vero_id, yclid, twclid, ttclid, gbraid, wbraid`.
- `isSensitivePageHost(host)`: webmail, chat and document hosts (`mail.google.com`, `outlook.*`, `mail.yahoo.com`, `mail.proton.me`, `app.slack.com`, `discord.com`, `teams.microsoft.com`, `web.whatsapp.com`, `web.telegram.org`, `www.messenger.com`, `docs.google.com`, `drive.google.com`, `www.notion.so`; suffixes `.slack.com`, `.notion.site`, `.atlassian.net`, `.zendesk.com`, `.freshdesk.com`, `.intercom.io`). Only disables *automatic* Tier B.
- `hasHighEntropySegment(url)`: a path segment or query value ≥ 20 chars mixing letters and digits, or ≥ 32 hex chars. Tier B only.

## Content script
`resolveFn` (default `chrome.runtime.sendMessage`) replaces `fetch`; the M0 guards still run first. `hover` outcomes get a per-anchor 300 ms hover handler that sends `trigger:'hover'` and renders on success, keeping the tooltip open across the swap. No visible marker on deferred anchors. Fail open.

## Rendering
`renderResolvedLink` accepts `finalUrl`: the domain span shows the final hostname and appends ` via <original host>` when different; the `title` attribute becomes `<finalUrl> (via <href>)`; the tooltip shows both URLs. `href` is never modified.

## Manifest and build
Version 0.10.0. `host_permissions`: `https://www.youtube.com/*`, `https://publish.x.com/*`, `https://open.spotify.com/*`, `https://www.reddit.com/*`, `https://vimeo.com/*`, backend origin. `background: { service_worker, scripts }` pointing at the same IIFE file (`vite.background.config.ts`), no `type: module`, so Chrome and Firefox share one build. Firefox-specific keys (`browser_specific_settings.gecko` with `strict_min_version 128.0` and `data_collection_permissions: { required: ["websiteContent"] }`) and the onboarding page come with the second M1 PR.

## Options and popup
Options: a "Privacy mode" section with three radio cards (one sentence each stating what leaves the browser and to whom) plus a Custom state exposing the two selects. Popup: shows the current mode name.

## Tests
Per-resolver tables and fixtures; `cache.test.ts`; `sensitive.test.ts` additions; `router.test.ts` covering the mode × trigger × tier matrix, sensitive page hosts, high entropy, backoff, concurrency, cache hits; `privacy-contract.test.ts` rewired to compose the real optimizer with the real router and a recording `fetchFn`, so each row asserts which hosts are contacted and how many times. Playwright: `PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1`, `context.route` for service-worker traffic; basic spec proves a YouTube link resolves via the mocked oEmbed route with zero backend calls, and a generic link stays raw until hover, then makes exactly one.

## Backend side (branch `m1/backend`)
`Result` gains `finalUrl` (set by the unshortener to the destination it landed on). After the extension PR merges: remove the YouTube, GitHub and Wikipedia resolvers (Tier 0/A cover them), keep OpenGraph + unshortener, publish the image to GHCR on tag, add `docs/SELF_HOSTING.md`.
