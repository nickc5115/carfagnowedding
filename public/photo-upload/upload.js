const uploadBtn = document.getElementById("uploadBtn");
const fileInput = document.getElementById("photos");
const statusEl = document.getElementById("status");

function setStatus(msg) {
  statusEl.textContent = msg;
}

uploadBtn.addEventListener("click", async () => {
  const files = Array.from(fileInput.files || []);

  if (files.length === 0) {
    setStatus("Pick at least one photo first 🙂");
    return;
  }

  uploadBtn.disabled = true;
  setStatus(`Uploading 0 / ${files.length}...`);

  let uploaded = 0;

  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;

    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Upload failed (${res.status}) ${text}`);
      }

      uploaded++;
      setStatus(`Uploading ${uploaded} / ${files.length}...`);
    } catch (e) {
      console.error(e);
      setStatus("Upload failed. Please try again.");
      uploadBtn.disabled = false;
      return;
    }
  }

  setStatus("🎉 All photos uploaded — thank you!");
  uploadBtn.disabled = false;
  fileInput.value = "";
});
