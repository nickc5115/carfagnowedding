# carfagnowedding

A small wedding-photo uploader for guests. Cloudflare Pages serves the static
upload page; a Pages Function streams uploads into an R2 bucket.

## Stack

- **Frontend**: plain HTML/CSS/JS in `public/photo-upload/`
- **Backend**: Cloudflare Pages Function in `functions/api/upload.ts`
- **Storage**: Cloudflare R2 bucket (`wedding-photos`)
- **Deploy**: Cloudflare Pages (production branch: `development`)

## Repo layout

```
functions/api/upload.ts   # POST /api/upload — auth + magic-byte check + R2 put
public/photo-upload/      # Static upload UI (index.html, upload.js, logo.png)
wrangler.toml             # R2 binding config
```

## Local development

Prereqs: Node 18+, `npm i -g wrangler`.

1. Create `.dev.vars` in the repo root (gitignored):
   ```
   UPLOAD_PASSWORD=some-shared-password
   ```
2. Start the local Pages dev server:
   ```
   wrangler pages dev public --r2 WEDDING_PHOTOS
   ```
   The API is available at `http://localhost:8788/api/upload` and the UI at
   `http://localhost:8788/photo-upload/`.

## Deploy

Production deploys run automatically when commits land on the `development`
branch (Cloudflare Pages production branch). To deploy manually:

```
wrangler pages deploy public --project-name wedding-uploader --branch development
```

### One-time setup

```
# R2 bucket
wrangler r2 bucket create wedding-photos

# Production secret
wrangler pages secret put UPLOAD_PASSWORD --project-name wedding-uploader
```

The R2 binding (`WEDDING_PHOTOS` → `wedding-photos`) is declared in
`wrangler.toml` and must also be configured in the Cloudflare Pages project
settings under **Settings → Functions → R2 bucket bindings**.

### Abuse protection (optional but recommended)

Two layers, both gracefully no-op if not configured.

**Cloudflare Turnstile** — bot challenge on the auth gate.

1. In the Cloudflare dashboard, go to **Turnstile → Add site**, choose the
   *Managed* widget, and add your domain.
2. Copy the **site key** into `public/photo-upload/index.html` — replace
   `YOUR_TURNSTILE_SITE_KEY` on the `<div id="turnstile" data-sitekey="…">`.
3. Set the **secret key** as a Pages secret:
   ```
   wrangler pages secret put TURNSTILE_SECRET_KEY --project-name wedding-uploader
   ```

If `TURNSTILE_SECRET_KEY` is unset, the server skips the check. If the site
key in HTML is left as the placeholder, the widget is hidden client-side.

**Per-IP rate limit** — 100 uploads/IP/hour, backed by Workers KV.

1. Create a KV namespace and copy its id:
   ```
   wrangler kv namespace create RATE_LIMIT
   ```
2. Uncomment the `[[kv_namespaces]]` block in `wrangler.toml` and paste the
   id.
3. Configure the same binding (`RATE_LIMIT`) in **Pages → Settings →
   Functions → KV namespace bindings**.

If the binding is missing, the rate limiter is skipped.

## Workflow

- Cut feature branches off `development`, not `main` (`main` is unused legacy).
- Open PRs into `development`.

## API

`POST /api/upload`

| Header | Required | Notes |
|--------|----------|-------|
| `X-Upload-Password` | yes | Shared password, compared in constant time |
| `X-Uploader-Name` | no | Used in the R2 key for attribution |
| `X-Original-Name` | no | Original filename, sanitized into the R2 key |
| `X-Content-Hash` | no | SHA-256 (hex) of the body. Enables dedup short-circuit. |
| `Content-Type` | no | Detected server-side via magic bytes; this header is ignored for type validation |

Body: raw image bytes. Server validates the file is a real image
(JPEG/PNG/GIF/WebP/HEIC/HEIF) and rejects payloads larger than 25MB.

R2 key format: `uploads/<YYYY-MM-DD>/<uploader>-<uuid>-<original>`.

### Dedup

If the client sends `X-Content-Hash` (SHA-256 hex of the bytes about to be
uploaded), the server checks for a marker at `dedup/<hash>` in R2 *before*
reading the body. If the marker exists, the server responds
`200 {"ok": true, "deduped": true}` and Cloudflare drops the unread upload —
no R2 write, no bandwidth cost. After a successful first-time upload, the
server re-hashes server-side (so a malicious client can't poison the dedup
table) and writes the marker for next time.
