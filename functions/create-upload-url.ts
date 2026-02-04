export const onRequestPost: PagesFunction<{
  WEDDING_PHOTOS: R2Bucket
}> = async () => {

  // Unique name per upload
  const id = crypto.randomUUID()
  const date = new Date().toISOString().slice(0, 10)

  const key = `uploads/${date}/${id}.jpg`

  const uploadUrl = await WEDDING_PHOTOS.createPresignedUrl({
    method: "PUT",
    key,
    expiresIn: 300, // 5 minutes
    httpMetadata: {
      contentType: "image/jpeg"
    }
  })

  return new Response(
    JSON.stringify({ uploadUrl }),
    { headers: { "Content-Type": "application/json" } }
  )
}
