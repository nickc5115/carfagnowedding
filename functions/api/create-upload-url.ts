/*
export const onRequest: PagesFunction<{
  WEDDING_PHOTOS: R2Bucket
}> = async ({ request, env }) => {

  // Handle CORS / preflight
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      }
    })
  }

  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 })
  }

  const id = crypto.randomUUID()
  const date = new Date().toISOString().slice(0, 10)
  const key = `uploads/${date}/${id}.jpg`

  const uploadUrl = await env.WEDDING_PHOTOS.createPresignedUrl({
    method: "PUT",
    key,
    expiresIn: 300
  })

  return new Response(JSON.stringify({ uploadUrl }), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  })
}
*/
export const onRequest: PagesFunction<{
  WEDDING_PHOTOS: R2Bucket
}> = async ({ env }) => {
  try {
    const list = await env.WEDDING_PHOTOS.list({ limit: 1 })

    return new Response(
      JSON.stringify({
        ok: true,
        objects: list.objects.length
      }),
      { headers: { "Content-Type": "application/json" } }
    )
  } catch (err) {
    return new Response(
      "R2 ERROR: " + (err instanceof Error ? err.message : String(err)),
      { status: 500 }
    )
  }
}
