const uploadBtn = document.getElementById("uploadBtn");
const fileInput = document.getElementById("photos");
const statusEl = document.getElementById("status");
const tbody = document.getElementById("uploadTbody");

// Tune these:
const MAX_CONCURRENCY = 3; // 2–4 is good for phones
const MAX_MB = 15;         // optional client-side guardrail

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
  nameTd.style.wordBreak = "break-word";
  nameTd.innerHTML = `<div style="font-weight:600;">${file.name}</div>
                      <div style="color:#666; font-size:12px;">${formatBytes(file.size)}</div>`;

  const progTd = document.createElement("td");
  progTd.style.padding = "10px 10px 10px 0";
  progTd.innerHTML = `
    <div style="background:#eee; border-radius:999px; height:10px; overflow:hidden;">
      <div class="bar" style="height:10px; width:0%; background:#111;"></div>
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
  return { tr, bar, statusTd };
}

function uploadFileXHR(file, { bar, statusTd }) {
  return new Promise((resolve, reject) => {
    statusTd.textContent = "Uploading…";

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload", true);

    // Required so your Worker sees content-type
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");

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

  // Reset table
  tbody.innerHTML = "";

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
  } else {
    setStatus(`Ready to upload ${valid.length} photo(s).`);
  }

  uploadBtn.disabled = true;

  // Create rows + tasks
  const tasks = valid.map((file) => {
    const row = createRow(file);
    tbody.appendChild(row.tr);
    return () => uploadFileXHR(file, row);
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