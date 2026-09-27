# Roadmap

The full assessment, design, and verification plan is in [`PLAN_2026-09.md`](PLAN_2026-09.md). This page tracks progress only.

## M0 — Stop the bleeding (done 2026-09-21, PR #106)
Safe to sideload and share with friends.
- [x] Purge superseded design docs, Terraform, agent files, stale artifacts; fix `.gitignore`
- [x] Rename to Legible Links (extension, backend module, site, repo)
- [x] Firestore removed: live env var dropped, `video_titles` collection deleted, code deleted
- [x] Extension: XSS fix (no `innerHTML`), title sanitizer, domain always shown, sensitive-URL filter, editable-context and text/href-mismatch guards, batch chunking, dedupe fix, permissions trimmed, `apiUrl` validation, tests, ESLint guard
- [x] Backend: no URLs or IPs in logs, rate limiter keyed on the trusted proxy hop, SSRF blocklist and port allowlist, server timeouts, bounded cache, HTML tokenizer, keyless YouTube, secret-dependent resolvers removed, tests
- [x] Merged, deployed; `YOUTUBE_API_KEY` removed from the live service and Secret Manager, API key revoked

## M1 — Privacy architecture (in progress)
The default install never contacts the server without a hover.
- Service worker owns all network; content script only messages it
- Tier 0 (URL-derived titles, no network), Tier A (platform oEmbed, cookies omitted), Tier B (backend, on hover by default)
- Sensitive-URL filter completed (tracking params, high-entropy segments, sensitive page hosts)
- Session cache, onboarding page with Private / Balanced / Everything, Firefox manifest keys
- Backend slimmed to OpenGraph + unshortener, LRU cache, GHCR image for self-hosting

## M2 — Ship
Listed on Chrome Web Store and Firefox Add-ons.
- Register `legiblelinks.app`; site on GitHub Pages; `api.legiblelinks.app` in front of Cloud Run
- Privacy policy rewritten to match behaviour; store assets; tag-triggered release build
- Cloud Run capped at 3 instances, request-log exclusion, budget alert

## M3 — After launch
Feedback channel, self-hosting guide, then only what users ask for.

## Dropped
Enterprise/monetisation pillar, viewport pre-fetching, IndexedDB cache, Safari, LinkedIn/Twitter/Spotify API resolvers, Firestore, Redis, Terraform, per-resolver toggles, the two-PR design ritual. Reasons in the plan, section 4.
