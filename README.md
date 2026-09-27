# Legible Links

**See where a link goes before you click it.**

Legible Links is a browser extension that finds links whose visible text is just a raw URL, such as `https://youtu.be/dQw4w9WgXcQ` or `https://bit.ly/3abc`, and rewrites them as a readable title with the destination always shown:

> ▶ Rick Astley - Never Gonna Give You Up (Official Video) · youtube.com

The real URL is never hidden: it stays in the link's `href`, in the native tooltip, and in the rich tooltip. Links inside editors, links to private or internal hosts, and links that look like password resets, magic logins, unsubscribes, or invites are left alone and never leave your browser.

**Status: pre-release (0.11.0).** Not yet on any store; loads unpacked in Chrome and temporarily in Firefox (below). Formerly "LinkLens". The current milestone plan is in [`docs/ROADMAP.md`](docs/ROADMAP.md); the full assessment and design is [`docs/PLAN_2026-09.md`](docs/PLAN_2026-09.md).

## How resolution works

| Tier | Links | Where it happens | Default |
|---|---|---|---|
| 0 | Wikipedia, GitHub, Reddit, Stack Overflow and other URLs whose title is in the path | In the browser, no network | automatic |
| A | YouTube, Spotify, X, Reddit, Vimeo | In the browser, via each platform's public oEmbed endpoint, cookies omitted | automatic |
| B | Everything else, and shortened links | The backend service (shared instance or your own) | on hover |

All network happens in the extension's service worker; the content script only asks it for titles. Tier 0 always runs, with no network. On first install an onboarding page asks you to choose a privacy mode, which you can change at any time in the options page:

- **Private**: nothing leaves your browser until you hover a link; hovering a YouTube, Spotify, X, Reddit or Vimeo link asks that platform directly, and the Legible Links server is never contacted.
- **Balanced** (recommended): platform links are looked up automatically by asking that platform directly; any other link is sent to the Legible Links server only while you hover it.
- **Everything**: platform links are looked up by the platform, and every other public link is sent to the Legible Links server automatically, except on webmail, chat and document sites, where it waits for a hover.

Shortened links are followed by the server, which reports where they land; when the destination is a platform page the extension finishes the look-up itself, so the link reads `Title · youtube.com via bit.ly`. Which hosts each mode may contact, and how often, is pinned down row by row in `extension/src/privacy-contract.test.ts`. You can point the extension at your own server instead of the shared one: see [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md).

## Privacy and security posture

- The extension requests only `storage` plus the ability to read link text on web pages. Nothing is collected, and there is no telemetry.
- Titles are inserted as text, never as HTML, and are stripped of control and bidi-override characters and length-capped.
- The backend keeps no database and no API keys, logs neither URLs nor client IPs, and fetches only public hosts on ports 80 and 443 through an SSRF-hardened transport. It is rate limited per client and globally. Its only resolvers are a shortener-follower and a generic OpenGraph/`<title>` extractor; results are cached in memory for 24 hours and failures for 10 minutes.
- If the backend is unreachable, links simply stay as they are.

## Repository layout

- `extension/` — the browser extension (Vite, React, TypeScript). Content script in `src/content/optimizer.ts`, rendering in `src/utils/render.ts`, URL guards in `src/utils/sensitive.ts`.
- `backend/` — the Go resolution service: `POST /resolve` (JSON `{"urls": [...]}` → `{"titles": {...}, "details": {...}}`) and `GET /health`. Two resolvers, `unshortener` and `opengraph`, in `resolvers/`; the SSRF-hardened transport in `transport/`. See [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md).
- `website/` — marketing site with the privacy policy and terms (Next.js).
- `docs/` — plan and roadmap.

## Getting started

Prerequisites: Node 20+, Go 1.24+.

Backend:
```bash
cd backend
go run .            # listens on :8080; no configuration or keys needed
```

Extension:
```bash
cd extension
npm install
npm run build       # writes dist/
```
Load `extension/dist` as an unpacked extension (Chrome: chrome://extensions → Developer mode → Load unpacked). In Firefox (142 or later), open `about:debugging#/runtime/this-firefox` → Load Temporary Add-on… and pick `extension/dist/manifest.json`; the add-on lasts until Firefox restarts, until the listing on Firefox Add-ons exists. `npm run lint:ext` runs Mozilla's `web-ext lint` over the build. To use a local backend, set the API URL in the options page to `http://localhost:8080/resolve`.

Useful commands (also wrapped by the `Makefile`):
```bash
cd extension && npm run lint && npx vitest run && npm run test:e2e
cd backend && go vet ./... && golangci-lint run ./... && go test -race -cover ./...
```

Backend configuration is entirely optional environment variables: `PORT` (8080), `RATE_LIMIT_RPM` (60), `RATE_LIMIT_BURST` (20), `GLOBAL_RATE_LIMIT_RPS` (50), `GLOBAL_RATE_LIMIT_BURST` (100), `MAX_CONCURRENT_RESOLVES` (16), `TRUSTED_PROXY_HOPS` (0; set to 1 behind Cloud Run), `RESOLVER_TIMEOUT_MS` (2000), `MAX_ITEMS_PER_REQUEST` (50), `MAX_BODY_BYTES` (10240), `ENABLED_RESOLVERS` (`unshortener,opengraph`), `NEGATIVE_CACHE_TTL` (10m), `DEBUG` (unset). Each is explained in [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md).

## Self-hosting the backend

The backend resolves only what the extension cannot resolve itself: shortened links (`unshortener`) and generic pages (`opengraph`). It is stateless and keyless, so running your own is one image:

```bash
cd backend && docker build -t legible-links-backend . && docker run --rm -p 8080:8080 legible-links-backend
```
Then point the extension's API URL at `https://your-host/resolve` (`http://` only for localhost). [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md) covers every setting, the `/resolve` wire format, running behind a reverse proxy, and deploying to Cloud Run in your own project with three `gcloud` commands.

## Contributing

Read [`CLAUDE.md`](CLAUDE.md) for the hard rules (no `innerHTML`, no URL or IP logging, nothing leaves the browser without passing the sensitive-URL guard) and the process. One branch and one PR per change, with the reasoning in the description.

## License

MIT. See [`LICENSE`](LICENSE).
