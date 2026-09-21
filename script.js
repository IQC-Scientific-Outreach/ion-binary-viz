"use strict";

/* =======================================================================
   Everything below runs inside a single IIFE (immediately-invoked
   function expression) rather than as plain top-level script code. In a
   classic (non-module) <script>, top-level `function` declarations
   become properties of `window` -- e.g. window.startSequence() would be
   directly callable from a browser console, bypassing whatever the UI
   normally gates it behind. Wrapping everything in a function scope
   keeps all of this file's internals private to itself, the same way a
   module would, without requiring `type="module"` (which would break
   loading this file over file:// on Windows/a Raspberry Pi -- the exact
   thing this app is designed to support).
   ======================================================================= */
(function () {

/* =======================================================================
   ADMIN CONFIGURATION
   Set to false to disable Phrase Mode entirely -- useful for public/
   kiosk installations where someone typing an arbitrary phrase could
   spell out something inappropriate. When disabled, the app stays in
   Letter Mode permanently and the Mode toggle button is hidden.
   ======================================================================= */
const ENABLE_PHRASE_MODE = true;

/* =======================================================================
   GENERAL CONSTANTS  (ported 1:1 from binary_text_visualizer.py)
   ======================================================================= */
const BITS_PER_CHAR = 8;
const PAUSE_BEFORE_START_MS = 1000;   // pause after Submit before Phrase Mode playback begins
const DEFAULT_HZ = 3.0, MIN_HZ = 0.2, MAX_HZ = 5.0;

const TRIM_ROWS = 6;                  // rows dropped from top/bottom of each raw ion CSV
const IDLE_REFRESH_MS = 200;          // how often the idle "detector static" regenerates
const DEFAULT_MULT = 1.0, MIN_MULT = 0.5, MAX_MULT = 5.0;
const DEFAULT_NOISE_ENABLED = true;
const DEFAULT_TRACKING_ENABLED = false;
const TRACKING_HISTORY_SIZE = 30; // how many recent entries the Tracking panel keeps

const DEFAULT_CMAP = "inferno";
const PHRASE_CURRENT_COLOR = "#ffffff";
const PHRASE_PAST_COLOR = "#808080";

// Exact inferno colormap samples, extracted directly from matplotlib
// (32 evenly-spaced stops, linearly interpolated between -- visually
// indistinguishable from the full 256-entry version at this display size).
const INFERNO_STOPS = [
  [0,0,4],[4,3,18],[11,7,36],[21,11,55],[35,12,76],[49,10,92],[62,9,102],
  [76,12,107],[90,17,110],[103,22,110],[116,26,110],[128,31,108],[143,36,105],
  [155,41,100],[168,46,95],[180,51,89],[193,58,80],[204,66,72],[215,75,63],
  [224,85,54],[233,97,43],[239,110,33],[245,123,23],[248,137,12],[251,153,6],
  [252,168,13],[251,184,29],[249,199,47],[245,217,73],[242,232,101],
  [243,245,134],[252,255,164],
];

// Sound schemes that also swap the detector's colormap while selected
// (white at 0 up to Canadian-flag red at max) -- a simple 2-stop linear
// interpolation, equivalent to matplotlib's LinearSegmentedColormap.
const SOUND_SCHEME_CMAP_OVERRIDES = {
  "Oh Canada": { stops: [[255, 255, 255], [213, 43, 30]] },
};

/* =======================================================================
   SOUND CONFIGURATION (ported 1:1 from binary_text_visualizer.py)
   Each note is either a number (fixed Hz), a [start_hz, end_hz] pair
   (a sweep -- linear or exponential, per "sweep"), or REST (silence).
   "duration" is a MAXIMUM, shortened to fit the current cycling speed
   in Phrase Mode; unbounded in Letter Mode. See playStep() below.
   ======================================================================= */
const REST = null;

const SOUND_SCHEMES = {
  "C Major Scale": {
    notes: [261.63, 293.66, 329.63, 349.23, 392.00, 440.00, 493.88, 523.25],
    waveform: "sine",
    loop_mode: "ping_pong",
  },
  "Space Laser Sounds": {
    // A fast EXPONENTIAL downward sweep (not linear) is what actually
    // reads as a "pew" -- Web Audio's exponentialRampToValueAtTime
    // gives us this natively. amp_decay (an exponential volume decay,
    // via GainNode.setTargetAtTime) adds the percussive "snap".
    notes: [[3800, 300], [4200, 500], [3400, 250], [4000, 400], [4500, 350]],
    waveform: "sawtooth",
    sweep: "exponential",
    amp_decay: 0.05,
    loop_mode: "forward",
    duration: 0.12,
    volume: 0.3,
  },
  "ABC Song": {
    notes: [
      261.63, 261.63, 392.00, 392.00, 440.00, 440.00, 392.00,   // A B C D E F G
      349.23, 349.23, 329.63, 329.63, 293.66, 293.66, 261.63,   // H I J K L M N O P
    ],
    waveform: "sine",
    loop_mode: "forward",
    duration: 0.28,
  },
  "Smoke on the Water": {
    notes: [
      196.00, 233.08, 261.63, REST,             // dun-dun-dun (pause)
      196.00, 233.08, 277.18, 261.63, REST,      // dun-dun-dun-dun (pause)
      196.00, 233.08, 261.63, REST,              // dun-dun-dun (pause)
      233.08, 196.00, REST,                      // dun-dun (pause)
    ],
    waveform: "square",
    loop_mode: "forward",
    duration: 0.22,
  },
  "Oh Canada": {
    notes: [
      440.00, 523.25, 523.25, 349.23, REST,                                   // "O Canada!"
      392.00, 440.00, 466.16, 523.25, 523.25, 392.00, REST,                   // "Our home and native land!"
      440.00, 493.88, 493.88, 523.25,                                         // "True patriot love in all"
      587.33, 659.25, 659.25, 587.33, 587.33, 523.25, REST,                   // "...of us command."
      392.00, 440.00, 466.16, 440.00, 392.00,                                 // "With glowing hearts"
      440.00, 466.16, 523.25, 466.16, 440.00, REST,                          // "...we see thee rise,"
      466.16, 523.25, 587.33, 587.33, 466.16, 440.00, 392.00, REST,          // "The True North strong and free!"
      392.00, 440.00, 466.16, 440.00, 392.00, REST,                          // "From far and wide,"
      440.00, 466.16, 523.25, 466.16, 440.00, 440.00,                        // "O Canada,"
      392.00, 523.25, 523.25, 493.88, 440.00, 493.88, 523.25, REST,          // "we stand on guard for thee."
    ],
    waveform: "sine",
    loop_mode: "forward",
    duration: 0.28,
  },
  "Keyboard Mode": {
    // Unlike every other scheme, this has no fixed note list to walk --
    // type "keymap" tells playStep() to look up a tone from the ACTUAL
    // key just pressed instead (via KEYBOARD_KEY_MAP / KEYBOARD_EFFECTS
    // below). See playKeymap() / playDrum().
    type: "keymap",
  },
};
// Each mode has its own sensible starting scheme: Keyboard Mode makes
// Letter Mode's per-key sounds obvious right away, while C Major Scale
// is the gentlest introduction to the melodic schemes for Phrase Mode.
// See applyModeChange() -- switching modes resets the dropdown to
// whichever of these matches the mode you're switching into.
const DEFAULT_SOUND_SCHEME_LETTER = "Keyboard Mode";
const DEFAULT_SOUND_SCHEME_PHRASE = "C Major Scale";
const DEFAULT_SOUND_SCHEME = DEFAULT_SOUND_SCHEME_LETTER; // Letter Mode is the initial mode

/* =======================================================================
   KEYBOARD MODE -- maps each key to a fixed tone based on its QWERTY
   position, rather than walking a scale. Layout:

     number row (clean sine):      `1234567890-=  /  ~!@#$%^&*()_+
     qwerty row (square):          qwertyuiop[]\  /  QWERTYUIOP{}|
     home row (sawtooth):          asdfghjkl;'    /  ASDFGHJKL:"
     bottom row (driven sawtooth): zxcvbnm,./     /  ZXCVBNM<>?

   Moving LEFT-TO-RIGHT along a row raises the pitch by one semitone per
   key, starting at C4 (semitone 0) on '1', 'q', 'a', and 'z' -- backtick
   sits one semitone below '1' (it's one key to the left on a real
   keyboard). Moving UP OR DOWN between rows changes the EFFECT (the
   waveform/distortion) rather than the pitch -- each row restarts at C4.

   Whichever character on a key needs Shift to type drops a full octave
   below that key's unshifted character -- letters and symbols alike
   (e.g. 'q' is C4, 'Q' is C3; ';' and ':' share a key, so ';' is a full
   octave above ':'). Space bar is a drum hit, not a pitched tone -- see
   playDrum(). Keys with no entry here (Enter, Tab, Backspace, ...) just
   stay silent in this scheme.

   Real keyboards vary, especially outside a US QWERTY layout -- this
   table matches the specific layout above; letters will still work on
   most Latin-alphabet layouts, but some symbol positions may differ.
   ======================================================================= */
const KEYBOARD_EFFECTS = {
  clean:       { waveform: "sine" },
  qwerty_row:  { waveform: "square" },
  home_row:    { waveform: "sawtooth" },
  bottom_row:  { waveform: "sawtooth", distortion: 0.6 },
};
const KEYBOARD_BASE_FREQ = 261.63; // C4, matching every other scheme's reference pitch

function buildKeyboardKeyMap() {
  const map = {};
  function addRow(unshifted, shifted, effectName, leadingOffset) {
    leadingOffset = leadingOffset || 0;
    for (let i = 0; i < unshifted.length; i++) {
      map[unshifted[i]] = [i + leadingOffset, effectName];
    }
    for (let i = 0; i < shifted.length; i++) {
      // Every shifted character drops a full octave below its key's
      // unshifted pitch, regardless of whether it's a letter or symbol.
      map[shifted[i]] = [i + leadingOffset - 12, effectName];
    }
  }
  // Backtick sits one key to the left of '1' on a real keyboard, so it
  // gets leadingOffset=-1 (semitone -1) rather than folding into the
  // '1'..'=' run starting at 0.
  addRow("`1234567890-=", "~!@#$%^&*()_+", "clean", -1);
  addRow("qwertyuiop[]\\", "QWERTYUIOP{}|", "qwerty_row");
  addRow("asdfghjkl;'", 'ASDFGHJKL:"', "home_row");
  addRow("zxcvbnm,./", "ZXCVBNM<>?", "bottom_row");
  return map;
}
const KEYBOARD_KEY_MAP = buildKeyboardKeyMap();

/* =======================================================================
   Application state (equivalent to the Python class's self.* attributes)
   ======================================================================= */
const App = {
  mode: "letter",              // "letter" (default) or "phrase"
  currentChar: null,
  currentBits: null,
  stepCounter: 0,               // shared note-order position for both modes

  lastText: "",
  freqHz: DEFAULT_HZ,
  animating: false,
  sequence: [],
  seqIndex: 0,
  sequenceTimer: null,

  mult: DEFAULT_MULT,
  noiseEnabled: DEFAULT_NOISE_ENABLED,
  audioEnabled: true,
  trackingEnabled: DEFAULT_TRACKING_ENABLED,
  trackingHistory: null,          // filled in init() once the ion arrays' column count is known:
                                   // TRACKING_HISTORY_SIZE rows, each a 1D array of column sums,
                                   // oldest at index 0 (top) / most recent at the end (bottom)
  // NOTE: the active sound scheme and its colormap are deliberately NOT
  // cached here -- they're read live from the <select> element itself
  // (see getActiveSchemeName() / getActiveCmapSpec()) every time they're
  // needed. A cached copy here could silently drift out of sync with
  // what the dropdown actually shows (observed after a backgrounded
  // tab was resumed and the browser restored the <select>'s displayed
  // value without firing a "change" event), leaving the visible
  // selection correct while the wrong scheme kept playing.
  schemeOrders: {},              // cache: scheme name -> playback order (built lazily)

  ionArrays: null,               // 8 x rows x cols, or null if loading failed
  ionLoadError: null,
  audioCtx: null,
};

/* =======================================================================
   Ion CSV loading (ported from load_ion_arrays() in the notebook/script)

   Two ways this data can arrive, tried in this order:

   1. LOCAL/OFFLINE MODE -- if ion_data.js has already been loaded (via
      a plain <script src="ion_data.js"> tag in index.html, placed
      before script.js) it will have set window.ION_PEAK_DATA. A
      <script> tag can load a local file over file:// with no special
      permissions, unlike fetch()/XHR, which is what makes this work
      when index.html is opened directly from disk on Windows or a
      Raspberry Pi. Generate ion_data.js from your csv/ folder using
      convert.html (open it in a browser, no install needed).

   2. HOSTED MODE -- otherwise, fetch the 8 CSVs from the csv/ folder,
      which works fine once the page is served over http/https (e.g.
      GitHub Pages) but is blocked by browsers for file:// pages.

   Either way, the raw (untrimmed) rows go through the same TRIM_ROWS
   logic below, so behavior is identical regardless of source.
   ======================================================================= */
async function loadIonArrays() {
  if (typeof window.ION_PEAK_DATA !== "undefined") {
    const arrays = [];
    for (let i = 1; i <= 8; i++) {
      const rows = window.ION_PEAK_DATA[i];
      if (!rows) throw new Error(`ion_data.js is missing entry ${i} (expected keys 1-8)`);
      const trimmed = TRIM_ROWS > 0 ? rows.slice(TRIM_ROWS, rows.length - TRIM_ROWS) : rows;
      arrays.push(trimmed);
    }
    return arrays;
  }

  const arrays = [];
  for (let i = 1; i <= 8; i++) {
    const path = `csv/ion_peak_${i}.csv`;
    let resp;
    try {
      resp = await fetch(path);
    } catch (err) {
      throw new Error(`Could not fetch ${path}: ${err.message}`);
    }
    if (!resp.ok) {
      throw new Error(`${path}: HTTP ${resp.status}`);
    }
    const text = await resp.text();
    const rows = text
      .trim()
      .split(/\r?\n/)
      .map(line => line.split(",").map(v => parseInt(v.trim(), 10)));
    const trimmed = TRIM_ROWS > 0 ? rows.slice(TRIM_ROWS, rows.length - TRIM_ROWS) : rows;
    arrays.push(trimmed);
  }
  return arrays;
}

/* =======================================================================
   Ion-detector math (ported from _compute_ion_frame / plot_ion_combination)
   ======================================================================= */
function gaussianRandom(mean, sigma) {
  // Box-Muller transform -- JS has no built-in Gaussian RNG.
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return mean + z * sigma;
}

function computeIonFrame(selection, applyNoise, mult) {
  if (!App.ionArrays) return null;

  const rows = App.ionArrays[0].length;
  const cols = App.ionArrays[0][0].length;
  const base = Array.from({ length: rows }, () => new Float64Array(cols));

  for (let k = 0; k < selection.length; k++) {
    if (!selection[k]) continue;
    const arr = App.ionArrays[k];
    for (let r = 0; r < rows; r++) {
      const srcRow = arr[r], dstRow = base[r];
      for (let c = 0; c < cols; c++) {
        dstRow[c] += srcRow[c] * mult;
      }
    }
  }

  if (!applyNoise) return base;

  // Shot noise: std dev = sqrt(mean); the "+1" (as in the notebook)
  // slightly exaggerates the effect and lets true-zero pixels fluctuate
  // too, rather than always reading perfectly clean.
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const meanVal = base[r][c];
      const sigma = Math.sqrt(meanVal + 1);
      const noisy = meanVal + gaussianRandom(0, sigma);
      base[r][c] = Math.max(0, noisy); // counts can't be negative
    }
  }
  return base;
}

/* =======================================================================
   Colormap application
   ======================================================================= */
function sampleStops(stops, t) {
  t = Math.max(0, Math.min(1, t));
  const n = stops.length;
  const pos = t * (n - 1);
  const i0 = Math.floor(pos);
  const i1 = Math.min(i0 + 1, n - 1);
  const frac = pos - i0;
  const c0 = stops[i0], c1 = stops[i1];
  return [
    Math.round(c0[0] + (c1[0] - c0[0]) * frac),
    Math.round(c0[1] + (c1[1] - c0[1]) * frac),
    Math.round(c0[2] + (c1[2] - c0[2]) * frac),
  ];
}

function sampleColormap(cmapSpec, t) {
  if (cmapSpec && cmapSpec.stops) return sampleStops(cmapSpec.stops, t);
  return sampleStops(INFERNO_STOPS, t); // default: inferno
}

/* --- Single source of truth for "which scheme is active": always read
   the <select> element's live value rather than a cached copy, so the
   sound/color actually played can never silently drift out of sync
   with what the dropdown visibly shows (see the note on the App object
   above for why that matters). --- */
function getActiveSchemeName() {
  return soundSelect.value;
}
function getActiveCmapSpec() {
  return SOUND_SCHEME_CMAP_OVERRIDES[soundSelect.value] || DEFAULT_CMAP;
}

/* =======================================================================
   Drawing
   ======================================================================= */
const ionCanvas = document.getElementById("ionCanvas");
const ionCtx = ionCanvas.getContext("2d");
const placeholderMsg = document.getElementById("placeholderMsg");
const bitsRow = document.getElementById("bitsRow");
const phraseRow = document.getElementById("phraseRow");
const statusArea = document.getElementById("statusArea");
const appRoot = document.getElementById("app");
const trackingCanvas = document.getElementById("trackingCanvas");
const trackingCtx = trackingCanvas.getContext("2d");

// Pre-build the 8 evenly-spaced bit-label cells once.
for (let i = 0; i < BITS_PER_CHAR; i++) {
  const cell = document.createElement("div");
  cell.className = "bitCell";
  bitsRow.appendChild(cell);
}

function drawIonGrid(frame) {
  if (!frame) {
    ionCanvas.style.display = "none";
    placeholderMsg.style.display = "flex";
    placeholderMsg.textContent =
      "Couldn't load the ion data.\n" +
      (App.ionLoadError || "") +
      "\n\nIf this page is hosted on a server (e.g. GitHub Pages), make\n" +
      "sure the 8 CSV files are in a 'csv' folder next to this page.\n\n" +
      "If you're opening this file directly from disk (file://), that\n" +
      "won't work with plain CSVs -- use convert.html once to generate\n" +
      "ion_data.js from your csv folder, then reload this page.";
    return;
  }
  ionCanvas.style.display = "block";
  placeholderMsg.style.display = "none";

  const rows = frame.length, cols = frame[0].length;
  ionCanvas.width = cols;   // the actual pixel grid; CSS stretches it to fill the panel
  ionCanvas.height = rows;

  const imgData = ionCtx.createImageData(cols, rows);
  const vmax = 25 * App.mult; // matches the notebook's vmax=25*mult
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const t = vmax > 0 ? frame[r][c] / vmax : 0;
      const [rr, gg, bb] = sampleColormap(getActiveCmapSpec(), t);
      const idx = (r * cols + c) * 4;
      imgData.data[idx] = rr;
      imgData.data[idx + 1] = gg;
      imgData.data[idx + 2] = bb;
      imgData.data[idx + 3] = 255;
    }
  }
  ionCtx.putImageData(imgData, 0, 0);
}

function drawBitLabels(labels) {
  for (let i = 0; i < BITS_PER_CHAR; i++) {
    bitsRow.children[i].textContent = labels[i] || "";
  }
}

function render(frame, labels) {
  drawIonGrid(frame);
  drawBitLabels(labels);
}

function updatePhrase(chars) {
  phraseRow.innerHTML = "";
  if (!chars.length) return;
  const past = chars.slice(0, -1);
  const current = chars[chars.length - 1];
  if (past.length) {
    const span = document.createElement("span");
    span.className = "past";
    span.textContent = past.join("");
    phraseRow.appendChild(span);
  }
  const curSpan = document.createElement("span");
  curSpan.className = "current";
  curSpan.textContent = current;
  phraseRow.appendChild(curSpan);
}

function setStatus(text) {
  statusArea.textContent = text;
}

function toBits(code) {
  code = code & 0xff; // keep it to exactly 8 bits, even for stray non-ASCII input
  const bits = new Array(BITS_PER_CHAR);
  for (let i = 0; i < BITS_PER_CHAR; i++) {
    bits[i] = (code >> (BITS_PER_CHAR - 1 - i)) & 1;
  }
  return bits;
}

function displayChar(ch) {
  if (ch.trim().length > 0) return ch;
  const names = { " ": "' '", "\t": "'\\t'", "\n": "'\\n'", "\r": "'\\r'", "\b": "'\\x08'" };
  return names[ch] || JSON.stringify(ch);
}

function currentIdleSelection() {
  if (App.mode === "letter" && App.currentBits !== null) {
    return { bits: App.currentBits, labels: App.currentBits.map(String) };
  }
  return { bits: new Array(BITS_PER_CHAR).fill(0), labels: new Array(BITS_PER_CHAR).fill("") };
}

function refreshIonDisplay() {
  const { bits, labels } = currentIdleSelection();
  const frame = computeIonFrame(bits, App.noiseEnabled, App.mult);
  render(frame, labels);
  return frame; // returned so callers that display a REAL entered character
                // (not this function's other callers, like the idle tick)
                // can feed it to the Tracking panel -- see pushTrackingEntry().
}

function idleTick() {
  if (!(App.mode === "phrase" && App.animating)) {
    refreshIonDisplay();
  }
}

function defaultStatusText() {
  return App.mode === "letter" ? "Press any key to begin." : "Type a short string and press Submit.";
}

/* =======================================================================
   Tracking panel: a rolling history of the last TRACKING_HISTORY_SIZE
   entered characters' ion frames, each collapsed to a single row by
   summing over the vertical (row) axis, stacked into a 2nd 2D image --
   X = the same ion X position as the main image's columns, Y = one row
   per tracked entry (oldest at the top, most recent at the bottom).
   Off by default; only actually built up while the Tracking toggle is
   on -- entries typed while it's off are never recorded.
   ======================================================================= */
function makeEmptyTrackingHistory(cols) {
  return Array.from({ length: TRACKING_HISTORY_SIZE }, () => new Array(cols).fill(0));
}

function columnSums(frame) {
  // Collapse a (rows x cols) frame to a single 1D array of length cols,
  // summing every row's value at each column -- exactly the "sum over
  // the vertical axis" the history panel is built from.
  const rows = frame.length, cols = frame[0].length;
  const sums = new Array(cols).fill(0);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      sums[c] += frame[r][c];
    }
  }
  return sums;
}

function pushTrackingEntry(frame) {
  // Called only from the two places a REAL entered character is
  // displayed (a Letter Mode keystroke, or a Phrase Mode sequence
  // step) -- never from the idle tick or a reset, so only characters
  // actually "entered" while Tracking is on ever show up here.
  if (!App.trackingEnabled || !frame || !App.trackingHistory) return;
  App.trackingHistory.shift();               // drop the oldest (top) row
  App.trackingHistory.push(columnSums(frame)); // newest entry goes at the bottom
  drawTrackingGrid();
}

function drawTrackingGrid() {
  if (!App.trackingHistory) return;
  const rows = App.trackingHistory.length;
  const cols = App.trackingHistory[0].length;
  trackingCanvas.width = cols;
  trackingCanvas.height = rows;

  // Auto-scale to whatever the current maximum value in the buffer is,
  // rather than a fixed guess -- summed values can range quite a bit
  // depending on how many rows contributed to a given column, and this
  // keeps the panel legible regardless. An all-zero buffer (nothing
  // tracked yet) simply renders as flat black.
  let maxVal = 0;
  for (const row of App.trackingHistory) {
    for (const v of row) {
      if (v > maxVal) maxVal = v;
    }
  }
  const vmax = maxVal > 0 ? maxVal : 1;

  const cmapSpec = getActiveCmapSpec(); // match the main image's colormap
  const imgData = trackingCtx.createImageData(cols, rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const t = App.trackingHistory[r][c] / vmax;
      const [rr, gg, bb] = sampleColormap(cmapSpec, t);
      const idx = (r * cols + c) * 4;
      imgData.data[idx] = rr;
      imgData.data[idx + 1] = gg;
      imgData.data[idx + 2] = bb;
      imgData.data[idx + 3] = 255;
    }
  }
  trackingCtx.putImageData(imgData, 0, 0);
}

/* =======================================================================
   Audio (Web Audio API) -- equivalent to SoundEngine in the Python version
   ======================================================================= */
function ensureAudioCtx() {
  if (!App.audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    App.audioCtx = new Ctx();
  }
  if (App.audioCtx.state === "suspended") App.audioCtx.resume();
  return App.audioCtx;
}

function buildPingPongOrder(n) {
  const ascending = Array.from({ length: n }, (_, i) => i);
  const descending = [];
  for (let i = n - 2; i > 0; i--) descending.push(i);
  return ascending.concat(descending);
}

function getSchemeOrder(schemeName) {
  if (App.schemeOrders[schemeName]) return App.schemeOrders[schemeName];
  const spec = SOUND_SCHEMES[schemeName];
  const n = spec.notes.length;
  const order = spec.loop_mode === "ping_pong" ? buildPingPongOrder(n) : Array.from({ length: n }, (_, i) => i);
  App.schemeOrders[schemeName] = order;
  return order;
}

function playStep(stepIndex, intervalSeconds, char) {
  if (!App.audioEnabled) return;

  const schemeName = getActiveSchemeName();
  const spec = SOUND_SCHEMES[schemeName];

  if (spec.type === "keymap") {
    playKeymap(char, intervalSeconds);
    return;
  }

  const order = getSchemeOrder(schemeName);
  const note = spec.notes[order[stepIndex % order.length]];
  if (note === REST) return; // a deliberate pause -- play nothing this step

  const ctx = ensureAudioCtx();
  const now = ctx.currentTime;

  const maxDuration = spec.duration !== undefined ? spec.duration : 0.18;
  let duration = intervalSeconds != null ? Math.min(maxDuration, intervalSeconds) : maxDuration;
  duration = Math.max(duration, 0.02);

  let freqStart, freqEnd;
  if (Array.isArray(note)) {
    [freqStart, freqEnd] = note;
  } else {
    freqStart = freqEnd = note;
  }

  const osc = ctx.createOscillator();
  osc.type = spec.waveform || "sine";
  osc.frequency.setValueAtTime(freqStart, now);
  if (freqStart !== freqEnd) {
    if ((spec.sweep || "linear") === "exponential") {
      osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), now + duration);
    } else {
      osc.frequency.linearRampToValueAtTime(freqEnd, now + duration);
    }
  }

  const gainNode = ctx.createGain();
  const volume = spec.volume !== undefined ? spec.volume : 0.4;
  const fadeTime = Math.min(0.01, duration / 4); // ~10ms fade-in, capped for very short notes

  gainNode.gain.setValueAtTime(0, now);
  gainNode.gain.linearRampToValueAtTime(volume, now + fadeTime);

  if (spec.amp_decay) {
    // Exponential approach toward 0 with time constant amp_decay --
    // GainNode.setTargetAtTime's built-in shape is exactly
    // volume * exp(-t / amp_decay), matching the Python version's
    // hand-rolled envelope.
    gainNode.gain.setTargetAtTime(0, now + fadeTime, spec.amp_decay);
  } else {
    gainNode.gain.setValueAtTime(volume, Math.max(now + fadeTime, now + duration - fadeTime));
    gainNode.gain.linearRampToValueAtTime(0, now + duration);
  }

  osc.connect(gainNode).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + duration + 0.05); // small tail so a decaying envelope isn't cut off audibly
}

/* --- Keyboard Mode: tone-per-key and the space-bar drum hit --- */
function makeDistortionCurve(amount) {
  // A tanh soft-clip curve for WaveShaperNode -- output = tanh(x*drive)
  // / tanh(drive), the same overdrive math as the Python version's
  // hand-rolled sample-by-sample distortion.
  const drive = 1 + amount * 9;
  const n = 1024;
  const curve = new Float32Array(n);
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * drive) / norm;
  }
  return curve;
}

function playKeymap(ch, intervalSeconds) {
  if (ch === null || ch === undefined) return;
  if (ch === " ") {
    playDrum(intervalSeconds);
    return;
  }

  const entry = KEYBOARD_KEY_MAP[ch];
  if (!entry) return; // not one of the mapped keys -- no tone for this scheme
  const [semitone, effectName] = entry;
  const effect = KEYBOARD_EFFECTS[effectName];
  const freq = KEYBOARD_BASE_FREQ * Math.pow(2, semitone / 12);

  const maxDuration = 0.25;
  let duration = intervalSeconds != null ? Math.min(maxDuration, intervalSeconds) : maxDuration;
  duration = Math.max(duration, 0.02);

  const ctx = ensureAudioCtx();
  const now = ctx.currentTime;

  const osc = ctx.createOscillator();
  osc.type = effect.waveform || "sine";
  osc.frequency.setValueAtTime(freq, now);

  const gainNode = ctx.createGain();
  const volume = effect.volume !== undefined ? effect.volume : 0.4;
  const fadeTime = Math.min(0.01, duration / 4);
  gainNode.gain.setValueAtTime(0, now);
  gainNode.gain.linearRampToValueAtTime(volume, now + fadeTime);
  gainNode.gain.setValueAtTime(volume, Math.max(now + fadeTime, now + duration - fadeTime));
  gainNode.gain.linearRampToValueAtTime(0, now + duration);

  let lastNode = osc;
  if (effect.distortion) {
    // An actual overdrive on top of the chosen waveform (not just a
    // different pure shape) -- see makeDistortionCurve().
    const shaper = ctx.createWaveShaper();
    shaper.curve = makeDistortionCurve(effect.distortion);
    shaper.oversample = "2x";
    lastNode.connect(shaper);
    lastNode = shaper;
  }
  lastNode.connect(gainNode).connect(ctx.destination);

  osc.start(now);
  osc.stop(now + duration + 0.05);
}

function playDrum(intervalSeconds) {
  // A short kick-drum-like hit: white noise (the "snap") blended with a
  // fast-decaying low sine (the "thump"), each under its own quick
  // exponential decay -- mirrors the Python version's _make_drum_file.
  const maxDuration = 0.15;
  let duration = intervalSeconds != null ? Math.min(maxDuration, intervalSeconds) : maxDuration;
  duration = Math.max(duration, 0.02);

  const ctx = ensureAudioCtx();
  const now = ctx.currentTime;

  const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

  const noiseSource = ctx.createBufferSource();
  noiseSource.buffer = buffer;
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.6 * 0.5, now);
  noiseGain.gain.setTargetAtTime(0, now, 0.05); // matches Python's noise envelope, exp(-t/0.05)
  noiseSource.connect(noiseGain).connect(ctx.destination);
  noiseSource.start(now);
  noiseSource.stop(now + duration + 0.05);

  const thumpOsc = ctx.createOscillator();
  thumpOsc.type = "sine";
  thumpOsc.frequency.setValueAtTime(90, now);
  const thumpGain = ctx.createGain();
  thumpGain.gain.setValueAtTime(0.8 * 0.5, now);
  thumpGain.gain.setTargetAtTime(0, now, 0.03); // matches Python's thump envelope, exp(-t/0.03)
  thumpOsc.connect(thumpGain).connect(ctx.destination);
  thumpOsc.start(now);
  thumpOsc.stop(now + duration + 0.05);
}

/* =======================================================================
   Widget wiring
   ======================================================================= */
const entryInput = document.getElementById("entryInput");
const modeBtn = document.getElementById("modeBtn");
const soundSelect = document.getElementById("soundSelect");
const claritySlider = document.getElementById("claritySlider");
const noiseBtn = document.getElementById("noiseBtn");
const trackingBtn = document.getElementById("trackingBtn");
const muteBtn = document.getElementById("muteBtn");
const fullscreenBtn = document.getElementById("fullscreenBtn");
const modeSpecificArea = document.getElementById("modeSpecificArea");

for (const name of Object.keys(SOUND_SCHEMES)) {
  const opt = document.createElement("option");
  opt.value = name;
  opt.textContent = name;
  soundSelect.appendChild(opt);
}
soundSelect.value = DEFAULT_SOUND_SCHEME;

claritySlider.value = String(DEFAULT_MULT);

function refreshNoiseButton() {
  if (App.noiseEnabled) {
    noiseBtn.textContent = "Fluctuations: On";
    noiseBtn.style.background = "#555555";
  } else {
    noiseBtn.textContent = "Fluctuations: Off";
    noiseBtn.style.background = "#7a1f1f";
  }
}

function refreshTrackingButton() {
  if (App.trackingEnabled) {
    trackingBtn.textContent = "Tracking: On";
    trackingBtn.style.background = "#555555";
  } else {
    trackingBtn.textContent = "Tracking: Off";
    trackingBtn.style.background = "#7a1f1f";
  }
}

function refreshMuteButton() {
  if (App.audioEnabled) {
    muteBtn.innerHTML = "&#128266; Sound On";
    muteBtn.style.background = "#555555";
  } else {
    muteBtn.innerHTML = "&#128263; Muted";
    muteBtn.style.background = "#7a1f1f";
  }
}

function refreshModeButton() {
  if (App.mode === "letter") {
    modeBtn.textContent = "Mode: Letter";
    modeBtn.style.background = "#00695c";
  } else {
    modeBtn.textContent = "Mode: Phrase";
    modeBtn.style.background = "#4527a0";
  }
}

let submitBtn = null, repeatBtn = null, speedSlider = null, clearBtn = null;

function buildModeSpecificControls() {
  modeSpecificArea.innerHTML = "";
  if (App.mode === "letter") {
    clearBtn = document.createElement("button");
    clearBtn.className = "appBtn";
    clearBtn.textContent = "Clear";
    clearBtn.style.background = "#1565c0";
    clearBtn.style.maxWidth = "160px";
    clearBtn.addEventListener("click", clearDisplay);
    modeSpecificArea.appendChild(clearBtn);
  } else {
    submitBtn = document.createElement("button");
    submitBtn.className = "appBtn";
    submitBtn.textContent = "Submit";
    submitBtn.style.background = "#2e7d32";
    submitBtn.addEventListener("click", submitText);
    modeSpecificArea.appendChild(submitBtn);

    repeatBtn = document.createElement("button");
    repeatBtn.className = "appBtn";
    repeatBtn.textContent = "Repeat";
    repeatBtn.style.background = "#1565c0";
    repeatBtn.disabled = !App.lastText;
    repeatBtn.addEventListener("click", repeatText);
    modeSpecificArea.appendChild(repeatBtn);

    const speedGroup = document.createElement("div");
    speedGroup.className = "controlGroup";
    const label = document.createElement("label");
    label.textContent = "Speed (Hz)";
    speedSlider = document.createElement("input");
    speedSlider.type = "range";
    speedSlider.min = String(MIN_HZ);
    speedSlider.max = String(MAX_HZ);
    speedSlider.step = "0.1";
    speedSlider.value = String(App.freqHz); // preserve speed across mode toggles
    speedSlider.addEventListener("input", () => { App.freqHz = parseFloat(speedSlider.value); });
    speedGroup.appendChild(label);
    speedGroup.appendChild(speedSlider);
    modeSpecificArea.appendChild(speedGroup);
  }
}

/* --- Mode switching --- */
function toggleMode() {
  if (!ENABLE_PHRASE_MODE) return; // Phrase Mode is disabled -- stay in Letter Mode
  App.mode = App.mode === "letter" ? "phrase" : "letter";
  applyModeChange();
}

function applyModeChange() {
  if (App.sequenceTimer !== null) {
    clearTimeout(App.sequenceTimer);
    App.sequenceTimer = null;
  }
  App.animating = false;
  App.sequence = [];
  App.seqIndex = 0;
  App.currentChar = null;
  App.currentBits = null;
  entryInput.value = "";

  // Each mode has its own default starting scheme (see where these
  // constants are defined). This also resets the step counter and
  // redraws the display via onSoundSchemeChanged() -- App.animating is
  // already false by this point, so no separate refreshIonDisplay()
  // call is needed here too.
  soundSelect.value = App.mode === "letter" ? DEFAULT_SOUND_SCHEME_LETTER : DEFAULT_SOUND_SCHEME_PHRASE;
  onSoundSchemeChanged();

  updatePhrase([]);
  setStatus(defaultStatusText());

  buildModeSpecificControls();
  refreshModeButton();
  entryInput.focus();
}

/* --- Letter Mode --- */
const EXCLUDED_KEYS = new Set(["Escape", "F11"]);
const SPECIAL_KEY_CHARS = { Backspace: "\b", Enter: "\r", Tab: "\t" };

function onKeyDown(e) {
  if (App.mode !== "letter") return;
  if (EXCLUDED_KEYS.has(e.key)) return;
  // Ctrl/Cmd/Alt + a key is almost always a shortcut (copy, paste,
  // select-all, browser/OS shortcuts, ...), not someone entering a
  // character -- let the browser handle those normally rather than
  // treating e.g. Ctrl+C as a plain "c" and swallowing the actual
  // shortcut with the preventDefault() below. Shift is deliberately
  // NOT included here: Shift+q (etc.) producing "Q" is exactly how
  // uppercase/octave-drop input is meant to work.
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  let ch = null;
  if (e.key.length === 1) {
    ch = e.key; // ordinary printable character, including space
  } else if (Object.prototype.hasOwnProperty.call(SPECIAL_KEY_CHARS, e.key)) {
    ch = SPECIAL_KEY_CHARS[e.key];
  }
  if (ch === null) return; // a modifier/navigation/function key -- nothing to visualize

  // Prevent Tab from shifting focus, Backspace from navigating back, etc.
  e.preventDefault();

  const code = ch.charCodeAt(0) & 0xff;
  const bits = toBits(code);
  App.currentChar = ch;
  App.currentBits = bits;

  const frame = refreshIonDisplay();
  pushTrackingEntry(frame); // a real entered character -- record it if Tracking is on
  updatePhrase([ch]);
  setStatus(`'${displayChar(ch)}'  \u2192  ASCII ${code}  \u2192  ${bits.join("")}`);

  playStep(App.stepCounter, null, ch); // no interval cap -- typing speed varies
  App.stepCounter++;

  entryInput.value = ""; // clear right back out, so it never builds up text
}

function clearDisplay() {
  App.currentChar = null;
  App.currentBits = null;
  setStatus(defaultStatusText());
  refreshIonDisplay();
  updatePhrase([]);

  // Also reset the Tracking history back to a blank buffer, regardless
  // of whether Tracking is currently on or off -- Clear means clear.
  if (App.trackingHistory) {
    const cols = App.trackingHistory[0].length;
    App.trackingHistory = makeEmptyTrackingHistory(cols);
    if (App.trackingEnabled) drawTrackingGrid();
  }
}

/* --- Phrase Mode --- */
function submitText() {
  if (!ENABLE_PHRASE_MODE || App.mode !== "phrase") return;
  const text = entryInput.value;
  if (!text) {
    setStatus("Please enter some text first.");
    return;
  }
  entryInput.value = "";
  App.lastText = text;
  startSequence(text);
}

function repeatText() {
  if (!ENABLE_PHRASE_MODE) return;
  if (App.mode === "phrase" && App.lastText && !App.animating) startSequence(App.lastText);
}

function startSequence(text) {
  // Defense in depth: submitText()/repeatText()/toggleMode() already
  // check ENABLE_PHRASE_MODE before ever calling this, but this
  // function is itself reachable directly (e.g. from a browser
  // console), so it checks too rather than relying solely on its
  // callers to have gated it.
  if (!ENABLE_PHRASE_MODE) return;
  if (App.animating) return;

  App.animating = true;
  if (submitBtn) submitBtn.disabled = true;
  if (repeatBtn) repeatBtn.disabled = true;
  setStatus(`Encoding "${text}" in ${Math.round(PAUSE_BEFORE_START_MS / 1000)}s...`);
  updatePhrase([]);
  refreshIonDisplay();

  App.sequence = Array.from(text).map(ch => {
    const code = ch.charCodeAt(0) & 0xff;
    return { ch, code, bits: toBits(code) };
  });
  App.seqIndex = 0;

  App.sequenceTimer = setTimeout(advanceSequence, PAUSE_BEFORE_START_MS);
}

function advanceSequence() {
  if (App.seqIndex >= App.sequence.length) {
    App.animating = false;
    updatePhrase([]);
    refreshIonDisplay();
    if (submitBtn) submitBtn.disabled = false;
    if (repeatBtn) repeatBtn.disabled = false;
    setStatus(`Done encoding "${App.lastText}".`);
    return;
  }

  const { ch, code, bits } = App.sequence[App.seqIndex];
  const labels = bits.map(String);

  const frame = computeIonFrame(bits, App.noiseEnabled, App.mult);
  render(frame, labels);
  pushTrackingEntry(frame); // a real entered character -- record it if Tracking is on

  const charsSoFar = App.sequence.slice(0, App.seqIndex + 1).map(s => s.ch);
  updatePhrase(charsSoFar);

  setStatus(
    `'${displayChar(ch)}'  \u2192  ASCII ${code}  \u2192  ${labels.join("")}` +
    `   (${App.seqIndex + 1}/${App.sequence.length})`
  );

  const intervalSeconds = 1 / Math.max(App.freqHz, 0.01);
  playStep(App.stepCounter, intervalSeconds, ch);
  App.stepCounter++;
  App.seqIndex++;

  const delayMs = Math.round(intervalSeconds * 1000);
  App.sequenceTimer = setTimeout(advanceSequence, delayMs);
}

/* --- Shared control events --- */
function onSoundSchemeChanged() {
  // Start the new scheme from its first note rather than wherever the
  // old scheme's walk happened to be. (The scheme/colormap themselves
  // need no separate assignment here -- they're always read live from
  // soundSelect.value; see getActiveSchemeName() / getActiveCmapSpec().)
  App.stepCounter = 0;
  if (!(App.mode === "phrase" && App.animating)) refreshIonDisplay();
  if (App.trackingEnabled) drawTrackingGrid(); // reflect the (possibly new) colormap
}
soundSelect.addEventListener("change", onSoundSchemeChanged);

claritySlider.addEventListener("input", () => {
  App.mult = parseFloat(claritySlider.value);
});

noiseBtn.addEventListener("click", () => {
  App.noiseEnabled = !App.noiseEnabled;
  refreshNoiseButton();
});

trackingBtn.addEventListener("click", () => {
  App.trackingEnabled = !App.trackingEnabled;
  appRoot.classList.toggle("tracking-on", App.trackingEnabled);
  refreshTrackingButton();
  if (App.trackingEnabled) drawTrackingGrid(); // show whatever's already in the buffer right away
});

muteBtn.addEventListener("click", () => {
  App.audioEnabled = !App.audioEnabled;
  refreshMuteButton();
});

modeBtn.addEventListener("click", toggleMode);

fullscreenBtn.addEventListener("click", () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
});

entryInput.addEventListener("keydown", e => {
  if (e.key === "Enter" && App.mode === "phrase") {
    e.preventDefault();
    submitText();
  }
});

window.addEventListener("keydown", onKeyDown);

/* =======================================================================
   Startup
   ======================================================================= */
async function init() {
  if (!ENABLE_PHRASE_MODE) {
    modeBtn.style.display = "none"; // nothing to toggle to -- Letter Mode only
  }
  refreshNoiseButton();
  refreshTrackingButton();
  appRoot.classList.toggle("tracking-on", App.trackingEnabled);
  refreshMuteButton();
  refreshModeButton();
  buildModeSpecificControls();
  setStatus(defaultStatusText());

  try {
    App.ionArrays = await loadIonArrays();
    App.ionLoadError = null;
  } catch (err) {
    App.ionArrays = null;
    App.ionLoadError = err.message;
  }

  // The Tracking history's width has to match however many columns the
  // real ion data has; fall back to 36 (the notebook's own grid width)
  // if the data never loaded, so the panel still initializes cleanly --
  // it just never gets anything meaningful pushed into it in that case.
  const cols = App.ionArrays ? App.ionArrays[0][0].length : 36;
  App.trackingHistory = makeEmptyTrackingHistory(cols);
  if (App.trackingEnabled) drawTrackingGrid();

  updatePhrase([]);
  refreshIonDisplay();
  setInterval(idleTick, IDLE_REFRESH_MS);

  entryInput.focus();
}

init();

})(); // end IIFE