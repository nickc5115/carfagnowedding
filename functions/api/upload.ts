const MAX_UPLOAD_BYTES = 25 * 1024 * 1024 // 25MB hard cap

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

export const onRequest: PagesFunction<{
  WEDDING_PHOTOS: R2Bucket
  UPLOAD_PASSWORD?: string
}> = async ({ request, env }) => {
  if (!env.UPLOAD_PASSWORD) {
    return new Response("Server not configured", { status: 500 })
  }

  const provided = request.headers.get("x-upload-password") || ""
  if (!timingSafeEqual(provided, env.UPLOAD_PASSWORD)) {
    return new Response("Unauthorized", { status: 401 })
  }

  if (request.method === "GET") {
    return new Response("OK", { status: 200 })
  }

  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 })
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

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" }
  })
}
