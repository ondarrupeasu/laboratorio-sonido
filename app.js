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

      if (target === "dual") {
        setTimeout(() => dualClearCanvases(), 50);
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
