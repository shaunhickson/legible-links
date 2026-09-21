# Legible Links — guidance for agents and contributors

Legible Links is a browser extension (Chrome MV3, Firefox) plus a small Go backend. It rewrites links whose visible text is a raw URL into `[icon] Title · domain`, so people can see where a link goes before clicking. Priorities, in order: **privacy, security, ease-of-use**. No profit motive.

Read `docs/PLAN_2026-09.md` (the design record) and `docs/ROADMAP.md` (progress) before starting work. Nothing in git history before September 2026 (the "LinkLens" era, `DESIGN_*.md` docs, Terraform, Firestore) is a source of truth.

## Hard rules
- **Never** assign `innerHTML`/`outerHTML` or call `insertAdjacentHTML` in the extension. Build DOM with `createElement`/`textContent` (`extension/src/utils/render.ts`). ESLint enforces this.
- Every title that reaches the DOM goes through `sanitizeTitle()`; the destination hostname is always rendered next to it; `href` is never modified.
- Nothing leaves the browser unless `classifyUrl()` in `extension/src/utils/sensitive.ts` says `ok`, the anchor is not in an editable context, and the visible-text domain matches the href.
- Backend logs never contain URLs, query strings, client IPs, or user agents. Errors are scrubbed before logging (`resolvers/manager.go`).
- Backend keeps no durable state and needs no API keys. Outbound fetches go through `transport.NewSafeTransport()` (private/reserved IPs blocked, ports 80/443 only).
- Fail open: if resolution fails, the raw link stays raw.
- Security-sensitive code is written tests-first (XSS payloads, bidi overrides, SSRF table, spoofed `X-Forwarded-For`).
- `extension/src/privacy-contract.test.ts` is the specification of what may leave the browser and what may change on a page. A new guard, resolver, or mode adds rows there first; the README and privacy policy may only claim what it proves.

## Process
- One branch and one PR per change, with the reasoning in the PR description. Design documents only for architectural changes (this plan is one).
- Merging to `main` deploys the backend to Cloud Run automatically (`.github/workflows/ci.yml`). The owner approves at milestone boundaries before the next milestone starts.
- Conventional commit prefixes (`feat:`, `fix:`, `chore:`, `docs:`, `test:`). Never commit `.env`, logs, zips, or build output.

## Layout and commands
- `extension/` — Vite + React + TypeScript. `npm run lint`, `npx vitest run`, `npm run build`, `npm run test:e2e` (Playwright, needs a build; fixtures are served over HTTP by `tests/e2e/server.mjs`).
- `backend/` — Go 1.24+, module `github.com/shaunhickson/legible-links/backend`. `gofmt -l .`, `go vet ./...`, `golangci-lint run ./...`, `go test -race -cover ./...`. Run locally with `go run .` (port 8080).
- `website/` — Next.js marketing site with the privacy policy and terms; static export to GitHub Pages (M2).
- `Makefile` wraps the common targets.

## Live infrastructure (owner's GCP project `youtube-url-replacer`)
- Cloud Run service `youtube-replacer-backend`, region `us-east1`, public and unauthenticated, protected by rate limiting. Env: `TRUSTED_PROXY_HOPS=1` (Cloud Run appends the real client IP as the rightmost `X-Forwarded-For` entry).
- CI authenticates via Workload Identity Federation bound to the GitHub repository id (rename-proof).
- Default extension backend URL is the Cloud Run URL until `api.legiblelinks.app` exists (M2).
