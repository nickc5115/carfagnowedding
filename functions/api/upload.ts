export const onRequest: PagesFunction<{
  WEDDING_PHOTOS: R2Bucket
}> = async ({ request, env }) => {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 })
  }

  const contentType = request.headers.get("content-type") || ""
  if (!contentType.startsWith("image/") && !contentType.startsWith("video/")) {
    return new Response("Only images or videos allowed", { status: 400 })
  }

  const id = crypto.randomUUID()
  const date = new Date().toISOString().slice(0, 10)
  const key = `uploads/${date}/${id}`

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