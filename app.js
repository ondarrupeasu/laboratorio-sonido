/* ====== Constantes ====== */
const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const FREQ_MIN = 20;
const FREQ_MAX = 20000;

let audioCtx = null;
let oscillator = null;
let gainNode = null;
let pannerNode = null;
let analyserTime = null;
let analyserFreq = null;
let meterAnalyser = null;
let isPlaying = false;
let rafId = null;

const state = {
  waveform: "sine",
  frequency: 440,
  amplitude: 50,
  pan: 0
};

/* ====== Mapeo slider <-> frecuencia (logarítmico) ====== */
// slider 0-1000 -> 20-20000 Hz, escala logarítmica
function sliderToFreq(sliderVal) {
  const minLog = Math.log(FREQ_MIN);
  const maxLog = Math.log(FREQ_MAX);
  const scale = (maxLog - minLog) / 1000;
  return Math.exp(minLog + scale * sliderVal);
}

function freqToSlider(freq) {
  const minLog = Math.log(FREQ_MIN);
  const maxLog = Math.log(FREQ_MAX);
  const scale = (maxLog - minLog) / 1000;
  return (Math.log(freq) - minLog) / scale;
}

/* ====== Conversión frecuencia <-> nota musical ====== */
// A4 = 440 Hz = MIDI 69
function freqToNote(freq) {
  if (freq <= 0) return { name: "-", octave: "", cents: 0, midi: 0 };
  const midiFloat = 12 * Math.log2(freq / 440) + 69;
  const midiRounded = Math.round(midiFloat);
  const cents = Math.round((midiFloat - midiRounded) * 100);
  const noteIndex = ((midiRounded % 12) + 12) % 12;
  const octave = Math.floor(midiRounded / 12) - 1;
  return {
    name: NOTE_NAMES[noteIndex],
    octave: octave,
    cents: cents,
    midi: midiRounded
  };
}

function noteToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/* ====== Inicialización audio ====== */
function ensureAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
}

function startTone() {
  ensureAudioContext();

  oscillator = audioCtx.createOscillator();
  gainNode = audioCtx.createGain();
  pannerNode = audioCtx.createStereoPanner();
  analyserTime = audioCtx.createAnalyser();
  analyserFreq = audioCtx.createAnalyser();
  meterAnalyser = audioCtx.createAnalyser();

  analyserTime.fftSize = 2048;
  analyserFreq.fftSize = 2048;
  meterAnalyser.fftSize = 1024;

  oscillator.type = state.waveform;
  oscillator.frequency.value = state.frequency;

  gainNode.gain.value = state.amplitude / 100;

  pannerNode.pan.value = state.pan / 100;

  oscillator.connect(gainNode);
  gainNode.connect(pannerNode);
  pannerNode.connect(analyserTime);
  pannerNode.connect(analyserFreq);
  pannerNode.connect(meterAnalyser);
  pannerNode.connect(audioCtx.destination);

  oscillator.start();
  isPlaying = true;

  startVisualLoop();
}

function stopTone() {
  if (oscillator) {
    try { oscillator.stop(); } catch (e) {}
    oscillator.disconnect();
    gainNode.disconnect();
    pannerNode.disconnect();
    oscillator = null;
  }
  isPlaying = false;
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  clearCanvases();
}

/* ====== Actualización en vivo de parámetros ====== */
function updateOscillatorParams() {
  if (oscillator) {
    oscillator.type = state.waveform;
    oscillator.frequency.setValueAtTime(state.frequency, audioCtx.currentTime);
  }
  if (gainNode) {
    gainNode.gain.setValueAtTime(state.amplitude / 100, audioCtx.currentTime);
  }
  if (pannerNode) {
    pannerNode.pan.setValueAtTime(state.pan / 100, audioCtx.currentTime);
  }
}

/* ====== Canvas setup con soporte alta densidad ====== */
function setupCanvas(canvas) {
  // Fija la altura CSS desde el atributo HTML 'height' la primera vez,
  // para que el layout no dependa del tamaño interno del canvas
  // (evita colapso a 0px cuando el módulo está oculto al inicializar).
  if (!canvas.style.height) {
    const attrHeight = canvas.getAttribute("height");
    if (attrHeight) canvas.style.height = attrHeight + "px";
  }

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  return { ctx, width: rect.width, height: rect.height };
}

function clearCanvases() {
  ["oscilloscope", "spectrum", "meter"].forEach(id => {
    const canvas = document.getElementById(id);
    const { ctx, width, height } = setupCanvas(canvas);
    ctx.clearRect(0, 0, width, height);
    drawGrid(ctx, width, height);
  });
  document.getElementById("meter-reading").textContent = "-∞ dB";
  redrawCycleView();
}

function redrawCycleView() {
  const canvas = document.getElementById("cycle-view");
  const { ctx, width, height } = setupCanvas(canvas);
  drawCycleView(ctx, width, height);
}

function drawGrid(ctx, width, height) {
  ctx.strokeStyle = getCssVar("--grid-line");
  ctx.lineWidth = 1;
  const divisions = 8;
  for (let i = 1; i < divisions; i++) {
    const x = (width / divisions) * i;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  const hDivisions = 4;
  for (let i = 1; i < hDivisions; i++) {
    const y = (height / hDivisions) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
}

function getCssVar(name) {
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}

/* ====== Bucle de visualización ====== */
function startVisualLoop() {
  const oscCanvas = document.getElementById("oscilloscope");
  const cycleCanvas = document.getElementById("cycle-view");
  const fftCanvas = document.getElementById("spectrum");
  const meterCanvas = document.getElementById("meter");

  const oscSetup = setupCanvas(oscCanvas);
  const cycleSetup = setupCanvas(cycleCanvas);
  const fftSetup = setupCanvas(fftCanvas);
  const meterSetup = setupCanvas(meterCanvas);

  const timeData = new Uint8Array(analyserTime.fftSize);
  const freqData = new Uint8Array(analyserFreq.frequencyBinCount);
  const meterData = new Float32Array(meterAnalyser.fftSize);

  function draw() {
    if (!isPlaying) return;

    // Osciloscopio
    analyserTime.getByteTimeDomainData(timeData);
    drawOscilloscope(oscSetup.ctx, oscSetup.width, oscSetup.height, timeData);

    // Forma de onda ideal (1 periodo)
    drawCycleView(cycleSetup.ctx, cycleSetup.width, cycleSetup.height);

    // FFT
    analyserFreq.getByteFrequencyData(freqData);
    drawSpectrum(fftSetup.ctx, fftSetup.width, fftSetup.height, freqData);

    // Medidor de nivel
    meterAnalyser.getFloatTimeDomainData(meterData);
    drawMeter(meterSetup.ctx, meterSetup.width, meterSetup.height, meterData);

    rafId = requestAnimationFrame(draw);
  }

  draw();
}

function drawOscilloscope(ctx, width, height, data) {
  ctx.clearRect(0, 0, width, height);
  drawGrid(ctx, width, height);

  ctx.lineWidth = 2;
  ctx.strokeStyle = getCssVar("--wave-color");
  ctx.beginPath();

  const sliceWidth = width / data.length;
  let x = 0;

  for (let i = 0; i < data.length; i++) {
    const v = data[i] / 128.0;
    const y = (v * height) / 2;
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
    x += sliceWidth;
  }
  ctx.stroke();
}

function drawCycleView(ctx, width, height) {
  ctx.clearRect(0, 0, width, height);
  drawGrid(ctx, width, height);

  const amplitude = state.amplitude / 100;
  const centerY = height / 2;
  const peakPx = (height / 2) * 0.8 * amplitude;

  ctx.lineWidth = 2;
  ctx.strokeStyle = getCssVar("--wave-color");
  ctx.beginPath();

  const steps = 200;
  for (let i = 0; i <= steps; i++) {
    const phase = i / steps; // 0..1 = un periodo completo
    const value = waveformValue(state.waveform, phase);
    const x = (i / steps) * width;
    const y = centerY - value * peakPx;
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();

  // Linea de amplitud cero
  ctx.strokeStyle = getCssVar("--grid-line");
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, centerY);
  ctx.lineTo(width, centerY);
  ctx.stroke();

  const periodMs = (1 / state.frequency) * 1000;
  document.getElementById("cycle-reading").textContent = `T = ${periodMs.toFixed(2)} ms`;
}

// Valor normalizado (-1..1) de la forma de onda en una fase 0..1
function waveformValue(waveform, phase) {
  switch (waveform) {
    case "square":
      return phase < 0.5 ? 1 : -1;
    case "triangle":
      return phase < 0.5
        ? -1 + 4 * phase
        : 3 - 4 * phase;
    case "sawtooth":
      return -1 + 2 * phase;
    case "sine":
    default:
      return Math.sin(2 * Math.PI * phase);
  }
}

function drawSpectrum(ctx, width, height, data) {
  ctx.clearRect(0, 0, width, height);
  drawGrid(ctx, width, height);

  const barCount = data.length;
  const barWidth = width / barCount;

  ctx.fillStyle = getCssVar("--fft-color");

  for (let i = 0; i < barCount; i++) {
    const value = data[i] / 255;
    const barHeight = value * height;
    ctx.fillRect(i * barWidth, height - barHeight, Math.max(barWidth - 1, 1), barHeight);
  }
}

function drawMeter(ctx, width, height, data) {
  ctx.clearRect(0, 0, width, height);

  // RMS
  let sumSquares = 0;
  for (let i = 0; i < data.length; i++) {
    sumSquares += data[i] * data[i];
  }
  const rms = Math.sqrt(sumSquares / data.length);
  const db = rms > 0 ? 20 * Math.log10(rms) : -Infinity;

  const minDb = -60;
  const clamped = Math.max(minDb, Math.min(0, db));
  const ratio = (clamped - minDb) / (0 - minDb);

  // background
  ctx.fillStyle = getCssVar("--track-bg");
  ctx.fillRect(0, 0, width, height);

  // barra vertical de abajo hacia arriba
  const barHeight = ratio * height;
  let color = getCssVar("--accent3");
  if (ratio > 0.85) color = getCssVar("--accent4");
  else if (ratio > 0.7) color = getCssVar("--accent2");

  ctx.fillStyle = color;
  ctx.fillRect(0, height - barHeight, width, barHeight);

  document.getElementById("meter-reading").textContent =
    db === -Infinity ? "-∞ dB" : `${db.toFixed(1)} dB`;
}

/* ====== Selector de nota + octava ====== */
const NOTE_SOLFEGE = {
  "C": "Do", "C#": "Do#", "D": "Re", "D#": "Re#", "E": "Mi",
  "F": "Fa", "F#": "Fa#", "G": "Sol", "G#": "Sol#", "A": "La",
  "A#": "La#", "B": "Si"
};
const OCTAVE_RANGE = [2, 3, 4, 5, 6];

function buildNoteSelector() {
  const noteGrid = document.getElementById("note-grid");
  noteGrid.innerHTML = "";
  NOTE_NAMES.forEach(name => {
    const btn = document.createElement("button");
    btn.className = "note-btn";
    btn.dataset.note = name;
    btn.innerHTML = `<span class="note-en">${name}</span><span class="note-solfege">${NOTE_SOLFEGE[name]}</span>`;
    btn.addEventListener("click", () => setFrequencyFromNoteOctave(name, getSelectedOctave()));
    noteGrid.appendChild(btn);
  });

  const octaveButtons = document.getElementById("octave-buttons");
  octaveButtons.innerHTML = "";
  OCTAVE_RANGE.forEach(oct => {
    const btn = document.createElement("button");
    btn.className = "octave-btn";
    btn.dataset.octave = oct;
    btn.textContent = oct;
    btn.addEventListener("click", () => setFrequencyFromNoteOctave(getSelectedNote(), oct));
    octaveButtons.appendChild(btn);
  });
}

function getSelectedNote() {
  const active = document.querySelector(".note-btn.active");
  return active ? active.dataset.note : "A";
}

function getSelectedOctave() {
  const active = document.querySelector(".octave-btn.active");
  return active ? parseInt(active.dataset.octave) : 4;
}

function noteOctaveToMidi(name, octave) {
  const noteIndex = NOTE_NAMES.indexOf(name);
  return (octave + 1) * 12 + noteIndex;
}

function setFrequencyFromNoteOctave(name, octave) {
  const midi = noteOctaveToMidi(name, octave);
  const freq = noteToFreq(midi);
  state.frequency = freq;
  document.getElementById("freq-slider").value = Math.round(freqToSlider(freq));
  updateFrequencyDisplay();
  updateOscillatorParams();
  redrawCycleView();
}

function highlightNoteSelector(noteName, octave) {
  document.querySelectorAll(".note-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.note === noteName);
  });
  document.querySelectorAll(".octave-btn").forEach(b => {
    b.classList.toggle("active", parseInt(b.dataset.octave) === octave);
  });
}

/* ====== Actualización de UI ====== */
function updateFrequencyDisplay() {
  const freq = state.frequency;
  document.getElementById("freq-value").textContent =
    freq >= 1000 ? (freq / 1000).toFixed(2) + "k" : Math.round(freq);

  const note = freqToNote(freq);
  const solfege = NOTE_SOLFEGE[note.name] || "";
  document.getElementById("note-name").textContent = `${note.name}${note.octave} — ${solfege}`;

  const centsSign = note.cents >= 0 ? "+" : "";
  document.getElementById("note-cents").textContent = `${centsSign}${note.cents} cents`;

  highlightNoteSelector(note.name, note.octave);
}

function updateAmplitudeDisplay() {
  const amp = state.amplitude;
  document.getElementById("amp-value").textContent = amp;
  const db = amp > 0 ? (20 * Math.log10(amp / 100)).toFixed(1) : "-Inf";
  document.getElementById("amp-db").textContent = `${db} dBFS`;
}

function updatePanDisplay() {
  const pan = state.pan;
  document.getElementById("pan-value").textContent = pan;
}

/* ====== Listeners ====== */
function initControls() {
  // Forma de onda
  document.querySelectorAll("#module-generator .wave-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#module-generator .wave-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.waveform = btn.dataset.wave;
      updateOscillatorParams();
      redrawCycleView();
    });
  });

  // Frecuencia
  const freqSlider = document.getElementById("freq-slider");
  freqSlider.addEventListener("input", () => {
    state.frequency = sliderToFreq(parseFloat(freqSlider.value));
    updateFrequencyDisplay();
    updateOscillatorParams();
    redrawCycleView();
  });

  // Amplitud
  const ampSlider = document.getElementById("amp-slider");
  ampSlider.addEventListener("input", () => {
    state.amplitude = parseFloat(ampSlider.value);
    updateAmplitudeDisplay();
    updateOscillatorParams();
    redrawCycleView();
  });

  // Pan (con snap-to-zero magnético)
  const panSlider = document.getElementById("pan-slider");
  const PAN_SNAP_THRESHOLD = 4;
  panSlider.addEventListener("input", () => {
    let value = parseFloat(panSlider.value);
    if (Math.abs(value) <= PAN_SNAP_THRESHOLD) {
      value = 0;
      panSlider.value = "0";
    }
    state.pan = value;
    updatePanDisplay();
    updateOscillatorParams();
  });

  // Play/Stop
  const playBtn = document.getElementById("play-btn");
  playBtn.addEventListener("click", () => {
    if (!isPlaying) {
      startTone();
      playBtn.classList.add("playing");
      document.getElementById("play-icon").innerHTML = "&#9632;";
      document.getElementById("play-label").textContent = t("stop");
    } else {
      stopTone();
      playBtn.classList.remove("playing");
      document.getElementById("play-icon").innerHTML = "&#9658;";
      document.getElementById("play-label").textContent = t("generate");
    }
  });

  // Tema claro/oscuro
  const themeToggle = document.getElementById("theme-toggle");
  themeToggle.addEventListener("click", () => {
    const body = document.body;
    const current = body.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";
    body.setAttribute("data-theme", next);
    document.getElementById("theme-icon").innerHTML = next === "dark" ? "&#9789;" : "&#9728;";
    if (isPlaying) {
      // redraw grid colors immediately
    }
  });

  // Idioma
  document.querySelectorAll("#lang-switch button").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#lang-switch button").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      applyTranslations(btn.dataset.lang);
      if (isPlaying) {
        const playBtn = document.getElementById("play-btn");
        document.getElementById("play-label").textContent = t("stop");
      }
      // Re-aplicar textos con interpolacion que applyTranslations sobrescribe
      samplingUpdateNyquistHint();
      samplingUpdateBitDepthDisplay();
    });
  });

  // Resize handling
  window.addEventListener("resize", () => {
    if (!isPlaying) {
      clearCanvases();
    }
    if (dualIsPlaying) {
      dualClearCanvases();
    }
    if (modIsPlaying) {
      modClearCanvases();
    }
    if (noiseIsPlaying || sweepIsPlaying) {
      noiseClearCanvases();
    }
    if (filterIsPlaying) {
      filterClearCanvases();
    }
    if (samplingIsPlaying) {
      samplingClearCanvases();
    }
    if (stereoIsPlaying) {
      stereoClearCanvases();
    }
  });

  // Cambio de módulo (tabs)
  document.querySelectorAll(".module-tab").forEach(tab => {
    if (tab.classList.contains("disabled")) return;
    tab.addEventListener("click", () => {
      const target = tab.dataset.module;
      document.querySelectorAll(".module-tab").forEach(t => t.classList.toggle("active", t === tab));
      document.querySelectorAll(".module-view").forEach(view => {
        view.hidden = view.id !== `module-${target}`;
      });

      // Detener audio del modulo que se abandona
      if (target !== "generator" && isPlaying) {
        stopTone();
        document.getElementById("play-btn").classList.remove("playing");
        document.getElementById("play-icon").innerHTML = "&#9658;";
        document.getElementById("play-label").textContent = t("generate");
      }
      if (target !== "dual" && dualIsPlaying) {
        dualStopTone();
        document.getElementById("dual-play-btn").classList.remove("playing");
        document.getElementById("dual-play-icon").innerHTML = "&#9658;";
        document.getElementById("dual-play-label").textContent = t("generate");
      }
      if (target !== "modulation" && modIsPlaying) {
        modStopTone();
        document.getElementById("mod-play-btn").classList.remove("playing");
        document.getElementById("mod-play-icon").innerHTML = "&#9658;";
        document.getElementById("mod-play-label").textContent = t("hold_to_play");
      }
      if (target !== "noise") {
        if (noiseIsPlaying) {
          noiseStopTone();
          document.getElementById("noise-play-btn").classList.remove("playing");
          document.getElementById("noise-play-icon").innerHTML = "&#9658;";
          document.getElementById("noise-play-label").textContent = t("generate");
        }
        if (sweepIsPlaying) {
          sweepStopTone();
          document.getElementById("sweep-play-btn").classList.remove("playing");
          document.getElementById("sweep-play-icon").innerHTML = "&#9658;";
          document.getElementById("sweep-play-label").textContent = t("generate");
        }
      }
      if (target !== "filters" && filterIsPlaying) {
        filterStopTone();
        document.getElementById("filter-play-btn").classList.remove("playing");
        document.getElementById("filter-play-icon").innerHTML = "&#9658;";
        document.getElementById("filter-play-label").textContent = t("generate");
      }
      if (target !== "sampling" && samplingIsPlaying) {
        samplingStopTone();
        document.getElementById("sampling-play-btn").classList.remove("playing");
        document.getElementById("sampling-play-icon").innerHTML = "&#9658;";
        document.getElementById("sampling-play-label").textContent = t("generate");
      }
      if (target !== "stereo" && stereoIsPlaying) {
        stereoStopTone();
        document.getElementById("stereo-play-btn").classList.remove("playing");
        document.getElementById("stereo-play-icon").innerHTML = "&#9658;";
        document.getElementById("stereo-play-label").textContent = t("generate");
      }

      if (target === "dual") {
        setTimeout(() => dualClearCanvases(), 50);
      } else if (target === "modulation") {
        setTimeout(() => modClearCanvases(), 50);
      } else if (target === "noise") {
        setTimeout(() => noiseClearCanvases(), 50);
      } else if (target === "filters") {
        setTimeout(() => filterClearCanvases(), 50);
      } else if (target === "sampling") {
        setTimeout(() => samplingClearCanvases(), 50);
      } else if (target === "stereo") {
        setTimeout(() => stereoClearCanvases(), 50);
      } else if (target === "generator" && !isPlaying) {
        setTimeout(() => clearCanvases(), 50);
      }
    });
  });
}

/* ====== Init ====== */
function init() {
  applyTranslations("es");
  buildNoteSelector();
  initControls();

  // Set initial slider position to 440 Hz
  document.getElementById("freq-slider").value = Math.round(freqToSlider(440));
  updateFrequencyDisplay();
  updateAmplitudeDisplay();
  updatePanDisplay();

  // Draw empty grids initially
  setTimeout(() => clearCanvases(), 50);
}

document.addEventListener("DOMContentLoaded", init);

/* ====================================================== */
/* ====== MÓDULO: DOS OSCILADORES (batido / fase) ====== */
/* ====================================================== */

let dualAudioCtx = null;
let dualOscA = null, dualOscB = null;
let dualGainA = null, dualGainB = null;
let dualMixGain = null;
let dualAnalyserA = null, dualAnalyserB = null, dualAnalyserSum = null, dualAnalyserFreq = null;
let dualIsPlaying = false;
let dualRafId = null;
let dualBeatInterval = null;

const dualState = {
  a: { waveform: "sine", frequency: 440, amplitude: 50 },
  b: { waveform: "sine", frequency: 440, amplitude: 50 },
  phase: 0
};

function dualEnsureAudioContext() {
  if (!dualAudioCtx) {
    dualAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (dualAudioCtx.state === "suspended") {
    dualAudioCtx.resume();
  }
}

// Calcula el delay (segundos) que produce el desfase deseado para osc B
function dualPhaseDelay() {
  const period = 1 / dualState.b.frequency;
  return (dualState.phase / 360) * period;
}

function dualStartTone() {
  dualEnsureAudioContext();

  dualOscA = dualAudioCtx.createOscillator();
  dualOscB = dualAudioCtx.createOscillator();
  dualGainA = dualAudioCtx.createGain();
  dualGainB = dualAudioCtx.createGain();
  dualMixGain = dualAudioCtx.createGain();
  dualAnalyserA = dualAudioCtx.createAnalyser();
  dualAnalyserB = dualAudioCtx.createAnalyser();
  dualAnalyserSum = dualAudioCtx.createAnalyser();
  dualAnalyserFreq = dualAudioCtx.createAnalyser();

  [dualAnalyserA, dualAnalyserB, dualAnalyserSum].forEach(a => a.fftSize = 2048);
  dualAnalyserFreq.fftSize = 2048;

  dualOscA.type = dualState.a.waveform;
  dualOscA.frequency.value = dualState.a.frequency;
  dualOscB.type = dualState.b.waveform;
  dualOscB.frequency.value = dualState.b.frequency;

  dualGainA.gain.value = dualState.a.amplitude / 100;
  dualGainB.gain.value = dualState.b.amplitude / 100;
  dualMixGain.gain.value = 0.5; // evita clipping al sumar A+B

  dualOscA.connect(dualGainA);
  dualOscB.connect(dualGainB);

  dualGainA.connect(dualAnalyserA);
  dualGainB.connect(dualAnalyserB);

  dualGainA.connect(dualMixGain);
  dualGainB.connect(dualMixGain);

  dualMixGain.connect(dualAnalyserSum);
  dualMixGain.connect(dualAnalyserFreq);
  dualMixGain.connect(dualAudioCtx.destination);

  const now = dualAudioCtx.currentTime;
  dualOscA.start(now);
  // Desfase de B mediante retardo de inicio
  const delay = dualPhaseDelay();
  dualOscB.start(now + delay);

  dualIsPlaying = true;
  dualStartVisualLoop();
  dualStartBeatPulse();
}

function dualStopTone() {
  [dualOscA, dualOscB].forEach(osc => {
    if (osc) { try { osc.stop(); } catch (e) {} osc.disconnect(); }
  });
  [dualGainA, dualGainB, dualMixGain].forEach(g => { if (g) g.disconnect(); });
  dualOscA = dualOscB = dualGainA = dualGainB = dualMixGain = null;

  dualIsPlaying = false;
  if (dualRafId) {
    cancelAnimationFrame(dualRafId);
    dualRafId = null;
  }
  if (dualBeatInterval) {
    clearTimeout(dualBeatInterval);
    dualBeatInterval = null;
  }
  document.getElementById("beat-pulse").classList.remove("active");
  dualClearCanvases();
}

// Reinicia los osciladores para aplicar cambios que no se pueden actualizar en vivo
// (forma de onda y fase requieren recrear el nodo en Web Audio para fase; forma de onda sí es en vivo)
function dualUpdateLiveParams() {
  if (dualOscA) {
    dualOscA.type = dualState.a.waveform;
    dualOscA.frequency.setValueAtTime(dualState.a.frequency, dualAudioCtx.currentTime);
  }
  if (dualOscB) {
    dualOscB.type = dualState.b.waveform;
    dualOscB.frequency.setValueAtTime(dualState.b.frequency, dualAudioCtx.currentTime);
  }
  if (dualGainA) dualGainA.gain.setValueAtTime(dualState.a.amplitude / 100, dualAudioCtx.currentTime);
  if (dualGainB) dualGainB.gain.setValueAtTime(dualState.b.amplitude / 100, dualAudioCtx.currentTime);
}

// La fase relativa requiere reiniciar B con un nuevo retardo de inicio
function dualRestartForPhaseChange() {
  if (!dualIsPlaying) return;
  dualStopTone();
  dualStartTone();
}

/* ====== Visualización ====== */
function dualClearCanvases() {
  ["dual-oscilloscope", "dual-spectrum"].forEach(id => {
    const canvas = document.getElementById(id);
    const { ctx, width, height } = setupCanvas(canvas);
    ctx.clearRect(0, 0, width, height);
    drawGrid(ctx, width, height);
  });
  document.getElementById("beat-freq-value").textContent = "0.00 Hz";
}

function dualStartVisualLoop() {
  const oscCanvas = document.getElementById("dual-oscilloscope");
  const fftCanvas = document.getElementById("dual-spectrum");

  const oscSetup = setupCanvas(oscCanvas);
  const fftSetup = setupCanvas(fftCanvas);

  const dataA = new Uint8Array(dualAnalyserA.fftSize);
  const dataB = new Uint8Array(dualAnalyserB.fftSize);
  const dataSum = new Uint8Array(dualAnalyserSum.fftSize);
  const freqData = new Uint8Array(dualAnalyserFreq.frequencyBinCount);

  function draw() {
    if (!dualIsPlaying) return;

    dualAnalyserA.getByteTimeDomainData(dataA);
    dualAnalyserB.getByteTimeDomainData(dataB);
    dualAnalyserSum.getByteTimeDomainData(dataSum);
    drawDualOscilloscope(oscSetup.ctx, oscSetup.width, oscSetup.height, dataA, dataB, dataSum);

    dualAnalyserFreq.getByteFrequencyData(freqData);
    drawSpectrum(fftSetup.ctx, fftSetup.width, fftSetup.height, freqData);

    dualRafId = requestAnimationFrame(draw);
  }

  draw();
}

function dualDrawTrace(ctx, width, height, data, color) {
  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  ctx.beginPath();
  const sliceWidth = width / data.length;
  let x = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i] / 128.0;
    const y = (v * height) / 2;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
    x += sliceWidth;
  }
  ctx.stroke();
}

function drawDualOscilloscope(ctx, width, height, dataA, dataB, dataSum) {
  ctx.clearRect(0, 0, width, height);
  drawGrid(ctx, width, height);

  dualDrawTrace(ctx, width, height, dataA, getCssVar("--wave-color"));
  dualDrawTrace(ctx, width, height, dataB, getCssVar("--accent2"));
  dualDrawTrace(ctx, width, height, dataSum, getCssVar("--accent3"));
}

/* ====== Frecuencia de batido y pulso visual ====== */
function dualUpdateBeatFrequency() {
  const beat = Math.abs(dualState.a.frequency - dualState.b.frequency);
  document.getElementById("beat-freq-value").textContent = `${beat.toFixed(2)} Hz`;
  return beat;
}

function dualStartBeatPulse() {
  if (dualBeatInterval) clearTimeout(dualBeatInterval);
  const pulse = document.getElementById("beat-pulse");

  function schedule() {
    const beat = dualUpdateBeatFrequency();
    if (!dualIsPlaying) return;

    if (beat < 0.5 || beat > 20) {
      // batido demasiado lento o demasiado rapido para pulso visual util
      pulse.classList.remove("active");
      dualBeatInterval = setTimeout(schedule, 500);
      return;
    }

    const periodMs = (1 / beat) * 1000;
    pulse.classList.add("active");
    dualBeatInterval = setTimeout(() => {
      pulse.classList.remove("active");
      dualBeatInterval = setTimeout(schedule, periodMs / 2);
    }, periodMs / 2);
  }

  schedule();
}

/* ====== UI: displays ====== */
function dualUpdateFreqDisplay(osc) {
  const freq = dualState[osc].frequency;
  const valueEl = document.getElementById(`dual-${osc}-freq-value`);
  valueEl.textContent = freq >= 1000 ? (freq / 1000).toFixed(2) + "k" : Math.round(freq);

  const note = freqToNote(freq);
  const solfege = NOTE_SOLFEGE[note.name] || "";
  document.getElementById(`dual-${osc}-note`).textContent = `${note.name}${note.octave} — ${solfege}`;

  dualUpdateBeatFrequency();
}

function dualUpdateAmpDisplay(osc) {
  document.getElementById(`dual-${osc}-amp-value`).textContent = dualState[osc].amplitude;
}

/* ====== Listeners del módulo ====== */
function initDualControls() {
  // Forma de onda A y B
  ["a", "b"].forEach(osc => {
    document.querySelectorAll(`#dual-${osc}-waveform-grid .wave-btn`).forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(`#dual-${osc}-waveform-grid .wave-btn`).forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        dualState[osc].waveform = btn.dataset.wave;
        dualUpdateLiveParams();
      });
    });

    // Frecuencia
    const freqSlider = document.getElementById(`dual-${osc}-freq-slider`);
    freqSlider.addEventListener("input", () => {
      dualState[osc].frequency = sliderToFreq(parseFloat(freqSlider.value));
      dualUpdateFreqDisplay(osc);
      dualUpdateLiveParams();
    });

    // Amplitud
    const ampSlider = document.getElementById(`dual-${osc}-amp-slider`);
    ampSlider.addEventListener("input", () => {
      dualState[osc].amplitude = parseFloat(ampSlider.value);
      dualUpdateAmpDisplay(osc);
      dualUpdateLiveParams();
    });
  });

  // Fase relativa de B
  const phaseSlider = document.getElementById("dual-phase-slider");
  phaseSlider.addEventListener("input", () => {
    dualState.phase = parseFloat(phaseSlider.value);
    document.getElementById("dual-phase-value").textContent = dualState.phase;
  });
  phaseSlider.addEventListener("change", () => {
    dualRestartForPhaseChange();
  });

  // Preajuste de batido
  document.getElementById("beat-preset-btn").addEventListener("click", () => {
    dualState.a.frequency = 440;
    dualState.b.frequency = 444;
    dualState.phase = 0;

    document.getElementById("dual-a-freq-slider").value = Math.round(freqToSlider(440));
    document.getElementById("dual-b-freq-slider").value = Math.round(freqToSlider(444));
    document.getElementById("dual-phase-slider").value = 0;
    document.getElementById("dual-phase-value").textContent = "0";

    dualUpdateFreqDisplay("a");
    dualUpdateFreqDisplay("b");

    if (dualIsPlaying) {
      dualUpdateLiveParams();
      dualRestartForPhaseChange();
    }
  });

  // Play/Stop
  const dualPlayBtn = document.getElementById("dual-play-btn");
  dualPlayBtn.addEventListener("click", () => {
    if (!dualIsPlaying) {
      dualStartTone();
      dualPlayBtn.classList.add("playing");
      document.getElementById("dual-play-icon").innerHTML = "&#9632;";
      document.getElementById("dual-play-label").textContent = t("stop");
    } else {
      dualStopTone();
      dualPlayBtn.classList.remove("playing");
      document.getElementById("dual-play-icon").innerHTML = "&#9658;";
      document.getElementById("dual-play-label").textContent = t("generate");
    }
  });
}

/* ====== Init del módulo dual ====== */
function dualInit() {
  initDualControls();

  document.getElementById("dual-a-freq-slider").value = Math.round(freqToSlider(440));
  document.getElementById("dual-b-freq-slider").value = Math.round(freqToSlider(440));
  dualUpdateFreqDisplay("a");
  dualUpdateFreqDisplay("b");
  dualUpdateAmpDisplay("a");
  dualUpdateAmpDisplay("b");

  setTimeout(() => dualClearCanvases(), 50);
}

document.addEventListener("DOMContentLoaded", dualInit);

/* ====================================================== */
/* ====== MÓDULO: MODULACIÓN (ADSR / tremolo / vibrato) === */
/* ====================================================== */

let modAudioCtx = null;
let modOsc = null;
let modAmpGain = null;        // controlado por la envolvente ADSR
let modTremoloGain = null;    // multiplica la señal (tremolo)
let modTremoloLFO = null;
let modTremoloLFOGain = null;
let modVibratoLFO = null;
let modVibratoLFOGain = null;
let modAnalyserTime = null;
let modAnalyserFreq = null;
let modIsPlaying = false;
let modRafId = null;
let modReleaseTimeout = null;

const modState = {
  waveform: "sine",
  frequency: 440,
  amplitude: 50,
  adsr: { attack: 0.05, decay: 0.10, sustain: 0.70, release: 0.30 },
  tremolo: { enabled: false, rate: 5, depth: 50 },
  vibrato: { enabled: false, rate: 5, depth: 20 }
};

function modEnsureAudioContext() {
  if (!modAudioCtx) {
    modAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (modAudioCtx.state === "suspended") {
    modAudioCtx.resume();
  }
}

function modStartTone() {
  modEnsureAudioContext();
  if (modReleaseTimeout) {
    clearTimeout(modReleaseTimeout);
    modReleaseTimeout = null;
  }

  modOsc = modAudioCtx.createOscillator();
  modAmpGain = modAudioCtx.createGain();
  modTremoloGain = modAudioCtx.createGain();
  modAnalyserTime = modAudioCtx.createAnalyser();
  modAnalyserFreq = modAudioCtx.createAnalyser();

  modAnalyserTime.fftSize = 2048;
  modAnalyserFreq.fftSize = 2048;

  modOsc.type = modState.waveform;
  modOsc.frequency.value = modState.frequency;

  const peakGain = modState.amplitude / 100;
  modAmpGain.gain.value = 0;
  modTremoloGain.gain.value = 1;

  modOsc.connect(modAmpGain);
  modAmpGain.connect(modTremoloGain);
  modTremoloGain.connect(modAnalyserTime);
  modTremoloGain.connect(modAnalyserFreq);
  modTremoloGain.connect(modAudioCtx.destination);

  const now = modAudioCtx.currentTime;
  modOsc.start(now);

  // Envolvente ADSR: Attack -> Decay -> Sustain (mantenido hasta Release)
  const { attack, decay, sustain } = modState.adsr;
  modAmpGain.gain.setValueAtTime(0, now);
  modAmpGain.gain.linearRampToValueAtTime(peakGain, now + attack);
  modAmpGain.gain.linearRampToValueAtTime(peakGain * sustain, now + attack + decay);

  // Vibrato: LFO sumado a la frecuencia del oscilador principal
  if (modState.vibrato.enabled) {
    modVibratoLFO = modAudioCtx.createOscillator();
    modVibratoLFOGain = modAudioCtx.createGain();
    modVibratoLFO.type = "sine";
    modVibratoLFO.frequency.value = modState.vibrato.rate;
    modVibratoLFOGain.gain.value = modState.vibrato.depth;
    modVibratoLFO.connect(modVibratoLFOGain);
    modVibratoLFOGain.connect(modOsc.frequency);
    modVibratoLFO.start(now);
  }

  // Tremolo: LFO que modula la ganancia de salida entre (1-depth) y 1
  if (modState.tremolo.enabled) {
    modTremoloLFO = modAudioCtx.createOscillator();
    modTremoloLFOGain = modAudioCtx.createGain();
    modTremoloLFO.type = "sine";
    modTremoloLFO.frequency.value = modState.tremolo.rate;
    const depthRatio = modState.tremolo.depth / 100;
    // LFO oscila -depth/2 .. +depth/2 alrededor de 0
    modTremoloLFOGain.gain.value = depthRatio / 2;
    modTremoloGain.gain.value = 1 - depthRatio / 2;
    modTremoloLFO.connect(modTremoloLFOGain);
    modTremoloLFOGain.connect(modTremoloGain.gain);
    modTremoloLFO.start(now);
  }

  modIsPlaying = true;
  modStartVisualLoop();
}

function modStopTone() {
  if (!modOsc) return;

  const now = modAudioCtx.currentTime;
  const { release } = modState.adsr;
  const currentGain = modAmpGain.gain.value;

  // Aplica Release y luego detiene los nodos
  modAmpGain.gain.cancelScheduledValues(now);
  modAmpGain.gain.setValueAtTime(currentGain, now);
  modAmpGain.gain.linearRampToValueAtTime(0, now + release);

  const oscToStop = modOsc;
  const vibratoToStop = modVibratoLFO;
  const tremoloToStop = modTremoloLFO;
  const nodesToDisconnect = [modAmpGain, modTremoloGain, modVibratoLFOGain, modTremoloLFOGain];

  modReleaseTimeout = setTimeout(() => {
    try { oscToStop.stop(); } catch (e) {}
    if (vibratoToStop) try { vibratoToStop.stop(); } catch (e) {}
    if (tremoloToStop) try { tremoloToStop.stop(); } catch (e) {}
    nodesToDisconnect.forEach(n => { if (n) try { n.disconnect(); } catch (e) {} });
    oscToStop.disconnect();
    modReleaseTimeout = null;
  }, release * 1000 + 50);

  modOsc = modAmpGain = modTremoloGain = null;
  modVibratoLFO = modVibratoLFOGain = null;
  modTremoloLFO = modTremoloLFOGain = null;

  modIsPlaying = false;
  if (modRafId) {
    cancelAnimationFrame(modRafId);
    modRafId = null;
  }
  modClearCanvases();
}

/* ====== Visualización ====== */
function modClearCanvases() {
  ["adsr-envelope", "mod-oscilloscope", "mod-spectrum"].forEach(id => {
    const canvas = document.getElementById(id);
    const { ctx, width, height } = setupCanvas(canvas);
    ctx.clearRect(0, 0, width, height);
    drawGrid(ctx, width, height);
  });
  modRedrawEnvelope();
}

function modStartVisualLoop() {
  const oscCanvas = document.getElementById("mod-oscilloscope");
  const fftCanvas = document.getElementById("mod-spectrum");

  const oscSetup = setupCanvas(oscCanvas);
  const fftSetup = setupCanvas(fftCanvas);

  const timeData = new Uint8Array(modAnalyserTime.fftSize);
  const freqData = new Uint8Array(modAnalyserFreq.frequencyBinCount);

  function draw() {
    if (!modIsPlaying) return;

    modAnalyserTime.getByteTimeDomainData(timeData);
    drawOscilloscope(oscSetup.ctx, oscSetup.width, oscSetup.height, timeData);

    modAnalyserFreq.getByteFrequencyData(freqData);
    drawSpectrum(fftSetup.ctx, fftSetup.width, fftSetup.height, freqData);

    modRafId = requestAnimationFrame(draw);
  }

  draw();
}

// Dibuja la curva ADSR de forma esquemática (Attack-Decay-Sustain-Release)
// con los tiempos a escala relativa entre si
function modRedrawEnvelope() {
  const canvas = document.getElementById("adsr-envelope");
  const { ctx, width, height } = setupCanvas(canvas);
  ctx.clearRect(0, 0, width, height);
  drawGrid(ctx, width, height);

  const { attack, decay, sustain, release } = modState.adsr;
  const sustainHold = Math.max(attack, decay, release, 0.1); // duracion visual del tramo sustain
  const total = attack + decay + sustainHold + release;

  const padding = 8;
  const usableHeight = height - padding * 2;
  const peakY = padding;
  const sustainY = padding + usableHeight * (1 - sustain);
  const baseY = height - padding;

  const xAttack = (attack / total) * width;
  const xDecay = xAttack + (decay / total) * width;
  const xSustain = xDecay + (sustainHold / total) * width;
  const xRelease = width;

  ctx.lineWidth = 2;
  ctx.strokeStyle = getCssVar("--wave-color");
  ctx.beginPath();
  ctx.moveTo(0, baseY);
  ctx.lineTo(xAttack, peakY);
  ctx.lineTo(xDecay, sustainY);
  ctx.lineTo(xSustain, sustainY);
  ctx.lineTo(xRelease, baseY);
  ctx.stroke();

  // Marcadores verticales en los puntos de transicion
  ctx.strokeStyle = getCssVar("--grid-line");
  ctx.lineWidth = 1;
  [xAttack, xDecay, xSustain].forEach(x => {
    ctx.beginPath();
    ctx.moveTo(x, padding);
    ctx.lineTo(x, height - padding);
    ctx.stroke();
  });

  const totalReal = attack + decay + release;
  document.getElementById("adsr-total-reading").textContent =
    `A+D+R = ${totalReal.toFixed(2)} s`;
}

/* ====== UI: displays ====== */
function modUpdateFreqDisplay() {
  const freq = modState.frequency;
  document.getElementById("mod-freq-value").textContent =
    freq >= 1000 ? (freq / 1000).toFixed(2) + "k" : Math.round(freq);

  const note = freqToNote(freq);
  const solfege = NOTE_SOLFEGE[note.name] || "";
  document.getElementById("mod-note").textContent = `${note.name}${note.octave} — ${solfege}`;
}

function modUpdateAmpDisplay() {
  document.getElementById("mod-amp-value").textContent = modState.amplitude;
}

// sliders ADSR: attack/decay/release usan escala 1-2000/3000 (ms), sustain en %
function modUpdateAdsrDisplay() {
  document.getElementById("adsr-attack-value").textContent = modState.adsr.attack.toFixed(2);
  document.getElementById("adsr-decay-value").textContent = modState.adsr.decay.toFixed(2);
  document.getElementById("adsr-sustain-value").textContent = Math.round(modState.adsr.sustain * 100);
  document.getElementById("adsr-release-value").textContent = modState.adsr.release.toFixed(2);
  modRedrawEnvelope();
}

function modUpdateTremoloDisplay() {
  document.getElementById("tremolo-rate-value").textContent = modState.tremolo.rate.toFixed(1);
  document.getElementById("tremolo-depth-value").textContent = modState.tremolo.depth;
}

function modUpdateVibratoDisplay() {
  document.getElementById("vibrato-rate-value").textContent = modState.vibrato.rate.toFixed(1);
  document.getElementById("vibrato-depth-value").textContent = modState.vibrato.depth;
}

/* ====== Listeners del módulo ====== */
function initModControls() {
  // Forma de onda
  document.querySelectorAll("#mod-waveform-grid .wave-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#mod-waveform-grid .wave-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      modState.waveform = btn.dataset.wave;
      if (modOsc) modOsc.type = modState.waveform;
    });
  });

  // Frecuencia
  const freqSlider = document.getElementById("mod-freq-slider");
  freqSlider.addEventListener("input", () => {
    modState.frequency = sliderToFreq(parseFloat(freqSlider.value));
    modUpdateFreqDisplay();
    if (modOsc) modOsc.frequency.setValueAtTime(modState.frequency, modAudioCtx.currentTime);
  });

  // Amplitud (en vivo: reescala el gain actual manteniendo la fase ADSR)
  const ampSlider = document.getElementById("mod-amp-slider");
  ampSlider.addEventListener("input", () => {
    const oldAmplitude = modState.amplitude;
    modState.amplitude = parseFloat(ampSlider.value);
    modUpdateAmpDisplay();

    if (modAmpGain && oldAmplitude > 0) {
      const ratio = modState.amplitude / oldAmplitude;
      const newGain = modAmpGain.gain.value * ratio;
      modAmpGain.gain.setValueAtTime(newGain, modAudioCtx.currentTime);
    }
  });

  // ADSR sliders (escala: attack/decay en ms 1-2000 -> 0.001-2.0 s, release 1-3000 -> 0.001-3.0 s)
  const attackSlider = document.getElementById("adsr-attack-slider");
  attackSlider.addEventListener("input", () => {
    modState.adsr.attack = parseFloat(attackSlider.value) / 1000;
    modUpdateAdsrDisplay();
  });

  const decaySlider = document.getElementById("adsr-decay-slider");
  decaySlider.addEventListener("input", () => {
    modState.adsr.decay = parseFloat(decaySlider.value) / 1000;
    modUpdateAdsrDisplay();
  });

  const sustainSlider = document.getElementById("adsr-sustain-slider");
  sustainSlider.addEventListener("input", () => {
    modState.adsr.sustain = parseFloat(sustainSlider.value) / 100;
    modUpdateAdsrDisplay();
  });

  const releaseSlider = document.getElementById("adsr-release-slider");
  releaseSlider.addEventListener("input", () => {
    modState.adsr.release = parseFloat(releaseSlider.value) / 1000;
    modUpdateAdsrDisplay();
  });

  // Tremolo
  const tremoloEnable = document.getElementById("tremolo-enable");
  tremoloEnable.addEventListener("change", () => {
    modState.tremolo.enabled = tremoloEnable.checked;
  });

  const tremoloRate = document.getElementById("tremolo-rate-slider");
  tremoloRate.addEventListener("input", () => {
    modState.tremolo.rate = parseFloat(tremoloRate.value) / 10;
    modUpdateTremoloDisplay();
    if (modTremoloLFO) modTremoloLFO.frequency.setValueAtTime(modState.tremolo.rate, modAudioCtx.currentTime);
  });

  const tremoloDepth = document.getElementById("tremolo-depth-slider");
  tremoloDepth.addEventListener("input", () => {
    modState.tremolo.depth = parseFloat(tremoloDepth.value);
    modUpdateTremoloDisplay();
    if (modTremoloLFOGain) {
      const depthRatio = modState.tremolo.depth / 100;
      modTremoloLFOGain.gain.setValueAtTime(depthRatio / 2, modAudioCtx.currentTime);
      modTremoloGain.gain.setValueAtTime(1 - depthRatio / 2, modAudioCtx.currentTime);
    }
  });

  // Vibrato
  const vibratoEnable = document.getElementById("vibrato-enable");
  vibratoEnable.addEventListener("change", () => {
    modState.vibrato.enabled = vibratoEnable.checked;
  });

  const vibratoRate = document.getElementById("vibrato-rate-slider");
  vibratoRate.addEventListener("input", () => {
    modState.vibrato.rate = parseFloat(vibratoRate.value) / 10;
    modUpdateVibratoDisplay();
    if (modVibratoLFO) modVibratoLFO.frequency.setValueAtTime(modState.vibrato.rate, modAudioCtx.currentTime);
  });

  const vibratoDepth = document.getElementById("vibrato-depth-slider");
  vibratoDepth.addEventListener("input", () => {
    modState.vibrato.depth = parseFloat(vibratoDepth.value);
    modUpdateVibratoDisplay();
    if (modVibratoLFOGain) modVibratoLFOGain.gain.setValueAtTime(modState.vibrato.depth, modAudioCtx.currentTime);
  });

  // Tecla: mantener pulsado dispara Attack-Decay-Sustain, soltar dispara Release
  const modPlayBtn = document.getElementById("mod-play-btn");

  const modPress = (e) => {
    e.preventDefault();
    if (modIsPlaying) return;
    modStartTone();
    modPlayBtn.classList.add("playing");
    document.getElementById("mod-play-icon").innerHTML = "&#9655;";
    document.getElementById("mod-play-label").textContent = t("playing_note");
  };

  const modRelease = (e) => {
    if (!modIsPlaying) return;
    modStopTone();
    modPlayBtn.classList.remove("playing");
    document.getElementById("mod-play-icon").innerHTML = "&#9658;";
    document.getElementById("mod-play-label").textContent = t("hold_to_play");
  };

  modPlayBtn.addEventListener("pointerdown", modPress);
  modPlayBtn.addEventListener("pointerup", modRelease);
  modPlayBtn.addEventListener("pointerleave", modRelease);
  modPlayBtn.addEventListener("pointercancel", modRelease);
}

/* ====== Init del módulo modulación ====== */
function modInit() {
  initModControls();

  document.getElementById("mod-freq-slider").value = Math.round(freqToSlider(440));
  modUpdateFreqDisplay();
  modUpdateAmpDisplay();
  modUpdateAdsrDisplay();
  modUpdateTremoloDisplay();
  modUpdateVibratoDisplay();

  setTimeout(() => modClearCanvases(), 50);
}

document.addEventListener("DOMContentLoaded", modInit);

/* ====================================================== */
/* ====== MÓDULO: RUIDO Y BARRIDOS ====================== */
/* ====================================================== */

let noiseAudioCtx = null;
let noiseSource = null;
let noiseGain = null;
let noiseAnalyserTime = null;
let noiseAnalyserFreq = null;
let noiseIsPlaying = false;

let sweepOsc = null;
let sweepGain = null;
let sweepAnalyserTime = null;
let sweepAnalyserFreq = null;
let sweepIsPlaying = false;
let sweepRafId = null;
let sweepStartTime = 0;

const noiseState = {
  type: "white",
  amplitude: 30
};

const sweepState = {
  mode: "manual",
  frequency: 440,
  duration: 10,
  amplitude: 30
};

const hearingMarks = [];

function noiseEnsureAudioContext() {
  if (!noiseAudioCtx) {
    noiseAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (noiseAudioCtx.state === "suspended") {
    noiseAudioCtx.resume();
  }
}

/* ====== Generación de buffers de ruido ====== */
function createNoiseBuffer(type) {
  const bufferSize = noiseAudioCtx.sampleRate * 2; // 2 segundos, en loop
  const buffer = noiseAudioCtx.createBuffer(1, bufferSize, noiseAudioCtx.sampleRate);
  const data = buffer.getChannelData(0);

  if (type === "white") {
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
  } else if (type === "pink") {
    // Algoritmo de Paul Kellet (aproximacion habitual de ruido rosa)
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
      b6 = white * 0.115926;
      data[i] = pink * 0.11;
    }
  } else if (type === "brown") {
    // Paseo aleatorio (integracion de ruido blanco), normalizado
    let last = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + white * 0.02);
      last = Math.max(-1, Math.min(1, last));
      data[i] = last * 3.5; // compensa la baja amplitud tipica del paseo aleatorio
    }
    // re-normaliza por si supera el rango
    let max = 0;
    for (let i = 0; i < bufferSize; i++) max = Math.max(max, Math.abs(data[i]));
    if (max > 1) for (let i = 0; i < bufferSize; i++) data[i] /= max;
  }

  return buffer;
}

function noiseStartTone() {
  noiseEnsureAudioContext();

  noiseSource = noiseAudioCtx.createBufferSource();
  noiseGain = noiseAudioCtx.createGain();
  noiseAnalyserTime = noiseAudioCtx.createAnalyser();
  noiseAnalyserFreq = noiseAudioCtx.createAnalyser();

  noiseAnalyserTime.fftSize = 2048;
  noiseAnalyserFreq.fftSize = 2048;

  noiseSource.buffer = createNoiseBuffer(noiseState.type);
  noiseSource.loop = true;
  noiseGain.gain.value = noiseState.amplitude / 100;

  noiseSource.connect(noiseGain);
  noiseGain.connect(noiseAnalyserTime);
  noiseGain.connect(noiseAnalyserFreq);
  noiseGain.connect(noiseAudioCtx.destination);

  noiseSource.start();
  noiseIsPlaying = true;
  noiseStartVisualLoop();
}

function noiseStopTone() {
  if (noiseSource) {
    try { noiseSource.stop(); } catch (e) {}
    noiseSource.disconnect();
    noiseGain.disconnect();
    noiseSource = null;
  }
  noiseIsPlaying = false;
  if (!sweepIsPlaying && noiseRafId) {
    cancelAnimationFrame(noiseRafId);
    noiseRafId = null;
  }
  if (!sweepIsPlaying) noiseClearCanvases();
}

let noiseRafId = null;

/* ====== Sweep (barrido de frecuencia) ====== */
function sweepStartTone() {
  noiseEnsureAudioContext();

  sweepOsc = noiseAudioCtx.createOscillator();
  sweepGain = noiseAudioCtx.createGain();
  sweepAnalyserTime = noiseAudioCtx.createAnalyser();
  sweepAnalyserFreq = noiseAudioCtx.createAnalyser();

  sweepAnalyserTime.fftSize = 2048;
  sweepAnalyserFreq.fftSize = 2048;

  sweepOsc.type = "sine";
  sweepGain.gain.value = sweepState.amplitude / 100;

  sweepOsc.connect(sweepGain);
  sweepGain.connect(sweepAnalyserTime);
  sweepGain.connect(sweepAnalyserFreq);
  sweepGain.connect(noiseAudioCtx.destination);

  const now = noiseAudioCtx.currentTime;

  if (sweepState.mode === "auto") {
    sweepOsc.frequency.setValueAtTime(FREQ_MIN, now);
    sweepOsc.frequency.exponentialRampToValueAtTime(FREQ_MAX, now + sweepState.duration);
    sweepStartTime = now;
  } else {
    sweepOsc.frequency.setValueAtTime(sweepState.frequency, now);
  }

  sweepOsc.start(now);
  sweepIsPlaying = true;
  noiseStartVisualLoop();
}

function sweepStopTone() {
  if (sweepOsc) {
    try { sweepOsc.stop(); } catch (e) {}
    sweepOsc.disconnect();
    sweepGain.disconnect();
    sweepOsc = null;
  }
  sweepIsPlaying = false;
  if (!noiseIsPlaying && noiseRafId) {
    cancelAnimationFrame(noiseRafId);
    noiseRafId = null;
  }
  if (!noiseIsPlaying) noiseClearCanvases();
}

/* ====== Visualización ====== */
function noiseClearCanvases() {
  ["noise-oscilloscope", "noise-spectrum"].forEach(id => {
    const canvas = document.getElementById(id);
    const { ctx, width, height } = setupCanvas(canvas);
    ctx.clearRect(0, 0, width, height);
    drawGrid(ctx, width, height);
  });
  sweepRedrawPosition();
}

function noiseStartVisualLoop() {
  const oscCanvas = document.getElementById("noise-oscilloscope");
  const fftCanvas = document.getElementById("noise-spectrum");

  const oscSetup = setupCanvas(oscCanvas);
  const fftSetup = setupCanvas(fftCanvas);

  function draw() {
    if (!noiseIsPlaying && !sweepIsPlaying) return;

    // Osciloscopio: usa la fuente activa (ruido o sweep); si ambas, prioriza sweep
    const timeAnalyser = sweepIsPlaying ? sweepAnalyserTime : noiseAnalyserTime;
    const freqAnalyser = sweepIsPlaying ? sweepAnalyserFreq : noiseAnalyserFreq;

    const timeData = new Uint8Array(timeAnalyser.fftSize);
    const freqData = new Uint8Array(freqAnalyser.frequencyBinCount);

    timeAnalyser.getByteTimeDomainData(timeData);
    drawOscilloscope(oscSetup.ctx, oscSetup.width, oscSetup.height, timeData);

    freqAnalyser.getByteFrequencyData(freqData);
    drawSpectrum(fftSetup.ctx, fftSetup.width, fftSetup.height, freqData);

    if (sweepIsPlaying) sweepUpdatePosition();

    noiseRafId = requestAnimationFrame(draw);
  }

  draw();
}

// Dibuja la barra de posición logarítmica con marcador de frecuencia actual
function sweepRedrawPosition() {
  const canvas = document.getElementById("sweep-position");
  const { ctx, width, height } = setupCanvas(canvas);
  ctx.clearRect(0, 0, width, height);

  // pista de fondo
  ctx.fillStyle = getCssVar("--track-bg");
  ctx.fillRect(0, height / 2 - 2, width, 4);

  const freq = sweepCurrentFrequency();
  const ratio = freqToSlider(freq) / 1000; // 0..1
  const x = ratio * width;

  ctx.fillStyle = getCssVar("--wave-color");
  ctx.beginPath();
  ctx.arc(x, height / 2, 8, 0, Math.PI * 2);
  ctx.fill();

  document.getElementById("sweep-current-reading").textContent =
    freq >= 1000 ? (freq / 1000).toFixed(2) + "k Hz" : Math.round(freq) + " Hz";
}

function sweepCurrentFrequency() {
  if (!sweepIsPlaying) return sweepState.frequency;
  if (sweepState.mode === "manual") return sweepState.frequency;

  const elapsed = noiseAudioCtx.currentTime - sweepStartTime;
  const progress = Math.min(1, elapsed / sweepState.duration);
  return FREQ_MIN * Math.pow(FREQ_MAX / FREQ_MIN, progress);
}

function sweepUpdatePosition() {
  sweepRedrawPosition();
  // Al terminar el barrido automatico, se detiene solo
  if (sweepState.mode === "auto") {
    const elapsed = noiseAudioCtx.currentTime - sweepStartTime;
    if (elapsed >= sweepState.duration) {
      sweepStopTone();
      document.getElementById("sweep-play-btn").classList.remove("playing");
      document.getElementById("sweep-play-icon").innerHTML = "&#9658;";
      document.getElementById("sweep-play-label").textContent = t("generate");
    }
  }
}

/* ====== UI: displays ====== */
function noiseUpdateAmpDisplay() {
  document.getElementById("noise-amp-value").textContent = noiseState.amplitude;
}

function sweepUpdateFreqDisplay() {
  const freq = sweepState.frequency;
  document.getElementById("sweep-freq-value").textContent =
    freq >= 1000 ? (freq / 1000).toFixed(2) + "k" : Math.round(freq);

  const note = freqToNote(freq);
  const solfege = NOTE_SOLFEGE[note.name] || "";
  document.getElementById("sweep-note").textContent = `${note.name}${note.octave} — ${solfege}`;

  if (sweepOsc && sweepState.mode === "manual") {
    sweepOsc.frequency.setValueAtTime(sweepState.frequency, noiseAudioCtx.currentTime);
  }
  sweepRedrawPosition();
}

function sweepUpdateAmpDisplay() {
  document.getElementById("sweep-amp-value").textContent = sweepState.amplitude;
}

function sweepUpdateDurationDisplay() {
  document.getElementById("sweep-duration-value").textContent = sweepState.duration;
}

/* ====== Test de rango auditivo ====== */
function renderHearingMarks() {
  const container = document.getElementById("hearing-test-marks");
  container.innerHTML = "";
  hearingMarks.forEach((freq, idx) => {
    const pill = document.createElement("div");
    pill.className = "hearing-mark-pill";
    const label = freq >= 1000 ? (freq / 1000).toFixed(2) + " kHz" : Math.round(freq) + " Hz";
    pill.innerHTML = `<span>${label}</span>`;
    const removeBtn = document.createElement("button");
    removeBtn.innerHTML = "&times;";
    removeBtn.setAttribute("aria-label", "remove");
    removeBtn.addEventListener("click", () => {
      hearingMarks.splice(idx, 1);
      renderHearingMarks();
    });
    pill.appendChild(removeBtn);
    container.appendChild(pill);
  });
}

/* ====== Listeners del módulo ====== */
function initNoiseControls() {
  // Tipo de ruido
  document.querySelectorAll("#noise-type-grid .wave-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#noise-type-grid .wave-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      noiseState.type = btn.dataset.noise;
      if (noiseIsPlaying) {
        // Recrea la fuente con el nuevo tipo de ruido
        noiseStopTone();
        noiseStartTone();
      }
    });
  });

  // Amplitud ruido (en vivo)
  const noiseAmpSlider = document.getElementById("noise-amp-slider");
  noiseAmpSlider.addEventListener("input", () => {
    noiseState.amplitude = parseFloat(noiseAmpSlider.value);
    noiseUpdateAmpDisplay();
    if (noiseGain) noiseGain.gain.setValueAtTime(noiseState.amplitude / 100, noiseAudioCtx.currentTime);
  });

  // Play/Stop ruido
  const noisePlayBtn = document.getElementById("noise-play-btn");
  noisePlayBtn.addEventListener("click", () => {
    if (!noiseIsPlaying) {
      noiseStartTone();
      noisePlayBtn.classList.add("playing");
      document.getElementById("noise-play-icon").innerHTML = "&#9632;";
      document.getElementById("noise-play-label").textContent = t("stop");
    } else {
      noiseStopTone();
      noisePlayBtn.classList.remove("playing");
      document.getElementById("noise-play-icon").innerHTML = "&#9658;";
      document.getElementById("noise-play-label").textContent = t("generate");
    }
  });

  // Modo de barrido
  document.querySelectorAll("#sweep-mode-grid .wave-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#sweep-mode-grid .wave-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      sweepState.mode = btn.dataset.sweepMode;
      document.getElementById("sweep-manual-row").hidden = sweepState.mode !== "manual";
      document.getElementById("sweep-duration-row").hidden = sweepState.mode !== "auto";
    });
  });

  // Frecuencia manual
  const sweepFreqSlider = document.getElementById("sweep-freq-slider");
  sweepFreqSlider.addEventListener("input", () => {
    sweepState.frequency = sliderToFreq(parseFloat(sweepFreqSlider.value));
    sweepUpdateFreqDisplay();
  });

  // Duracion del barrido automatico
  const sweepDurationSlider = document.getElementById("sweep-duration-slider");
  sweepDurationSlider.addEventListener("input", () => {
    sweepState.duration = parseFloat(sweepDurationSlider.value);
    sweepUpdateDurationDisplay();
  });

  // Amplitud sweep (en vivo)
  const sweepAmpSlider = document.getElementById("sweep-amp-slider");
  sweepAmpSlider.addEventListener("input", () => {
    sweepState.amplitude = parseFloat(sweepAmpSlider.value);
    sweepUpdateAmpDisplay();
    if (sweepGain) sweepGain.gain.setValueAtTime(sweepState.amplitude / 100, noiseAudioCtx.currentTime);
  });

  // Play/Stop sweep
  const sweepPlayBtn = document.getElementById("sweep-play-btn");
  sweepPlayBtn.addEventListener("click", () => {
    if (!sweepIsPlaying) {
      sweepStartTone();
      sweepPlayBtn.classList.add("playing");
      document.getElementById("sweep-play-icon").innerHTML = "&#9632;";
      document.getElementById("sweep-play-label").textContent = t("stop");
    } else {
      sweepStopTone();
      sweepPlayBtn.classList.remove("playing");
      document.getElementById("sweep-play-icon").innerHTML = "&#9658;";
      document.getElementById("sweep-play-label").textContent = t("generate");
    }
  });

  // Marcar limite audible
  document.getElementById("hearing-mark-btn").addEventListener("click", () => {
    const freq = Math.round(sweepCurrentFrequency());
    hearingMarks.push(freq);
    renderHearingMarks();
  });
}

/* ====== Init del módulo Ruido y barridos ====== */
function noiseInit() {
  initNoiseControls();

  noiseUpdateAmpDisplay();

  document.getElementById("sweep-freq-slider").value = Math.round(freqToSlider(440));
  sweepUpdateFreqDisplay();
  sweepUpdateAmpDisplay();
  sweepUpdateDurationDisplay();

  setTimeout(() => noiseClearCanvases(), 50);
}

document.addEventListener("DOMContentLoaded", noiseInit);

/* ====================================================== */
/* ====== MÓDULO: FILTROS =============================== */
/* ====================================================== */

let filterAudioCtx = null;
let filterSourceOsc = null;
let filterSourceNoise = null;
let filterGain = null;
let filterBiquad = null;
let filterAnalyserTime = null;
let filterAnalyserFreq = null;
let filterIsPlaying = false;
let filterRafId = null;

const filterState = {
  sourceType: "sawtooth", // "sawtooth" (tono) o "white" (ruido)
  toneFrequency: 220,
  amplitude: 30,
  filterType: "lowpass",
  cutoff: 1000,
  q: 1.0
};

function filterEnsureAudioContext() {
  if (!filterAudioCtx) {
    filterAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (filterAudioCtx.state === "suspended") {
    filterAudioCtx.resume();
  }
}

function filterStartTone() {
  filterEnsureAudioContext();

  filterGain = filterAudioCtx.createGain();
  filterBiquad = filterAudioCtx.createBiquadFilter();
  filterAnalyserTime = filterAudioCtx.createAnalyser();
  filterAnalyserFreq = filterAudioCtx.createAnalyser();

  filterAnalyserTime.fftSize = 2048;
  filterAnalyserFreq.fftSize = 2048;

  filterBiquad.type = filterState.filterType;
  filterBiquad.frequency.value = filterState.cutoff;
  filterBiquad.Q.value = filterState.q;

  filterGain.gain.value = filterState.amplitude / 100;

  if (filterState.sourceType === "white") {
    filterSourceNoise = filterAudioCtx.createBufferSource();
    filterSourceNoise.buffer = createFilterNoiseBuffer();
    filterSourceNoise.loop = true;
    filterSourceNoise.connect(filterBiquad);
    filterSourceNoise.start();
  } else {
    filterSourceOsc = filterAudioCtx.createOscillator();
    filterSourceOsc.type = "sawtooth";
    filterSourceOsc.frequency.value = filterState.toneFrequency;
    filterSourceOsc.connect(filterBiquad);
    filterSourceOsc.start();
  }

  filterBiquad.connect(filterGain);
  filterGain.connect(filterAnalyserTime);
  filterGain.connect(filterAnalyserFreq);
  filterGain.connect(filterAudioCtx.destination);

  filterIsPlaying = true;
  filterStartVisualLoop();
}

// createNoiseBuffer usa noiseAudioCtx; necesitamos una version que use filterAudioCtx
function createFilterNoiseBuffer() {
  const bufferSize = filterAudioCtx.sampleRate * 2;
  const buffer = filterAudioCtx.createBuffer(1, bufferSize, filterAudioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

function filterStopTone() {
  [filterSourceOsc, filterSourceNoise].forEach(node => {
    if (node) { try { node.stop(); } catch (e) {} node.disconnect(); }
  });
  filterSourceOsc = filterSourceNoise = null;
  if (filterBiquad) filterBiquad.disconnect();
  if (filterGain) filterGain.disconnect();
  filterBiquad = filterGain = null;

  filterIsPlaying = false;
  if (filterRafId) {
    cancelAnimationFrame(filterRafId);
    filterRafId = null;
  }
  filterClearCanvases();
}

function filterUpdateLiveParams() {
  if (filterBiquad) {
    filterBiquad.type = filterState.filterType;
    filterBiquad.frequency.setValueAtTime(filterState.cutoff, filterAudioCtx.currentTime);
    filterBiquad.Q.setValueAtTime(filterState.q, filterAudioCtx.currentTime);
  }
  if (filterSourceOsc) {
    filterSourceOsc.frequency.setValueAtTime(filterState.toneFrequency, filterAudioCtx.currentTime);
  }
  if (filterGain) {
    filterGain.gain.setValueAtTime(filterState.amplitude / 100, filterAudioCtx.currentTime);
  }
  filterRedrawResponseIfIdle();
}

/* ====== Visualización ====== */
function filterClearCanvases() {
  ["filter-oscilloscope", "filter-spectrum"].forEach(id => {
    const canvas = document.getElementById(id);
    const { ctx, width, height } = setupCanvas(canvas);
    ctx.clearRect(0, 0, width, height);
    drawGrid(ctx, width, height);
  });
  filterRedrawResponseIfIdle();
}

// Cuando no esta sonando, dibuja solo la curva de respuesta del filtro (sin FFT)
function filterRedrawResponseIfIdle() {
  if (filterIsPlaying) return;
  filterEnsureTempBiquad();
  const canvas = document.getElementById("filter-spectrum");
  const { ctx, width, height } = setupCanvas(canvas);
  ctx.clearRect(0, 0, width, height);
  drawGrid(ctx, width, height);
  drawFilterResponse(ctx, width, height, tempBiquadForResponse());
}

let tempFilterCtx = null;
let tempFilterBiquad = null;
function filterEnsureTempBiquad() {
  const ctx = filterAudioCtx || tempFilterCtx;
  if (tempFilterBiquad && tempFilterCtx === ctx) return;
  if (!ctx) {
    tempFilterCtx = new (window.AudioContext || window.webkitAudioContext)();
    tempFilterBiquad = tempFilterCtx.createBiquadFilter();
  } else {
    tempFilterCtx = ctx;
    tempFilterBiquad = ctx.createBiquadFilter();
  }
}
function tempBiquadForResponse() {
  tempFilterBiquad.type = filterState.filterType;
  tempFilterBiquad.frequency.value = filterState.cutoff;
  tempFilterBiquad.Q.value = filterState.q;
  return tempFilterBiquad;
}

function filterStartVisualLoop() {
  const oscCanvas = document.getElementById("filter-oscilloscope");
  const fftCanvas = document.getElementById("filter-spectrum");

  const oscSetup = setupCanvas(oscCanvas);
  const fftSetup = setupCanvas(fftCanvas);

  const timeData = new Uint8Array(filterAnalyserTime.fftSize);
  const freqData = new Uint8Array(filterAnalyserFreq.frequencyBinCount);

  function draw() {
    if (!filterIsPlaying) return;

    filterAnalyserTime.getByteTimeDomainData(timeData);
    drawOscilloscope(oscSetup.ctx, oscSetup.width, oscSetup.height, timeData);

    filterAnalyserFreq.getByteFrequencyData(freqData);
    drawSpectrum(fftSetup.ctx, fftSetup.width, fftSetup.height, freqData);
    drawFilterResponse(fftSetup.ctx, fftSetup.width, fftSetup.height, filterBiquad);

    filterRafId = requestAnimationFrame(draw);
  }

  draw();
}

// Dibuja la curva de respuesta en frecuencia del filtro biquad sobre el canvas FFT
function drawFilterResponse(ctx, width, height, biquadNode) {
  const numPoints = 200;
  const freqs = new Float32Array(numPoints);
  const mag = new Float32Array(numPoints);
  const phase = new Float32Array(numPoints);

  for (let i = 0; i < numPoints; i++) {
    // distribucion logaritmica 20Hz - 20kHz, igual que el eje del FFT (data.length bins lineales hasta sampleRate/2,
    // pero visualmente usamos la misma escala que drawSpectrum: bin index lineal => aqui aproximamos con escala log)
    const ratio = i / (numPoints - 1);
    freqs[i] = FREQ_MIN * Math.pow(FREQ_MAX / FREQ_MIN, ratio);
  }

  biquadNode.getFrequencyResponse(freqs, mag, phase);

  ctx.lineWidth = 2;
  ctx.strokeStyle = getCssVar("--wave-color");
  ctx.beginPath();

  for (let i = 0; i < numPoints; i++) {
    const x = (i / (numPoints - 1)) * width;
    // mag en dB, normalizado aproximadamente a 0..1 sobre un rango de -48..+12 dB
    const db = 20 * Math.log10(Math.max(mag[i], 0.0001));
    const norm = Math.max(0, Math.min(1, (db + 48) / 60));
    const y = height - norm * height;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

/* ====== UI: displays ====== */
function filterUpdateToneFreqDisplay() {
  const freq = filterState.toneFrequency;
  document.getElementById("filter-tone-freq-value").textContent =
    freq >= 1000 ? (freq / 1000).toFixed(2) + "k" : Math.round(freq);

  const note = freqToNote(freq);
  const solfege = NOTE_SOLFEGE[note.name] || "";
  document.getElementById("filter-tone-note").textContent = `${note.name}${note.octave} — ${solfege}`;
}

function filterUpdateAmpDisplay() {
  document.getElementById("filter-amp-value").textContent = filterState.amplitude;
}

function filterUpdateCutoffDisplay() {
  const freq = filterState.cutoff;
  document.getElementById("filter-cutoff-value").textContent =
    freq >= 1000 ? (freq / 1000).toFixed(2) + "k" : Math.round(freq);
}

function filterUpdateQDisplay() {
  document.getElementById("filter-q-value").textContent = filterState.q.toFixed(1);
}

/* ====== Listeners del módulo ====== */
function initFilterControls() {
  // Tipo de fuente
  document.querySelectorAll("#filter-source-grid .wave-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#filter-source-grid .wave-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      filterState.sourceType = btn.dataset.source;
      document.getElementById("filter-freq-row").hidden = filterState.sourceType !== "sawtooth";
      if (filterIsPlaying) {
        filterStopTone();
        filterStartTone();
        document.getElementById("filter-play-btn").classList.add("playing");
        document.getElementById("filter-play-icon").innerHTML = "&#9632;";
        document.getElementById("filter-play-label").textContent = t("stop");
      }
    });
  });

  // Frecuencia del tono
  const toneFreqSlider = document.getElementById("filter-tone-freq-slider");
  toneFreqSlider.addEventListener("input", () => {
    filterState.toneFrequency = sliderToFreq(parseFloat(toneFreqSlider.value));
    filterUpdateToneFreqDisplay();
    filterUpdateLiveParams();
  });

  // Amplitud
  const ampSlider = document.getElementById("filter-amp-slider");
  ampSlider.addEventListener("input", () => {
    filterState.amplitude = parseFloat(ampSlider.value);
    filterUpdateAmpDisplay();
    filterUpdateLiveParams();
  });

  // Tipo de filtro
  document.querySelectorAll("#filter-type-grid .wave-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#filter-type-grid .wave-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      filterState.filterType = btn.dataset.filter;
      filterUpdateLiveParams();
    });
  });

  // Frecuencia de corte
  const cutoffSlider = document.getElementById("filter-cutoff-slider");
  cutoffSlider.addEventListener("input", () => {
    filterState.cutoff = sliderToFreq(parseFloat(cutoffSlider.value));
    filterUpdateCutoffDisplay();
    filterUpdateLiveParams();
  });

  // Resonancia (Q): slider 1-200 -> 0.1-20.0
  const qSlider = document.getElementById("filter-q-slider");
  qSlider.addEventListener("input", () => {
    filterState.q = parseFloat(qSlider.value) / 10;
    filterUpdateQDisplay();
    filterUpdateLiveParams();
  });

  // Play/Stop
  const filterPlayBtn = document.getElementById("filter-play-btn");
  filterPlayBtn.addEventListener("click", () => {
    if (!filterIsPlaying) {
      filterStartTone();
      filterPlayBtn.classList.add("playing");
      document.getElementById("filter-play-icon").innerHTML = "&#9632;";
      document.getElementById("filter-play-label").textContent = t("stop");
    } else {
      filterStopTone();
      filterPlayBtn.classList.remove("playing");
      document.getElementById("filter-play-icon").innerHTML = "&#9658;";
      document.getElementById("filter-play-label").textContent = t("generate");
    }
  });
}

/* ====== Init del módulo Filtros ====== */
function filterInit() {
  initFilterControls();

  document.getElementById("filter-tone-freq-slider").value = Math.round(freqToSlider(220));
  filterUpdateToneFreqDisplay();
  filterUpdateAmpDisplay();

  document.getElementById("filter-cutoff-slider").value = Math.round(freqToSlider(1000));
  filterUpdateCutoffDisplay();
  filterUpdateQDisplay();

  setTimeout(() => filterClearCanvases(), 50);
}

document.addEventListener("DOMContentLoaded", filterInit);

/* ====================================================== */
/* ====== MÓDULO: MUESTREO Y CUANTIZACIÓN =============== */
/* ====================================================== */

let samplingAudioCtx = null;
let samplingOsc = null;
let samplingGain = null;
let samplingProcessor = null;
let samplingAnalyserOriginal = null;
let samplingAnalyserProcessed = null;
let samplingAnalyserFreq = null;
let samplingIsPlaying = false;
let samplingRafId = null;

const samplingState = {
  frequency: 440,
  amplitude: 40,
  sampleRate: 8000,
  bitDepth: 8
};

function samplingEnsureAudioContext() {
  if (!samplingAudioCtx) {
    samplingAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (samplingAudioCtx.state === "suspended") {
    samplingAudioCtx.resume();
  }
}

function samplingStartTone() {
  samplingEnsureAudioContext();

  samplingOsc = samplingAudioCtx.createOscillator();
  samplingGain = samplingAudioCtx.createGain();
  samplingAnalyserOriginal = samplingAudioCtx.createAnalyser();
  samplingAnalyserProcessed = samplingAudioCtx.createAnalyser();
  samplingAnalyserFreq = samplingAudioCtx.createAnalyser();

  samplingAnalyserOriginal.fftSize = 2048;
  samplingAnalyserProcessed.fftSize = 2048;
  samplingAnalyserFreq.fftSize = 2048;

  samplingOsc.type = "sine";
  samplingOsc.frequency.value = samplingState.frequency;
  samplingGain.gain.value = samplingState.amplitude / 100;

  // ScriptProcessor: aplica sample-and-hold (downsample) y cuantizacion
  const bufferSize = 1024;
  samplingProcessor = samplingAudioCtx.createScriptProcessor(bufferSize, 1, 1);
  let holdValue = 0;
  let holdCounter = 0;

  samplingProcessor.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    const output = e.outputBuffer.getChannelData(0);
    const ctxRate = samplingAudioCtx.sampleRate;
    const targetRate = samplingState.sampleRate;
    const holdSamples = Math.max(1, Math.round(ctxRate / targetRate));
    const levels = Math.pow(2, samplingState.bitDepth);

    for (let i = 0; i < input.length; i++) {
      if (holdCounter <= 0) {
        // Cuantizacion: redondea al nivel mas cercano de 'levels' pasos entre -1 y 1
        const quantized = Math.round(input[i] * (levels / 2)) / (levels / 2);
        holdValue = Math.max(-1, Math.min(1, quantized));
        holdCounter = holdSamples;
      }
      output[i] = holdValue;
      holdCounter--;
    }
  };

  samplingOsc.connect(samplingAnalyserOriginal);
  samplingOsc.connect(samplingProcessor);
  samplingProcessor.connect(samplingGain);
  samplingGain.connect(samplingAnalyserProcessed);
  samplingGain.connect(samplingAnalyserFreq);
  samplingGain.connect(samplingAudioCtx.destination);

  samplingOsc.start();
  samplingIsPlaying = true;
  samplingStartVisualLoop();
}

function samplingStopTone() {
  if (samplingOsc) {
    try { samplingOsc.stop(); } catch (e) {}
    samplingOsc.disconnect();
  }
  if (samplingProcessor) {
    samplingProcessor.onaudioprocess = null;
    samplingProcessor.disconnect();
  }
  if (samplingGain) samplingGain.disconnect();
  samplingOsc = samplingProcessor = samplingGain = null;

  samplingIsPlaying = false;
  if (samplingRafId) {
    cancelAnimationFrame(samplingRafId);
    samplingRafId = null;
  }
  samplingClearCanvases();
}

function samplingUpdateLiveParams() {
  if (samplingOsc) {
    samplingOsc.frequency.setValueAtTime(samplingState.frequency, samplingAudioCtx.currentTime);
  }
  if (samplingGain) {
    samplingGain.gain.setValueAtTime(samplingState.amplitude / 100, samplingAudioCtx.currentTime);
  }
}

/* ====== Visualización ====== */
function samplingClearCanvases() {
  ["sampling-oscilloscope", "sampling-spectrum"].forEach(id => {
    const canvas = document.getElementById(id);
    const { ctx, width, height } = setupCanvas(canvas);
    ctx.clearRect(0, 0, width, height);
    drawGrid(ctx, width, height);
  });
}

function samplingStartVisualLoop() {
  const oscCanvas = document.getElementById("sampling-oscilloscope");
  const fftCanvas = document.getElementById("sampling-spectrum");

  const oscSetup = setupCanvas(oscCanvas);
  const fftSetup = setupCanvas(fftCanvas);

  const dataOriginal = new Uint8Array(samplingAnalyserOriginal.fftSize);
  const dataProcessed = new Uint8Array(samplingAnalyserProcessed.fftSize);
  const freqData = new Uint8Array(samplingAnalyserFreq.frequencyBinCount);

  function draw() {
    if (!samplingIsPlaying) return;

    samplingAnalyserOriginal.getByteTimeDomainData(dataOriginal);
    samplingAnalyserProcessed.getByteTimeDomainData(dataProcessed);
    drawSamplingOscilloscope(oscSetup.ctx, oscSetup.width, oscSetup.height, dataOriginal, dataProcessed);

    samplingAnalyserFreq.getByteFrequencyData(freqData);
    drawSpectrum(fftSetup.ctx, fftSetup.width, fftSetup.height, freqData);

    samplingRafId = requestAnimationFrame(draw);
  }

  draw();
}

function drawSamplingOscilloscope(ctx, width, height, dataOriginal, dataProcessed) {
  ctx.clearRect(0, 0, width, height);
  drawGrid(ctx, width, height);

  dualDrawTrace(ctx, width, height, dataOriginal, getCssVar("--wave-color"));
  dualDrawTrace(ctx, width, height, dataProcessed, getCssVar("--accent2"));
}

/* ====== UI: displays ====== */
function samplingUpdateFreqDisplay() {
  const freq = samplingState.frequency;
  document.getElementById("sampling-freq-value").textContent =
    freq >= 1000 ? (freq / 1000).toFixed(2) + "k" : Math.round(freq);

  const note = freqToNote(freq);
  const solfege = NOTE_SOLFEGE[note.name] || "";
  document.getElementById("sampling-note").textContent = `${note.name}${note.octave} — ${solfege}`;
}

function samplingUpdateAmpDisplay() {
  document.getElementById("sampling-amp-value").textContent = samplingState.amplitude;
}

function samplingUpdateSampleRateDisplay() {
  document.getElementById("sample-rate-value").textContent = samplingState.sampleRate;
  samplingUpdateNyquistHint();
}

function samplingUpdateBitDepthDisplay() {
  const bits = samplingState.bitDepth;
  document.getElementById("bit-depth-value").textContent = bits;
  const levels = Math.pow(2, bits);
  document.getElementById("bit-depth-levels").textContent = `${levels} ${t("levels_suffix")}`;
}

function samplingUpdateNyquistHint() {
  const nyquist = samplingState.sampleRate / 2;
  const template = t("nyquist_hint");
  document.getElementById("nyquist-hint").textContent = template.replace("{freq}", nyquist);
}

/* ====== Listeners del módulo ====== */
function initSamplingControls() {
  // Frecuencia
  const freqSlider = document.getElementById("sampling-freq-slider");
  freqSlider.addEventListener("input", () => {
    samplingState.frequency = sliderToFreq(parseFloat(freqSlider.value));
    samplingUpdateFreqDisplay();
    samplingUpdateLiveParams();
  });

  // Amplitud
  const ampSlider = document.getElementById("sampling-amp-slider");
  ampSlider.addEventListener("input", () => {
    samplingState.amplitude = parseFloat(ampSlider.value);
    samplingUpdateAmpDisplay();
    samplingUpdateLiveParams();
  });

  // Frecuencia de muestreo (en vivo, leida directamente del processor)
  const sampleRateSlider = document.getElementById("sample-rate-slider");
  sampleRateSlider.addEventListener("input", () => {
    samplingState.sampleRate = parseFloat(sampleRateSlider.value);
    samplingUpdateSampleRateDisplay();
  });

  // Profundidad de bits (en vivo)
  const bitDepthSlider = document.getElementById("bit-depth-slider");
  bitDepthSlider.addEventListener("input", () => {
    samplingState.bitDepth = parseFloat(bitDepthSlider.value);
    samplingUpdateBitDepthDisplay();
  });

  // Play/Stop
  const samplingPlayBtn = document.getElementById("sampling-play-btn");
  samplingPlayBtn.addEventListener("click", () => {
    if (!samplingIsPlaying) {
      samplingStartTone();
      samplingPlayBtn.classList.add("playing");
      document.getElementById("sampling-play-icon").innerHTML = "&#9632;";
      document.getElementById("sampling-play-label").textContent = t("stop");
    } else {
      samplingStopTone();
      samplingPlayBtn.classList.remove("playing");
      document.getElementById("sampling-play-icon").innerHTML = "&#9658;";
      document.getElementById("sampling-play-label").textContent = t("generate");
    }
  });
}

/* ====== Init del módulo Muestreo ====== */
function samplingInit() {
  initSamplingControls();

  document.getElementById("sampling-freq-slider").value = Math.round(freqToSlider(440));
  samplingUpdateFreqDisplay();
  samplingUpdateAmpDisplay();
  samplingUpdateSampleRateDisplay();
  samplingUpdateBitDepthDisplay();

  setTimeout(() => samplingClearCanvases(), 50);
}

document.addEventListener("DOMContentLoaded", samplingInit);

/* ====================================================== */
/* ====== MÓDULO: ESTÉREO (pan / Haas) ================== */
/* ====================================================== */

let stereoAudioCtx = null;
let stereoOsc = null;
let stereoGain = null;
let stereoPanner = null;
let stereoSplitter = null;
let stereoMerger = null;
let stereoDelayL = null;
let stereoDelayR = null;
let stereoAnalyserL = null;
let stereoAnalyserR = null;
let stereoIsPlaying = false;
let stereoRafId = null;

const stereoState = {
  waveform: "sine",
  frequency: 440,
  amplitude: 40,
  pan: 0,
  delay: 0,           // ms
  delayChannel: "right" // canal al que se aplica el retardo (Haas)
};

function stereoEnsureAudioContext() {
  if (!stereoAudioCtx) {
    stereoAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (stereoAudioCtx.state === "suspended") {
    stereoAudioCtx.resume();
  }
}

function stereoStartTone() {
  stereoEnsureAudioContext();

  stereoOsc = stereoAudioCtx.createOscillator();
  stereoGain = stereoAudioCtx.createGain();
  stereoPanner = stereoAudioCtx.createStereoPanner();
  stereoSplitter = stereoAudioCtx.createChannelSplitter(2);
  stereoMerger = stereoAudioCtx.createChannelMerger(2);
  stereoDelayL = stereoAudioCtx.createDelay(0.05);
  stereoDelayR = stereoAudioCtx.createDelay(0.05);
  stereoAnalyserL = stereoAudioCtx.createAnalyser();
  stereoAnalyserR = stereoAudioCtx.createAnalyser();

  stereoAnalyserL.fftSize = 2048;
  stereoAnalyserR.fftSize = 2048;

  stereoOsc.type = stereoState.waveform;
  stereoOsc.frequency.value = stereoState.frequency;
  stereoGain.gain.value = stereoState.amplitude / 100;
  stereoPanner.pan.value = stereoState.pan / 100;

  const delaySec = stereoState.delay / 1000;
  stereoDelayL.delayTime.value = stereoState.delayChannel === "left" ? delaySec : 0;
  stereoDelayR.delayTime.value = stereoState.delayChannel === "right" ? delaySec : 0;

  // osc -> gain -> panner -> splitter -> [delayL/delayR] -> merger -> destino
  // y tambien -> analysers L/R para visualizacion independiente de cada canal
  stereoOsc.connect(stereoGain);
  stereoGain.connect(stereoPanner);
  stereoPanner.connect(stereoSplitter);

  stereoSplitter.connect(stereoDelayL, 0);
  stereoSplitter.connect(stereoDelayR, 1);

  stereoDelayL.connect(stereoMerger, 0, 0);
  stereoDelayR.connect(stereoMerger, 0, 1);

  stereoDelayL.connect(stereoAnalyserL);
  stereoDelayR.connect(stereoAnalyserR);

  stereoMerger.connect(stereoAudioCtx.destination);

  stereoOsc.start();
  stereoIsPlaying = true;
  stereoStartVisualLoop();
}

function stereoStopTone() {
  if (stereoOsc) {
    try { stereoOsc.stop(); } catch (e) {}
    stereoOsc.disconnect();
  }
  [stereoGain, stereoPanner, stereoSplitter, stereoMerger, stereoDelayL, stereoDelayR].forEach(n => {
    if (n) try { n.disconnect(); } catch (e) {}
  });
  stereoOsc = stereoGain = stereoPanner = stereoSplitter = stereoMerger = stereoDelayL = stereoDelayR = null;

  stereoIsPlaying = false;
  if (stereoRafId) {
    cancelAnimationFrame(stereoRafId);
    stereoRafId = null;
  }
  stereoClearCanvases();
}

function stereoUpdateLiveParams() {
  if (stereoOsc) {
    stereoOsc.type = stereoState.waveform;
    stereoOsc.frequency.setValueAtTime(stereoState.frequency, stereoAudioCtx.currentTime);
  }
  if (stereoGain) {
    stereoGain.gain.setValueAtTime(stereoState.amplitude / 100, stereoAudioCtx.currentTime);
  }
  if (stereoPanner) {
    stereoPanner.pan.setValueAtTime(stereoState.pan / 100, stereoAudioCtx.currentTime);
  }
  if (stereoDelayL && stereoDelayR) {
    const delaySec = stereoState.delay / 1000;
    stereoDelayL.delayTime.setValueAtTime(stereoState.delayChannel === "left" ? delaySec : 0, stereoAudioCtx.currentTime);
    stereoDelayR.delayTime.setValueAtTime(stereoState.delayChannel === "right" ? delaySec : 0, stereoAudioCtx.currentTime);
  }
}

/* ====== Visualización ====== */
function stereoClearCanvases() {
  ["stereo-oscilloscope", "stereo-balance"].forEach(id => {
    const canvas = document.getElementById(id);
    const { ctx, width, height } = setupCanvas(canvas);
    ctx.clearRect(0, 0, width, height);
    if (id === "stereo-oscilloscope") drawGrid(ctx, width, height);
  });
  stereoRedrawBalance(0);
}

function stereoStartVisualLoop() {
  const oscCanvas = document.getElementById("stereo-oscilloscope");
  const balanceCanvas = document.getElementById("stereo-balance");

  const oscSetup = setupCanvas(oscCanvas);
  const balanceSetup = setupCanvas(balanceCanvas);

  const dataL = new Uint8Array(stereoAnalyserL.fftSize);
  const dataR = new Uint8Array(stereoAnalyserR.fftSize);
  const meterL = new Float32Array(stereoAnalyserL.fftSize);
  const meterR = new Float32Array(stereoAnalyserR.fftSize);

  function draw() {
    if (!stereoIsPlaying) return;

    stereoAnalyserL.getByteTimeDomainData(dataL);
    stereoAnalyserR.getByteTimeDomainData(dataR);
    drawStereoOscilloscope(oscSetup.ctx, oscSetup.width, oscSetup.height, dataL, dataR);

    stereoAnalyserL.getFloatTimeDomainData(meterL);
    stereoAnalyserR.getFloatTimeDomainData(meterR);
    const rmsL = stereoRms(meterL);
    const rmsR = stereoRms(meterR);
    const balance = (rmsR - rmsL) / Math.max(rmsL + rmsR, 0.0001); // -1 (L) .. +1 (R)
    stereoRedrawBalance(balance, balanceSetup);

    stereoRafId = requestAnimationFrame(draw);
  }

  draw();
}

function stereoRms(data) {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / data.length);
}

function drawStereoOscilloscope(ctx, width, height, dataL, dataR) {
  ctx.clearRect(0, 0, width, height);
  drawGrid(ctx, width, height);

  dualDrawTrace(ctx, width, height, dataL, getCssVar("--wave-color"));
  dualDrawTrace(ctx, width, height, dataR, getCssVar("--accent2"));
}

// Barra horizontal con marcador de balance: centro = 0, izquierda = -1, derecha = +1
function stereoRedrawBalance(balance, setup) {
  const canvas = document.getElementById("stereo-balance");
  const { ctx, width, height } = setup || setupCanvas(canvas);
  ctx.clearRect(0, 0, width, height);

  // pista de fondo
  ctx.fillStyle = getCssVar("--track-bg");
  ctx.fillRect(0, height / 2 - 2, width, 4);

  // marca central
  ctx.fillStyle = getCssVar("--grid-line");
  ctx.fillRect(width / 2 - 1, height / 2 - 8, 2, 16);

  const clamped = Math.max(-1, Math.min(1, balance));
  const x = (width / 2) + (clamped * width / 2);

  ctx.fillStyle = getCssVar("--wave-color");
  ctx.beginPath();
  ctx.arc(x, height / 2, 8, 0, Math.PI * 2);
  ctx.fill();
}

/* ====== UI: displays ====== */
function stereoUpdateFreqDisplay() {
  const freq = stereoState.frequency;
  document.getElementById("stereo-freq-value").textContent =
    freq >= 1000 ? (freq / 1000).toFixed(2) + "k" : Math.round(freq);

  const note = freqToNote(freq);
  const solfege = NOTE_SOLFEGE[note.name] || "";
  document.getElementById("stereo-note").textContent = `${note.name}${note.octave} — ${solfege}`;
}

function stereoUpdateAmpDisplay() {
  document.getElementById("stereo-amp-value").textContent = stereoState.amplitude;
}

function stereoUpdatePanDisplay() {
  document.getElementById("stereo-pan-value").textContent = stereoState.pan;
}

function stereoUpdateDelayDisplay() {
  document.getElementById("stereo-delay-value").textContent = stereoState.delay;
}

/* ====== Listeners del módulo ====== */
function initStereoControls() {
  // Forma de onda
  document.querySelectorAll("#stereo-waveform-grid .wave-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#stereo-waveform-grid .wave-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      stereoState.waveform = btn.dataset.wave;
      stereoUpdateLiveParams();
    });
  });

  // Frecuencia
  const freqSlider = document.getElementById("stereo-freq-slider");
  freqSlider.addEventListener("input", () => {
    stereoState.frequency = sliderToFreq(parseFloat(freqSlider.value));
    stereoUpdateFreqDisplay();
    stereoUpdateLiveParams();
  });

  // Amplitud
  const ampSlider = document.getElementById("stereo-amp-slider");
  ampSlider.addEventListener("input", () => {
    stereoState.amplitude = parseFloat(ampSlider.value);
    stereoUpdateAmpDisplay();
    stereoUpdateLiveParams();
  });

  // Pan (con snap-to-zero magnetico, igual que el Generador)
  const panSlider = document.getElementById("stereo-pan-slider");
  const PAN_SNAP_THRESHOLD = 4;
  panSlider.addEventListener("input", () => {
    let value = parseFloat(panSlider.value);
    if (Math.abs(value) <= PAN_SNAP_THRESHOLD) {
      value = 0;
      panSlider.value = "0";
    }
    stereoState.pan = value;
    stereoUpdatePanDisplay();
    stereoUpdateLiveParams();
  });

  // Retardo Haas
  const delaySlider = document.getElementById("stereo-delay-slider");
  delaySlider.addEventListener("input", () => {
    stereoState.delay = parseFloat(delaySlider.value);
    stereoUpdateDelayDisplay();
    stereoUpdateLiveParams();
  });

  // Canal retardado
  document.querySelectorAll("#stereo-delay-channel-grid .wave-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#stereo-delay-channel-grid .wave-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      stereoState.delayChannel = btn.dataset.channel;
      stereoUpdateLiveParams();
    });
  });

  // Play/Stop
  const stereoPlayBtn = document.getElementById("stereo-play-btn");
  stereoPlayBtn.addEventListener("click", () => {
    if (!stereoIsPlaying) {
      stereoStartTone();
      stereoPlayBtn.classList.add("playing");
      document.getElementById("stereo-play-icon").innerHTML = "&#9632;";
      document.getElementById("stereo-play-label").textContent = t("stop");
    } else {
      stereoStopTone();
      stereoPlayBtn.classList.remove("playing");
      document.getElementById("stereo-play-icon").innerHTML = "&#9658;";
      document.getElementById("stereo-play-label").textContent = t("generate");
    }
  });
}

/* ====== Init del módulo Estéreo ====== */
function stereoInit() {
  initStereoControls();

  document.getElementById("stereo-freq-slider").value = Math.round(freqToSlider(440));
  stereoUpdateFreqDisplay();
  stereoUpdateAmpDisplay();
  stereoUpdatePanDisplay();
  stereoUpdateDelayDisplay();

  setTimeout(() => stereoClearCanvases(), 50);
}

document.addEventListener("DOMContentLoaded", stereoInit);
