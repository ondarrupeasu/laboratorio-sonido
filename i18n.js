const I18N = {
  es: {
    app_title: "Laboratorio de Sonido",
    tab_generator: "Generador",
    tab_modulation: "Modulación",
    tab_dual: "Dos osciladores",
    tab_noise: "Ruido y barridos",
    tab_filters: "Filtros",
    tab_sampling: "Muestreo",
    tab_stereo: "Estéreo",
    generate: "Generar tono",
    stop: "Detener",
    section_oscillator: "Oscilador",
    waveform: "Forma de onda",
    wave_sine: "Senoidal",
    wave_square: "Cuadrada",
    wave_triangle: "Triangular",
    wave_sawtooth: "Sierra",
    frequency: "Frecuencia",
    amplitude: "Amplitud",
    phase: "Fase",
    pan: "Paneo (L-R)",
    octave: "Octava",
    oscilloscope: "Osciloscopio (dominio del tiempo)",
    cycle_view: "Forma de onda ideal (1 periodo)",
    spectrum: "Analizador de espectro (FFT)",
    meter: "Medidor de nivel",
    footer_text: "Laboratorio de Sonido — CIFP Tartanga LHII",
    pan_left: "Izq",
    pan_center: "Centro",
    pan_right: "Der",
    oscillator_a: "Oscilador A",
    oscillator_b: "Oscilador B",
    beat_preset: "Preajuste de batido (440 / 444 Hz)",
    beat_frequency: "Frecuencia de batido",
    combined_oscilloscope: "Osciloscopio combinado"
  },
  eu: {
    app_title: "Soinu Laborategia",
    tab_generator: "Sortzailea",
    tab_modulation: "Modulazioa",
    tab_dual: "Bi osziladore",
    tab_noise: "Zarata eta barridak",
    tab_filters: "Iragazkiak",
    tab_sampling: "Muestraketa",
    tab_stereo: "Estereoa",
    generate: "Tonua sortu",
    stop: "Gelditu",
    section_oscillator: "Osziladorea",
    waveform: "Uhin forma",
    wave_sine: "Sinusoidala",
    wave_square: "Karratua",
    wave_triangle: "Triangeluarra",
    wave_sawtooth: "Zerra",
    frequency: "Maiztasuna",
    amplitude: "Anplitudea",
    phase: "Fasea",
    pan: "Panoramikoa (Ezk-Esk)",
    octave: "Zortzidura",
    oscilloscope: "Osziloskopioa (denbora domeinua)",
    cycle_view: "Uhin forma ideala (periodo 1)",
    spectrum: "Espektro analizatzailea (FFT)",
    meter: "Maila neurgailua",
    footer_text: "Soinu Laborategia — CIFP Tartanga LHII",
    pan_left: "Ezk",
    pan_center: "Erdian",
    pan_right: "Esk",
    oscillator_a: "A osziladorea",
    oscillator_b: "B osziladorea",
    beat_preset: "Taupada aurrezarpena (440 / 444 Hz)",
    beat_frequency: "Taupada maiztasuna",
    combined_oscilloscope: "Osziloskopio konbinatua"
  },
  en: {
    app_title: "Sound Lab",
    tab_generator: "Generator",
    tab_modulation: "Modulation",
    tab_dual: "Two oscillators",
    tab_noise: "Noise & sweeps",
    tab_filters: "Filters",
    tab_sampling: "Sampling",
    tab_stereo: "Stereo",
    generate: "Generate tone",
    stop: "Stop",
    section_oscillator: "Oscillator",
    waveform: "Waveform",
    wave_sine: "Sine",
    wave_square: "Square",
    wave_triangle: "Triangle",
    wave_sawtooth: "Sawtooth",
    frequency: "Frequency",
    amplitude: "Amplitude",
    phase: "Phase",
    pan: "Pan (L-R)",
    octave: "Octave",
    oscilloscope: "Oscilloscope (time domain)",
    cycle_view: "Ideal waveform (1 period)",
    spectrum: "Spectrum analyzer (FFT)",
    meter: "Level meter",
    footer_text: "Sound Lab — CIFP Tartanga LHII",
    pan_left: "L",
    pan_center: "Center",
    pan_right: "R",
    oscillator_a: "Oscillator A",
    oscillator_b: "Oscillator B",
    beat_preset: "Beating preset (440 / 444 Hz)",
    beat_frequency: "Beat frequency",
    combined_oscilloscope: "Combined oscilloscope"
  }
};

let currentLang = "es";

function applyTranslations(lang) {
  currentLang = lang;
  const dict = I18N[lang];
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.getAttribute("data-i18n");
    if (dict[key]) el.textContent = dict[key];
  });
  const titleEl = document.getElementById("app-title");
  if (titleEl && dict.app_title) titleEl.textContent = dict.app_title;
  document.title = dict.app_title || document.title;
  document.documentElement.lang = lang;
}

function t(key) {
  return (I18N[currentLang] && I18N[currentLang][key]) || I18N.es[key] || key;
}
