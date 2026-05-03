const MAX_UPLOAD_BYTES = 25 * 1024 * 1024 // 25MB hard cap
const RATE_LIMIT_PER_HOUR = 100

const IMAGE_SIGNATURES: Array<{ type: string; bytes: number[]; offset?: number }> = [
  { type: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { type: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { type: "image/gif", bytes: [0x47, 0x49, 0x46, 0x38] },
  { type: "image/webp", bytes: [0x52, 0x49, 0x46, 0x46] },
  { type: "image/heic", bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 },
  { type: "image/heif", bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 }
]

function detectImageType(head: Uint8Array): string | null {
  for (const sig of IMAGE_SIGNATURES) {
    const offset = sig.offset ?? 0
    if (head.length < offset + sig.bytes.length) continue
    let match = true
    for (let i = 0; i < sig.bytes.length; i++) {
      if (head[offset + i] !== sig.bytes[i]) {
        match = false
        break
      }
    }
    if (match) return sig.type
  }
  return null
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}

async function verifyTurnstile(
  secret: string,
  token: string,
  remoteip: string | null
): Promise<boolean> {
  if (!token) return false
  const form = new FormData()
  form.append("secret", secret)
  form.append("response", token)
  if (remoteip) form.append("remoteip", remoteip)
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form
    })
    if (!res.ok) return false
    const data = (await res.json()) as { success?: boolean }
    return data.success === true
  } catch {
    return false
  }
}

async function checkRateLimit(
  kv: KVNamespace,
  ip: string
): Promise<{ allowed: boolean; count: number }> {
  const bucket = Math.floor(Date.now() / (60 * 60 * 1000)) // hour bucket
  const key = `rl:${ip}:${bucket}`
  const current = Number((await kv.get(key)) || "0")
  if (current >= RATE_LIMIT_PER_HOUR) {
    return { allowed: false, count: current }
  }
  // Best-effort increment. KV is eventually consistent; for this scale
  // (a wedding) a small overcount is fine.
  await kv.put(key, String(current + 1), { expirationTtl: 60 * 60 })
  return { allowed: true, count: current + 1 }
}

type Env = {
  WEDDING_PHOTOS: R2Bucket
  UPLOAD_PASSWORD?: string
  TURNSTILE_SECRET_KEY?: string
  RATE_LIMIT?: KVNamespace
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.UPLOAD_PASSWORD) {
    return new Response("Server not configured", { status: 500 })
  }

  const ip = request.headers.get("cf-connecting-ip") || ""
  const provided = request.headers.get("x-upload-password") || ""

  // GET = password-verify call from the auth gate. Check Turnstile BEFORE the
  // password so a bot without a valid token cannot distinguish 401 (wrong
  // password) from 403 (no/bad token) and use this endpoint as a password
  // oracle.
  if (request.method === "GET") {
    if (env.TURNSTILE_SECRET_KEY) {
      const token = request.headers.get("x-turnstile-token") || ""
      const ok = await verifyTurnstile(env.TURNSTILE_SECRET_KEY, token, ip)
      if (!ok) return new Response("Turnstile verification failed", { status: 403 })
    }
    if (!timingSafeEqual(provided, env.UPLOAD_PASSWORD)) {
      return new Response("Unauthorized", { status: 401 })
    }
    return new Response("OK", { status: 200 })
  }

  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 })
  }

  // POST: the auth gate has already passed Turnstile. Just check the password.
  if (!timingSafeEqual(provided, env.UPLOAD_PASSWORD)) {
    return new Response("Unauthorized", { status: 401 })
  }

  if (env.RATE_LIMIT && ip) {
    const { allowed, count } = await checkRateLimit(env.RATE_LIMIT, ip)
    if (!allowed) {
      return new Response(`Rate limit exceeded (${count}/hr)`, {
        status: 429,
        headers: { "Retry-After": "3600" }
      })
    }
  }

  // Dedup: client sends a SHA-256 of the bytes it's about to upload. If we've
  // already stored a marker for that hash, return early WITHOUT reading the
  // body — Cloudflare drops the unread upload, saving R2 puts and bandwidth.
  const claimedHash = (request.headers.get("x-content-hash") || "").toLowerCase()
  const hashIsValid = /^[0-9a-f]{64}$/.test(claimedHash)
  if (hashIsValid) {
    const existing = await env.WEDDING_PHOTOS.head(`dedup/${claimedHash}`)
    if (existing) {
      return new Response(JSON.stringify({ ok: true, deduped: true }), {
        headers: { "Content-Type": "application/json" }
      })
    }
  }

  const contentLength = Number(request.headers.get("content-length") || "0")
  if (contentLength > MAX_UPLOAD_BYTES) {
    return new Response(`File too large (max ${MAX_UPLOAD_BYTES} bytes)`, { status: 413 })
  }

  if (!request.body) {
    return new Response("Empty body", { status: 400 })
  }

  const buffer = await request.arrayBuffer()
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    return new Response(`File too large (max ${MAX_UPLOAD_BYTES} bytes)`, { status: 413 })
  }
  if (buffer.byteLength === 0) {
    return new Response("Empty body", { status: 400 })
  }

  const head = new Uint8Array(buffer.slice(0, 16))
  const detectedType = detectImageType(head)
  if (!detectedType) {
    return new Response("File is not a recognized image", { status: 400 })
  }

  const id = crypto.randomUUID()
  const date = new Date().toISOString().slice(0, 10)
  const uploader = request.headers.get("x-uploader-name") || "guest"
  const original = request.headers.get("x-original-name") || "photo"
  const safeUploader = uploader.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
  const safeOriginal = original.replace(/[^a-zA-Z0-9._-]+/g, "-")
  const key = `uploads/${date}/${safeUploader}-${id}-${safeOriginal}`

  await env.WEDDING_PHOTOS.put(key, buffer, {
    httpMetadata: { contentType: detectedType }
  })

  // Verify and persist a dedup marker. We re-hash server-side so a malicious
  // client can't poison the dedup table by claiming a hash that doesn't match
  // the bytes they sent.
  if (hashIsValid) {
    const actualHashBuf = await crypto.subtle.digest("SHA-256", buffer)
    const actualHash = Array.from(new Uint8Array(actualHashBuf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
    if (actualHash === claimedHash) {
      await env.WEDDING_PHOTOS.put(`dedup/${actualHash}`, key, {
        httpMetadata: { contentType: "text/plain" }
      })
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" }
  })
}
