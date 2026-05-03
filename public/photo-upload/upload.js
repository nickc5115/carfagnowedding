const uploadBtn = document.getElementById("uploadBtn");
const fileInput = document.getElementById("photos");
const statusEl = document.getElementById("status");
const tbody = document.getElementById("uploadTbody");
const authGate = document.getElementById("authGate");
const authBtn = document.getElementById("authBtn");
const authPassword = document.getElementById("authPassword");
const authName = document.getElementById("authName");
const authHint = document.getElementById("authHint");
const greeting = document.getElementById("greeting");
const rowsByFile = new Map();

// Tune these:
const MAX_CONCURRENCY = 3; // 2–4 is good for phones
const MAX_MB = 15;         // optional client-side guardrail
const MAX_DIM = 2000;      // downscale large photos for faster uploads
const JPEG_QUALITY = 0.82; // balance size vs quality
const COMPRESS_MIN_BYTES = 1.5 * 1024 * 1024; // skip tiny files
const UPLOAD_MAX_ATTEMPTS = 3; // initial + 2 retries
const HEIC2ANY_URL = "https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js";

let heic2anyLoader = null;
function loadHeic2Any() {
  if (window.heic2any) return Promise.resolve(window.heic2any);
  if (heic2anyLoader) return heic2anyLoader;
  heic2anyLoader = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = HEIC2ANY_URL;
    s.async = true;
    s.onload = () => resolve(window.heic2any);
    s.onerror = () => {
      heic2anyLoader = null;
      reject(new Error("Failed to load HEIC converter"));
    };
    document.head.appendChild(s);
  });
  return heic2anyLoader;
}

function isHeic(file) {
  const t = (file.type || "").toLowerCase();
  if (t === "image/heic" || t === "image/heif") return true;
  return /\.(heic|heif)$/i.test(file.name || "");
}

async function heicToJpeg(file) {
  const heic2any = await loadHeic2Any();
  const out = await heic2any({ blob: file, toType: "image/jpeg", quality: JPEG_QUALITY });
  const blob = Array.isArray(out) ? out[0] : out;
  return new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" });
}

function setStatus(msg) {
  statusEl.textContent = msg;
}

function getPassword() {
  return sessionStorage.getItem("upload_password") || "";
}

function getUploaderName() {
  return sessionStorage.getItem("upload_name") || "";
}

function setUploaderName(name) {
  sessionStorage.setItem("upload_name", name);
  updateGreeting(name);
}

function showAuthGate(message) {
  if (authGate) authGate.classList.add("is-active");
  if (authHint && message) authHint.textContent = message;
  if (authName) authName.focus();
  turnstileGateVisible = true;
  if (typeof maybeRenderTurnstile === "function") maybeRenderTurnstile();
}

function hideAuthGate() {
  if (authGate) authGate.classList.remove("is-active");
  if (authHint) authHint.textContent = "";
}

function updateGreeting(name) {
  if (!greeting) return;
  if (!name) {
    greeting.textContent = "Hello";
    return;
  }
  greeting.textContent = `Hey there, ${name}!`;
}

function setPassword(pw) {
  sessionStorage.setItem("upload_password", pw);
  hideAuthGate();
}

async function verifyPassword(pw, turnstileToken) {
  try {
    const headers = { "X-Upload-Password": pw };
    if (turnstileToken) headers["X-Turnstile-Token"] = turnstileToken;
    const res = await fetch("/api/upload", { method: "GET", headers });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    console.error(err);
    return { ok: false, status: 0 };
  }
}

const turnstileEl = document.getElementById("turnstile");
const turnstileSiteKey = turnstileEl ? turnstileEl.getAttribute("data-sitekey") : "";
const turnstileEnabled = !!(turnstileEl && turnstileSiteKey && turnstileSiteKey !== "YOUR_TURNSTILE_SITE_KEY");
let turnstileWidgetId = null;

let turnstileReady = false;
let turnstileGateVisible = false;

function maybeRenderTurnstile() {
  if (!turnstileEnabled || turnstileWidgetId !== null) return;
  if (!turnstileReady || !turnstileGateVisible) return;
  if (!window.turnstile || typeof window.turnstile.render !== "function") return;
  turnstileWidgetId = window.turnstile.render(turnstileEl, {
    sitekey: turnstileSiteKey,
    theme: "light"
  });
}

function getTurnstileToken() {
  if (!turnstileEnabled || !window.turnstile || turnstileWidgetId === null) return "";
  return window.turnstile.getResponse(turnstileWidgetId) || "";
}

function resetTurnstile() {
  if (!turnstileEnabled || !window.turnstile || turnstileWidgetId === null) return;
  window.turnstile.reset(turnstileWidgetId);
}

// Turnstile api.js is loaded with ?render=explicit&onload=onloadTurnstileCallback.
// We can't render until BOTH the library is ready AND the auth gate is visible
// (Turnstile won't render into a display:none container).
window.onloadTurnstileCallback = () => {
  turnstileReady = true;
  maybeRenderTurnstile();
};

// Cover the race where api.js loaded before this script ran.
if (turnstileEnabled && window.turnstile && typeof window.turnstile.render === "function") {
  turnstileReady = true;
}

if (!turnstileEnabled && turnstileEl) {
  // Hide the empty container so it doesn't add blank space.
  turnstileEl.style.display = "none";
}

function initAuthGate() {
  if (!authGate) return;
  if (getPassword() && getUploaderName()) {
    hideAuthGate();
    updateGreeting(getUploaderName());
  } else {
    showAuthGate("Enter the shared password to upload.");
  }

  const submit = async () => {
    const name = authName ? authName.value.trim() : "";
    const pw = authPassword ? authPassword.value.trim() : "";
    if (!name || !pw) {
      if (authHint) authHint.textContent = "Name and password required.";
      return;
    }
    const token = getTurnstileToken();
    if (turnstileEnabled && !token) {
      if (authHint) authHint.textContent = "Please complete the verification challenge.";
      return;
    }
    const result = await verifyPassword(pw, token);
    if (result.ok) {
      setUploaderName(name);
      setPassword(pw);
    } else if (result.status === 403) {
      if (authHint) authHint.textContent = "Verification failed. Please try the challenge again.";
      resetTurnstile();
    } else if (authHint) {
      authHint.textContent = "Wrong password. Please try again.";
      resetTurnstile();
    }
  };

  if (authBtn) authBtn.addEventListener("click", submit);
  if (authPassword) {
    authPassword.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });
  }
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
  const baseName = file.name.replace(/\.[^.]+$/, "");
  const displayName = baseName.length > 10 ? `${baseName.slice(0, 10)}…` : baseName;
  nameTd.innerHTML = `<div style="font-weight:600; font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${displayName}</div>
                      <div class="size" style="color:#666; font-size:12px;">${formatBytes(file.size)}</div>`;

  const progTd = document.createElement("td");
  progTd.style.padding = "10px 0";
  progTd.className = "progressCell";
  progTd.innerHTML = `
    <div style="background:#eee; border-radius:999px; height:10px; overflow:hidden; border:1px solid #111; margin:0 auto;">
      <div class="bar" style="height:10px; width:0%; background:#c9a35a;"></div>
    </div>
  `;

  const statusTd = document.createElement("td");
  statusTd.style.padding = "10px 0";
  statusTd.className = "statusCell";
  setStatusCell(statusTd, "Pending");

  tr.appendChild(nameTd);
  tr.appendChild(progTd);
  tr.appendChild(statusTd);

  const bar = tr.querySelector(".bar");
  const sizeEl = nameTd.querySelector(".size");
  return { tr, bar, statusTd, sizeEl };
}

function setStatusCell(statusTd, text, emoji = "") {
  const safeEmoji = emoji ? ` <span class="status-emoji">${emoji}</span>` : "";
  statusTd.innerHTML = `<span class="status-text">${text}</span>${safeEmoji}`;
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

async function loadOrientedBitmap(file) {
  // createImageBitmap with imageOrientation:"from-image" applies EXIF rotation
  // so portrait phone photos stay upright after canvas re-encode.
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch (err) {
      // Fall through to <img> fallback (older Safari etc.)
    }
  }
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
  const source = await loadOrientedBitmap(file);
  const srcW = source.width;
  const srcH = source.height;
  const maxDim = MAX_DIM;
  let targetW = srcW;
  let targetH = srcH;

  if (srcW > maxDim || srcH > maxDim) {
    const scale = Math.min(maxDim / srcW, maxDim / srcH);
    targetW = Math.round(srcW * scale);
    targetH = Math.round(srcH * scale);
  }

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(source, 0, 0, targetW, targetH);
  if (typeof source.close === "function") source.close();

  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
  );

  if (!blob) return file;

  return new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), {
    type: "image/jpeg"
  });
}

async function prepareUploadFile(file, row) {
  let working = file;
  let originalSize = file.size;

  if (isHeic(file)) {
    setStatusCell(row.statusTd, "Converting HEIC…");
    try {
      working = await heicToJpeg(file);
    } catch (err) {
      console.warn("HEIC conversion failed, uploading original.", err);
      // Server may still accept image/heic, so fall through with original.
      return { uploadFile: file, contentType: file.type || "image/heic" };
    }
  }

  if (!shouldCompress(working)) {
    return { uploadFile: working, contentType: working.type || "application/octet-stream" };
  }

  setStatusCell(row.statusTd, "Optimizing…");

  try {
    const compressed = await compressImage(working);
    if (compressed.size < working.size) {
      row.sizeEl.textContent = `${formatBytes(compressed.size)} (optimized)`;
      return { uploadFile: compressed, contentType: compressed.type || working.type };
    }
  } catch (err) {
    console.warn("Image optimization failed, uploading original.", err);
  }

  if (working.size < originalSize) {
    row.sizeEl.textContent = `${formatBytes(working.size)} (converted)`;
  }
  return { uploadFile: working, contentType: working.type || "application/octet-stream" };
}

function isRetryableUploadError(err) {
  if (!err) return false;
  if (err.message === "Unauthorized") return false;
  if (typeof err.status === "number") {
    return err.status >= 500 || err.status === 0;
  }
  // Network / unknown — assume transient.
  return true;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function uploadWithRetry(file, row, contentType, password, uploaderName) {
  let lastErr;
  for (let attempt = 1; attempt <= UPLOAD_MAX_ATTEMPTS; attempt++) {
    try {
      return await uploadFileXHR(file, row, contentType, password, uploaderName);
    } catch (err) {
      lastErr = err;
      if (attempt === UPLOAD_MAX_ATTEMPTS || !isRetryableUploadError(err)) throw err;
      const backoffMs = 800 * Math.pow(2, attempt - 1);
      setStatusCell(row.statusTd, `Retrying (${attempt}/${UPLOAD_MAX_ATTEMPTS - 1})…`);
      row.bar.style.width = "0%";
      await sleep(backoffMs);
    }
  }
  throw lastErr;
}

function uploadFileXHR(file, { bar, statusTd }, contentType, password, uploaderName) {
  return new Promise((resolve, reject) => {
    setStatusCell(statusTd, "Uploading…");

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload", true);

    // Required so your Worker sees content-type
    xhr.setRequestHeader("Content-Type", contentType || file.type || "application/octet-stream");
    if (password) {
      xhr.setRequestHeader("X-Upload-Password", password);
    }
    if (uploaderName) {
      xhr.setRequestHeader("X-Uploader-Name", uploaderName);
      xhr.setRequestHeader("X-Original-Name", file.name);
    }

    xhr.upload.onprogress = (evt) => {
      if (!evt.lengthComputable) return;
      const pct = Math.round((evt.loaded / evt.total) * 100);
      bar.style.width = `${pct}%`;
    };

    xhr.onload = () => {
      if (xhr.status === 401 || xhr.status === 403) {
        setStatusCell(statusTd, "Wrong password", "❌");
        const err = new Error("Unauthorized");
        err.status = xhr.status;
        reject(err);
      } else if (xhr.status >= 200 && xhr.status < 300) {
        bar.style.width = "100%";
        setStatusCell(statusTd, "Done", "✅");
        resolve();
      } else {
        setStatusCell(statusTd, `Failed (${xhr.status})`, "❌");
        const err = new Error(xhr.responseText || `Upload failed (${xhr.status})`);
        err.status = xhr.status;
        reject(err);
      }
    };

    xhr.onerror = () => {
      setStatusCell(statusTd, "Network error", "❌");
      const err = new Error("Network error");
      err.status = 0;
      reject(err);
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

  const password = getPassword();
  const uploaderName = getUploaderName();
  if (!password || !uploaderName) {
    setStatus("Name and password required to upload.");
    showAuthGate("Enter your name and the shared password.");
    return;
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
      return uploadWithRetry(uploadFile, row, contentType, password, uploaderName);
    };
  });

  try {
    setStatus(`Uploading ${valid.length} photo(s)…`);
    await runWithConcurrency(tasks, MAX_CONCURRENCY);
    setStatus("🎉 All uploads complete — thank you!");
    fileInput.value = "";
  } catch (e) {
    console.error(e);
    if (String(e?.message || "").includes("Unauthorized")) {
      sessionStorage.removeItem("upload_password");
      sessionStorage.removeItem("upload_name");
      setStatus("Wrong password — please try again.");
      showAuthGate("Wrong password. Please try again.");
    } else {
      setStatus("Some uploads failed — you can tap Upload again to retry.");
    }
  } finally {
    uploadBtn.disabled = false;
  }
}); 

initAuthGate();