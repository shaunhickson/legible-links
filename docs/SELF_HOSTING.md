# Self-hosting the backend

The Legible Links backend is a small Go service that turns a URL into a title on behalf of the extension. The shared instance is fine for most people; run your own if you would rather no third party, the project's own server included, ever sees which links you hover.

## What it does

`POST /resolve` takes a list of URLs and returns, for each one it could resolve, a title plus a description, a platform label and (for shortened links) the destination URL. Two resolvers do the work:

- **unshortener**: follows redirect chains (up to 5 hops, `HEAD` requests, http/https only) for known shortener hosts such as `bit.ly` and `t.co`, then resolves the destination like any other page and reports it as `finalUrl`.
- **opengraph**: fetches any other page and extracts `og:title` (falling back to `<title>`) and `og:description` from the first 512 KB of its `<head>`.

YouTube, GitHub, Wikipedia, Reddit, Spotify, X and Vimeo links never reach the backend: the extension resolves those itself, from the URL or from each platform's public oEmbed endpoint.

## What it does not do

- **Keep state.** Everything lives in memory: one LRU cache of at most 10,000 entries holding results for 24 hours and failed resolutions for `NEGATIVE_CACHE_TTL`. Restarting the container empties it. There is no database, no disk, nothing to back up.
- **Need keys.** Nothing to obtain, rotate or leak.
- **Log URLs, IPs or user agents.** The request log records the method, path, status and latency of each request and nothing else. Resolver errors are scrubbed of URLs before they are logged; at most a hostname appears, and only with `DEBUG=true`.
- **Fetch into private space.** Outbound requests go through an SSRF-hardened transport: hostnames resolving to loopback, link-local (including the cloud metadata address), private or otherwise non-public ranges are refused, on every hop of a redirect chain, and only ports 80 and 443 are dialled. Every fetch identifies itself with the User-Agent `LegibleLinks/0.9 (+https://github.com/shaunhickson/legible-links)` so site operators can recognise and block it.
- **Do unbounded work.** Per-client and global rate limits (`429` with `Retry-After`), caps on URLs per request and on body size, a per-request and a process-wide (64) cap on concurrent fetches, a 2-second budget per request, and a 512 KB cap on how much of any page is read.

## Run it with Docker

```bash
cd backend
docker build -t legible-links-backend .
docker run --rm -p 8080:8080 legible-links-backend
curl http://localhost:8080/health   # OK
```

The image is a distroless static binary running as a non-root user. It listens on `$PORT` (8080). All configuration is optional environment variables:

```bash
docker run --rm -p 8080:8080 -e RATE_LIMIT_RPM=120 -e NEGATIVE_CACHE_TTL=30m legible-links-backend
```

Without Docker: `cd backend && go run .` (Go 1.24+).

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | TCP port to listen on. Cloud Run sets this for you. |
| `RATE_LIMIT_RPM` | `60` | Sustained requests per minute allowed per client IP. |
| `RATE_LIMIT_BURST` | `20` | Burst allowance per client IP. |
| `GLOBAL_RATE_LIMIT_RPS` | `50` | Sustained requests per second across all clients. |
| `GLOBAL_RATE_LIMIT_BURST` | `100` | Burst allowance across all clients. |
| `MAX_CONCURRENT_RESOLVES` | `16` | Parallel fetches per request. A fixed process-wide cap of 64 applies on top. |
| `TRUSTED_PROXY_HOPS` | `0` | Reverse proxies in front of the service that append to `X-Forwarded-For`. See below. |
| `RESOLVER_TIMEOUT_MS` | `2000` | Time budget for one `/resolve` call; URLs still unresolved when it runs out are omitted from the response. |
| `MAX_ITEMS_PER_REQUEST` | `50` | URLs accepted per request; more is a `413`. |
| `MAX_BODY_BYTES` | `10240` | Request body limit in bytes; more is a `413`. |
| `ENABLED_RESOLVERS` | all | Comma-separated subset of `unshortener,opengraph`. |
| `NEGATIVE_CACHE_TTL` | `10m` | How long a failed resolution is remembered, as a Go duration (`30s`, `10m`, `1h`). `0` disables negative caching. |
| `DEBUG` | unset | `true` enables debug-level logs (resolver failures, with the destination hostname). |

### `TRUSTED_PROXY_HOPS` behind a reverse proxy or Cloud Run

Rate limiting is keyed by client IP. With the default `0`, the TCP peer address is used and `X-Forwarded-For` is ignored, so nothing a client sends can change which bucket it lands in. But if a reverse proxy sits in front of the service, the "peer" is the proxy and every user shares one bucket.

Set `TRUSTED_PROXY_HOPS` to the number of proxies you control that append the connecting address to `X-Forwarded-For`. The service then reads the N-th entry from the right of that header and ignores everything to its left, which the client may have forged. Cloud Run appends exactly one entry, so use `1` there; the same goes for a single nginx, Caddy or Traefik in front. Never set it higher than the number of proxies you actually run: an over-count lets clients choose their own rate-limit key.

## Endpoints

### `GET /health`

Returns `200` with the body `OK`. Use it for container and load-balancer health checks.

### `POST /resolve`

Request: JSON with `Content-Type: application/json`.

```json
{"urls": ["https://bit.ly/3abc", "https://example.org/post"]}
```

Response: `200` with

```json
{
  "titles": {
    "https://bit.ly/3abc": "The Example Post",
    "https://example.org/post": "An example post"
  },
  "details": {
    "https://bit.ly/3abc": {
      "title": "The Example Post",
      "description": "Where the short link actually goes",
      "platform": "Generic",
      "finalUrl": "https://example.org/the-post"
    },
    "https://example.org/post": {
      "title": "An example post",
      "description": "A description",
      "platform": "Generic"
    }
  }
}
```

- `titles` maps each resolved input URL, verbatim, to its title. URLs that could not be resolved (unreachable, not HTML, no title, blocked by the SSRF rules, timed out, or malformed) are simply absent, and the extension leaves those links as they are.
- `details` has the same keys, each with `title`, an optional `description`, `platform` (`Generic` for everything this service resolves) and an optional `finalUrl`, present only when the destination differs from the requested URL, i.e. for a shortened link.
- Titles are at most 300 characters and descriptions 500, with control, bidi-override and zero-width characters removed and whitespace collapsed. The extension sanitizes again before rendering.
- Duplicate and invalid entries are dropped. More than `MAX_ITEMS_PER_REQUEST` URLs or a body over `MAX_BODY_BYTES` is a `413`; malformed JSON is a `400`; methods other than `POST` and `OPTIONS` are `405`. `OPTIONS` returns `204` with permissive CORS headers, because the extension's content script has no stable origin.
- Every response carries `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`, and is gzip-compressed when the client accepts it.
- Rate-limited requests get `429 Too Many Requests` with a `Retry-After` header.

```bash
curl -s -X POST http://localhost:8080/resolve \
  -H 'Content-Type: application/json' \
  -d '{"urls":["https://example.org/"]}'
```

## Point the extension at it

Open the extension's Options page and set **API URL** to your instance's `/resolve` endpoint, for example `https://links.example.net/resolve`. The URL must be `https://`; plain `http://` is accepted only for `localhost`, `127.0.0.1` and `[::1]`, so `http://localhost:8080/resolve` works with a local build. URLs carrying credentials are rejected, and the last valid URL stays in use until a valid one replaces it.

Put TLS in front of the container yourself (Caddy, nginx, a cloud load balancer, or Cloud Run's own HTTPS); the service itself speaks plain HTTP.

## Run it on Cloud Run

You need the `gcloud` CLI, a project with billing enabled, and the Cloud Run and Cloud Build APIs turned on (`gcloud services enable run.googleapis.com cloudbuild.googleapis.com`). From the repository root:

```bash
# 1. Build from source and deploy. --max-instances=3 bounds the bill if the
#    service is discovered and hammered; TRUSTED_PROXY_HOPS=1 because Cloud Run
#    appends the real client IP to X-Forwarded-For.
gcloud run deploy legible-links-backend \
  --source ./backend \
  --region us-east1 \
  --allow-unauthenticated \
  --max-instances=3 \
  --set-env-vars TRUSTED_PROXY_HOPS=1

# 2. See what it is doing (add --limit=N to see more).
gcloud run services logs read legible-links-backend --region us-east1

# 3. Remove it again.
gcloud run services delete legible-links-backend --region us-east1
```

The deploy command prints the service URL (`https://legible-links-backend-….run.app`); append `/resolve` and paste that into the extension's API URL. To change a setting later: `gcloud run services update legible-links-backend --region us-east1 --update-env-vars NEGATIVE_CACHE_TTL=30m`. Note that Cloud Run's own request logs, unlike the service's, do record client IPs; add a logs exclusion filter for the service if that matters to you.
