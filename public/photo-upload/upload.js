const uploadBtn = document.getElementById("uploadBtn");
const fileInput = document.getElementById("photos");
const statusEl = document.getElementById("status");
const tbody = document.getElementById("uploadTbody");
const rowsByFile = new Map();

// Tune these:
const MAX_CONCURRENCY = 3; // 2–4 is good for phones
const MAX_MB = 15;         // optional client-side guardrail
const MAX_DIM = 2000;      // downscale large photos for faster uploads
const JPEG_QUALITY = 0.82; // balance size vs quality
const COMPRESS_MIN_BYTES = 1.5 * 1024 * 1024; // skip tiny files

function setStatus(msg) {
  statusEl.textContent = msg;
}

function formatBytes(bytes) {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

function createRow(file) {
  const tr = document.createElement("tr");
  tr.style.borderBottom = "1px solid #f3f3f3";

  const nameTd = document.createElement("td");
  nameTd.style.padding = "10px 0";
  nameTd.style.paddingRight = "10px";
  nameTd.style.overflow = "hidden";
  nameTd.innerHTML = `<div style="font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${file.name}</div>
                      <div class="size" style="color:#666; font-size:12px;">${formatBytes(file.size)}</div>`;

  const progTd = document.createElement("td");
  progTd.style.padding = "10px 10px 10px 0";
  progTd.innerHTML = `
    <div style="background:#eee; border-radius:999px; height:10px; overflow:hidden; border:1px solid #111;">
      <div class="bar" style="height:10px; width:0%; background:#c9a35a;"></div>
    </div>
  `;

  const statusTd = document.createElement("td");
  statusTd.style.padding = "10px 0";
  statusTd.className = "statusCell";
  statusTd.textContent = "Pending";

  tr.appendChild(nameTd);
  tr.appendChild(progTd);
  tr.appendChild(statusTd);

  const bar = tr.querySelector(".bar");
  const sizeEl = nameTd.querySelector(".size");
  return { tr, bar, statusTd, sizeEl };
}

function resetTable() {
  tbody.innerHTML = "";
  rowsByFile.clear();
}

function ensureRows(files) {
  resetTable();
  files.forEach((file) => {
    const row = createRow(file);
    rowsByFile.set(file, row);
    tbody.appendChild(row.tr);
  });
}

fileInput.addEventListener("change", () => {
  const files = Array.from(fileInput.files || []);
  if (files.length === 0) {
    resetTable();
    setStatus("");
    return;
  }

  ensureRows(files);
  setStatus(`Ready to upload ${files.length} photo(s).`);
});

function shouldCompress(file) {
  return file.size >= COMPRESS_MIN_BYTES;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}

async function compressImage(file) {
  const img = await loadImage(file);
  const maxDim = MAX_DIM;
  let targetW = img.width;
  let targetH = img.height;

  if (img.width > maxDim || img.height > maxDim) {
    const scale = Math.min(maxDim / img.width, maxDim / img.height);
    targetW = Math.round(img.width * scale);
    targetH = Math.round(img.height * scale);
  }

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, targetW, targetH);

  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
  );

  if (!blob) return file;

  return new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), {
    type: "image/jpeg"
  });
}

async function prepareUploadFile(file, row) {
  if (!shouldCompress(file)) {
    return { uploadFile: file, contentType: file.type || "application/octet-stream" };
  }

  row.statusTd.textContent = "Optimizing…";

  try {
    const compressed = await compressImage(file);
    if (compressed.size < file.size) {
      row.sizeEl.textContent = `${formatBytes(compressed.size)} (optimized)`;
      return { uploadFile: compressed, contentType: compressed.type || file.type };
    }
  } catch (err) {
    console.warn("Image optimization failed, uploading original.", err);
  }

  return { uploadFile: file, contentType: file.type || "application/octet-stream" };
}

function uploadFileXHR(file, { bar, statusTd }, contentType) {
  return new Promise((resolve, reject) => {
    statusTd.textContent = "Uploading…";

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload", true);

    // Required so your Worker sees content-type
    xhr.setRequestHeader("Content-Type", contentType || file.type || "application/octet-stream");

    xhr.upload.onprogress = (evt) => {
      if (!evt.lengthComputable) return;
      const pct = Math.round((evt.loaded / evt.total) * 100);
      bar.style.width = `${pct}%`;
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        bar.style.width = "100%";
        statusTd.textContent = "Uploaded ✅";
        resolve();
      } else {
        statusTd.textContent = `Failed (${xhr.status}) ❌`;
        reject(new Error(xhr.responseText || `Upload failed (${xhr.status})`));
      }
    };

    xhr.onerror = () => {
      statusTd.textContent = "Network error ❌";
      reject(new Error("Network error"));
    };

    xhr.send(file);
  });
}

async function runWithConcurrency(tasks, limit) {
  let i = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (i < tasks.length) {
      const idx = i++;
      await tasks[idx]();
    }
  });
  await Promise.all(workers);
}

uploadBtn.addEventListener("click", async () => {
  const files = Array.from(fileInput.files || []);

  if (files.length === 0) {
    setStatus("Pick at least one photo first 🙂");
    return;
  }

  // Basic client-side filtering/guardrails
  const valid = files.filter(f => (f.type || "").startsWith("image/"));
  const tooBig = valid.filter(f => f.size > MAX_MB * 1024 * 1024);

  if (valid.length === 0) {
    setStatus("Only image files are allowed.");
    return;
  }

  if (tooBig.length > 0) {
    setStatus(`Some files are over ${MAX_MB}MB and may fail on slow connections.`);
    // We’ll still try; you can choose to block instead.
  }

  uploadBtn.disabled = true;

  // Create rows + tasks
  const tasks = valid.map((file) => {
    const row = rowsByFile.get(file) || createRow(file);
    if (!rowsByFile.has(file)) {
      rowsByFile.set(file, row);
      tbody.appendChild(row.tr);
    }
    return async () => {
      const { uploadFile, contentType } = await prepareUploadFile(file, row);
      return uploadFileXHR(uploadFile, row, contentType);
    };
  });

  try {
    setStatus(`Uploading ${valid.length} photo(s)…`);
    await runWithConcurrency(tasks, MAX_CONCURRENCY);
    setStatus("🎉 All uploads complete — thank you!");
    fileInput.value = "";
  } catch (e) {
    console.error(e);
    setStatus("Some uploads failed — you can tap Upload again to retry.");
  } finally {
    uploadBtn.disabled = false;
  }
}); 