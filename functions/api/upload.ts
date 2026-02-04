export const onRequest: PagesFunction<{
  WEDDING_PHOTOS: R2Bucket
  UPLOAD_PASSWORD?: string
}> = async ({ request, env }) => {
  if (!env.UPLOAD_PASSWORD) {
    return new Response("Server not configured", { status: 500 })
  }

  const provided = request.headers.get("x-upload-password") || ""
  if (provided !== env.UPLOAD_PASSWORD) {
    return new Response("Unauthorized", { status: 401 })
  }

  if (request.method === "GET") {
    return new Response("OK", { status: 200 })
  }

  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 })
  }

  const contentType = request.headers.get("content-type") || ""
  if (!contentType.startsWith("image/")) {
    return new Response("Only images allowed", { status: 400 })
  }

  const id = crypto.randomUUID()
  const date = new Date().toISOString().slice(0, 10)
  const uploader = request.headers.get("x-uploader-name") || "guest"
  const original = request.headers.get("x-original-name") || "photo"
  const safeUploader = uploader.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
  const safeOriginal = original.replace(/[^a-zA-Z0-9._-]+/g, "-")
  const key = `uploads/${date}/${safeUploader}-${id}-${safeOriginal}`

  await env.WEDDING_PHOTOS.put(key, request.body, {
    httpMetadata: { contentType }
  })

  return new Response(
    JSON.stringify({ ok: true }),
    {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    }
  )
}