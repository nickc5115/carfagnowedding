const uploadBtn = document.getElementById("uploadBtn");
const fileInput = document.getElementById("photos");
const statusEl = document.getElementById("status");
const uploadList = document.getElementById("uploadList");
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
  if (authGate) {
    authGate.classList.add("is-active");
    authGate.removeAttribute("inert");
  }
  if (authHint && message) authHint.textContent = message;
  if (authName) authName.focus();
}

function hideAuthGate() {
  if (authGate) {
    authGate.classList.remove("is-active");
    authGate.setAttribute("inert", "");
  }
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

const turnstileEl = document.getElementById("turnstileWidget");
const turnstileSiteKey = turnstileEl ? turnstileEl.getAttribute("data-sitekey") : "";
const turnstileEnabled = !!(turnstileEl && turnstileSiteKey && turnstileSiteKey !== "YOUR_TURNSTILE_SITE_KEY");
let turnstileWidgetId = null;
let turnstileScriptPromise = null;
// execute() returns nothing — token arrives via the success callback.
// Park the resolve/reject of the active execute() call here.
let turnstilePending = null;

function loadTurnstileScript() {
  if (turnstileScriptPromise) return turnstileScriptPromise;
  turnstileScriptPromise = new Promise((resolve, reject) => {
    if (window.turnstile && typeof window.turnstile.render === "function") {
      resolve();
      return;
    }
    const cbName = "__onloadTurnstileCallback";
    window[cbName] = () => resolve();
    const s = document.createElement("script");
    s.src = `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=${cbName}`;
    s.async = true;
    s.defer = true;
    s.onerror = () => reject(new Error("turnstile-script-failed"));
    document.head.appendChild(s);
  });
  return turnstileScriptPromise;
}

function renderTurnstile() {
  if (turnstileWidgetId !== null) return;
  turnstileWidgetId = window.turnstile.render(turnstileEl, {
    sitekey: turnstileSiteKey,
    theme: "light",
    appearance: "execute",
    callback: (token) => {
      if (turnstilePending) {
        turnstilePending.resolve(token || "");
        turnstilePending = null;
      }
    },
    "error-callback": () => {
      if (turnstilePending) {
        turnstilePending.reject(new Error("turnstile-error"));
        turnstilePending = null;
      }
    }
  });
}

async function executeTurnstile() {
  if (!turnstileEnabled) return "";
  await loadTurnstileScript();
  renderTurnstile();
  return new Promise((resolve, reject) => {
    if (turnstilePending) turnstilePending.reject(new Error("turnstile-superseded"));
    turnstilePending = { resolve, reject };
    try {
      window.turnstile.reset(turnstileWidgetId);
      window.turnstile.execute(turnstileWidgetId);
    } catch (err) {
      turnstilePending = null;
      reject(err);
    }
  });
}

function resetTurnstile() {
  if (!turnstileEnabled || !window.turnstile || turnstileWidgetId === null) return;
  window.turnstile.reset(turnstileWidgetId);
}

if (turnstileEl) {
  // Container is only used as a render target for an invisible widget.
  // Take it out of flow without display:none (Turnstile won't render
  // into a display:none element).
  turnstileEl.style.position = "absolute";
  turnstileEl.style.left = "-9999px";
  turnstileEl.style.width = "1px";
  turnstileEl.style.height = "1px";
  turnstileEl.style.overflow = "hidden";
  turnstileEl.style.margin = "0";
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
    let token = "";
    if (turnstileEnabled) {
      if (authHint) authHint.textContent = "Verifying…";
      try {
        token = await executeTurnstile();
      } catch (_) {
        if (authHint) authHint.textContent = "Verification failed. Please try again.";
        resetTurnstile();
        return;
      }
    }
    const result = await verifyPassword(pw, token);
    if (result.ok) {
      setUploaderName(name);
      setPassword(pw);
    } else if (result.status === 403) {
      if (authHint) authHint.textContent = "Verification failed. Please try again.";
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
  const card = document.createElement("div");
  card.className = "upload-card";

  const head = document.createElement("div");
  head.className = "upload-head";

  const nameEl = document.createElement("div");
  nameEl.className = "upload-name";
  const baseName = file.name.replace(/\.[^.]+$/, "");
  nameEl.textContent = baseName;
  nameEl.title = file.name;

  const statusBadge = document.createElement("div");
  statusBadge.className = "upload-status";

  head.appendChild(nameEl);
  head.appendChild(statusBadge);

  const meta = document.createElement("div");
  meta.className = "upload-meta";
  meta.textContent = formatBytes(file.size);

  const progress = document.createElement("div");
  progress.className = "upload-progress";
  const bar = document.createElement("div");
  bar.className = "upload-bar";
  progress.appendChild(bar);

  card.appendChild(head);
  card.appendChild(meta);
  card.appendChild(progress);

  const row = { tr: card, bar, statusTd: statusBadge, sizeEl: meta };
  setStatusCell(statusBadge, "Pending");
  return row;
}

function setStatusCell(badge, text, emoji = "") {
  const card = badge.closest(".upload-card");
  if (card) card.classList.remove("is-done", "is-error");
  if (emoji === "✅" && card) card.classList.add("is-done");
  if (emoji === "❌" && card) card.classList.add("is-error");
  badge.textContent = emoji ? `${text} ${emoji}` : text;
}

function resetTable() {
  uploadList.innerHTML = "";
  rowsByFile.clear();
}

function ensureRows(files) {
  resetTable();
  files.forEach((file) => {
    const row = createRow(file);
    rowsByFile.set(file, row);
    uploadList.appendChild(row.tr);
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

async function sha256Hex(blob) {
  if (!crypto || !crypto.subtle) return "";
  const buf = await blob.arrayBuffer();
  const hashBuf = await crypto.subtle.digest("SHA-256", buf);
  const bytes = new Uint8Array(hashBuf);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
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

async function uploadWithRetry(file, row, contentType, password, uploaderName, contentHash) {
  let lastErr;
  for (let attempt = 1; attempt <= UPLOAD_MAX_ATTEMPTS; attempt++) {
    try {
      return await uploadFileXHR(file, row, contentType, password, uploaderName, contentHash);
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

function uploadFileXHR(file, { bar, statusTd }, contentType, password, uploaderName, contentHash) {
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
    if (contentHash) {
      xhr.setRequestHeader("X-Content-Hash", contentHash);
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
        let deduped = false;
        try {
          const body = JSON.parse(xhr.responseText || "{}");
          deduped = body && body.deduped === true;
        } catch (_) { /* ignore non-JSON success bodies */ }
        setStatusCell(statusTd, deduped ? "Saved before" : "Done", "✅");
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
      uploadList.appendChild(row.tr);
    }
    return async () => {
      const { uploadFile, contentType } = await prepareUploadFile(file, row);
      let contentHash = "";
      try {
        contentHash = await sha256Hex(uploadFile);
      } catch (err) {
        // Non-fatal: dedup is an optimization, not a requirement.
        console.warn("Hashing failed, uploading without dedup hint.", err);
      }
      return uploadWithRetry(uploadFile, row, contentType, password, uploaderName, contentHash);
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

// --- Easter egg: 5-second long-press on the logo launches a hidden Galaga clone.
(function setupEasterEgg() {
  const logo = document.querySelector(".logo");
  if (!logo) return;
  const HOLD_MS = 2500;
  let holdTimer = null;
  let loading = false;
  let loaded = false;

  function loadGame() {
    if (loaded) return Promise.resolve();
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "/photo-upload/galaga.js";
      s.async = true;
      s.onload = () => { loaded = true; resolve(); };
      s.onerror = () => { loading = null; reject(new Error("galaga load failed")); };
      document.head.appendChild(s);
    });
    return loading;
  }

  function startHold(e) {
    if (e) e.preventDefault();
    if (holdTimer !== null) return;
    holdTimer = setTimeout(async () => {
      holdTimer = null;
      try {
        await loadGame();
        if (typeof window.startGalaga === "function") window.startGalaga();
      } catch (err) {
        console.warn("Could not launch galaga:", err);
      }
    }, HOLD_MS);
  }

  function cancelHold() {
    if (holdTimer !== null) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
  }

  // Use pointer events so we get unified mouse + touch + pen handling.
  logo.addEventListener("pointerdown", startHold);
  logo.addEventListener("pointerup", cancelHold);
  logo.addEventListener("pointercancel", cancelHold);
  logo.addEventListener("pointerleave", cancelHold);
  // Suppress iOS Safari's "Save Image" / "Copy" callout on long-press.
  logo.addEventListener("contextmenu", (e) => e.preventDefault());
  logo.addEventListener("dragstart", (e) => e.preventDefault());
})();
