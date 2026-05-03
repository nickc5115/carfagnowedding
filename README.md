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
| `Content-Type` | no | Detected server-side via magic bytes; this header is ignored for type validation |

Body: raw image bytes. Server validates the file is a real image
(JPEG/PNG/GIF/WebP/HEIC/HEIF) and rejects payloads larger than 25MB.

R2 key format: `uploads/<YYYY-MM-DD>/<uploader>-<uuid>-<original>`.
