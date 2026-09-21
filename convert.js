"use strict";

/* IIFE for the same reason as script.js: keeps this file's internals out
   of the global `window` object rather than relying on `type="module"`
   (which has its own file:// loading restrictions we specifically want
   to avoid here -- see script.js's header comment for the full reasoning). */
(function () {

const EXPECTED_COUNT = 8;
const loaded = {}; // index (1-8) -> array of rows (each row: array of ints)

const checklist = document.getElementById("checklist");
const downloadBtn = document.getElementById("downloadBtn");
const statusMsg = document.getElementById("statusMsg");
const fileInput = document.getElementById("fileInput");
const dropZone = document.getElementById("dropZone");

function buildChecklist() {
  checklist.innerHTML = "";
  for (let i = 1; i <= EXPECTED_COUNT; i++) {
    const li = document.createElement("li");
    li.id = `slot-${i}`;
    if (loaded[i]) {
      li.className = "loaded";
      li.textContent = `\u2713 ion_peak_${i}.csv (${loaded[i].length} rows)`;
    } else {
      li.className = "pending";
      li.textContent = `\u25cb ion_peak_${i}.csv`;
    }
    checklist.appendChild(li);
  }
}
buildChecklist();

function parseCsvText(text) {
  return text
    .trim()
    .split(/\r?\n/)
    .filter(line => line.length > 0)
    .map(line => line.split(",").map(v => parseInt(v.trim(), 10)));
}

function handleFiles(fileList) {
  const files = Array.from(fileList).filter(f => /\.csv$/i.test(f.name));
  if (files.length === 0) {
    statusMsg.textContent = "No .csv files found in your selection.";
    return;
  }

  files.forEach(file => {
    const m = file.name.match(/ion_peak_(\d)\.csv$/i);
    if (!m) {
      statusMsg.textContent = `Skipping "${file.name}" -- doesn't match ion_peak_N.csv (N=1-8).`;
      return;
    }
    const index = parseInt(m[1], 10);
    if (index < 1 || index > 8) {
      statusMsg.textContent = `Skipping "${file.name}" -- index ${index} is out of range 1-8.`;
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      try {
        loaded[index] = parseCsvText(reader.result);
      } catch (err) {
        statusMsg.textContent = `Couldn't parse "${file.name}": ${err.message}`;
      }
      buildChecklist();
      updateDownloadButton();
    };
    reader.onerror = () => {
      statusMsg.textContent = `Couldn't read "${file.name}".`;
    };
    reader.readAsText(file);
  });
}

function updateDownloadButton() {
  const count = Object.keys(loaded).length;
  downloadBtn.disabled = count < EXPECTED_COUNT;
  if (count < EXPECTED_COUNT) {
    statusMsg.textContent = `${count}/${EXPECTED_COUNT} files loaded so far.`;
  } else {
    statusMsg.textContent = "All 8 files loaded -- ready to download ion_data.js.";
  }
}

fileInput.addEventListener("change", e => handleFiles(e.target.files));

dropZone.addEventListener("dragover", e => {
  e.preventDefault();
  dropZone.style.background = "#1a1a1a";
});
dropZone.addEventListener("dragleave", () => {
  dropZone.style.background = "#111";
});
dropZone.addEventListener("drop", e => {
  e.preventDefault();
  dropZone.style.background = "#111";
  handleFiles(e.dataTransfer.files);
});

downloadBtn.addEventListener("click", () => {
  const parts = ["window.ION_PEAK_DATA = {"];
  for (let i = 1; i <= EXPECTED_COUNT; i++) {
    const rowsJson = JSON.stringify(loaded[i]);
    parts.push(`  ${i}: ${rowsJson},`);
  }
  parts.push("};");
  const content = parts.join("\n") + "\n";

  const blob = new Blob([content], { type: "text/javascript" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "ion_data.js";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  statusMsg.textContent = "Downloaded ion_data.js -- move it next to index.html.";
});

})(); // end IIFE