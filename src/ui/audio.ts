/**
 * Som do jogo, 100% sintetizado com WebAudio (sem arquivos de áudio; funciona offline).
 *  - Mixador: efeitos, música e ambiente em barramentos com volume próprio, reverberação
 *    compartilhada (resposta ao impulso gerada) e compressor no final.
 *  - Efeitos (`play`): ~30 sons curtos; `delay` sincroniza com as animações.
 *  - Trilha generativa (`setMusicContext`): composta em tempo real a partir do clima
 *    (menu, paz, guerra, triunfo) e da era — modo, andamento, instrumentos e progressões
 *    mudam; frases com repetição e variação (AABA), respiros a cada seção.
 *  - Ambiente: vento suave e pássaros ocasionais em tempo de paz.
 * O contexto só é criado após um gesto do usuário (regras de autoplay dos navegadores).
 */

export type Sfx =
  | 'click'
  | 'select'
  | 'selectMil'
  | 'move'
  | 'march'
  | 'hooves'
  | 'oars'
  | 'endTurn'
  | 'turnStart'
  | 'city'
  | 'grow'
  | 'built'
  | 'wonder'
  | 'tech'
  | 'civic'
  | 'boost'
  | 'combat'
  | 'clash'
  | 'bow'
  | 'boom'
  | 'death'
  | 'war'
  | 'peace'
  | 'contact'
  | 'era'
  | 'gold'
  | 'promote'
  | 'victory'
  | 'defeat'
  | 'error'
  | 'notify'
  | 'page';

export type Mood = 'menu' | 'peace' | 'war' | 'triumph';

let ctx: AudioContext | null = null;
let master: GainNode;
let sfxBus: GainNode;
let musicBus: GainNode;
let ambBus: GainNode;
let reverb: ConvolverNode;
let sfxOn = true;
let musicOn = true;
let sfxVol = 0.8;
let musicVol = 0.5;
let noiseBuf: AudioBuffer;

export function setSoundEnabled(on: boolean): void {
  sfxOn = on;
  applyVolumes();
}

export function setMusicEnabled(on: boolean): void {
  musicOn = on;
  applyVolumes();
  if (on) startMusic();
}

export function setVolumes(sfx: number, music: number): void {
  sfxVol = Math.max(0, Math.min(1, sfx));
  musicVol = Math.max(0, Math.min(1, music));
  applyVolumes();
}

function applyVolumes(): void {
  if (!ctx) return;
  const t = ctx.currentTime;
  sfxBus.gain.setTargetAtTime(sfxOn ? sfxVol : 0, t, 0.05);
  musicBus.gain.setTargetAtTime(musicOn ? musicVol * 0.55 : 0, t, 0.4);
  ambBus.gain.setTargetAtTime(musicOn ? musicVol * 0.5 : 0, t, 0.4);
}

/** Resposta ao impulso de uma sala média (ruído com decaimento, estéreo). */
function impulse(seconds: number, decay: number): AudioBuffer {
  const c = ctx!;
  const len = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

export function unlockAudio(): void {
  if (ctx) {
    if (ctx.state === 'suspended') void ctx.resume();
    return;
  }
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
  } catch {
    ctx = null;
    return;
  }
  const c = ctx;
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 3;
  master = c.createGain();
  master.gain.value = 0.9;
  master.connect(comp).connect(c.destination);
  sfxBus = c.createGain();
  musicBus = c.createGain();
  ambBus = c.createGain();
  sfxBus.connect(master);
  musicBus.connect(master);
  ambBus.connect(master);
  reverb = c.createConvolver();
  reverb.buffer = impulse(2.6, 3);
  const ret = c.createGain();
  ret.gain.value = 0.5;
  reverb.connect(ret).connect(master);
  noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  sfxBus.gain.value = 0;
  musicBus.gain.value = 0;
  ambBus.gain.value = 0;
  applyVolumes();
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) void ctx.suspend();
    else void ctx.resume();
  });
  startMusic();
}

// ------------------------------------------------------------------ blocos de síntese

const midi = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** Envelope ADSR simples num ganho. */
function env(g: GainNode, t: number, a: number, peak: number, d: number, s: number, rel: number, dur: number): void {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * s), t + a + d);
  g.gain.setValueAtTime(Math.max(0.0001, peak * s), t + Math.max(a + d, dur));
  g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(a + d, dur) + rel);
}

function out(node: AudioNode, bus: GainNode, wet = 0.2): void {
  node.connect(bus);
  if (wet > 0) {
    const w = ctx!.createGain();
    w.gain.value = wet;
    node.connect(w).connect(reverb);
  }
}

function osc(type: OscillatorType, freq: number, t: number, stop: number, detune = 0): OscillatorNode {
  const o = ctx!.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.detune.value = detune;
  o.start(t);
  o.stop(stop);
  return o;
}

function noiseSrc(t: number, dur: number): AudioBufferSourceNode {
  const s = ctx!.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = true;
  s.start(t, Math.random() * 1.5);
  s.stop(t + dur);
  return s;
}

function filter(type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
  const f = ctx!.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

// instrumentos ----------------------------------------------------------------

/** Pad de cordas: duas serras desafinadas, filtro passa-baixa que abre devagar. */
function pad(freq: number, t: number, dur: number, vel: number, bus: GainNode, bright = 1100): void {
  const g = ctx!.createGain();
  const f = filter('lowpass', bright * 0.5, 0.4);
  f.frequency.setValueAtTime(bright * 0.45, t);
  f.frequency.linearRampToValueAtTime(bright, t + dur * 0.5);
  for (const d of [-7, 7]) osc('sawtooth', freq, t, t + dur + 3, d).connect(f);
  f.connect(g);
  env(g, t, 1.2, vel * 0.05, 0.6, 0.85, 2.2, dur);
  out(g, bus, 0.45);
}

/** Corda dedilhada (harpa/lira): triângulo + seno oitava acima, ataque rápido e decaimento. */
function pluck(freq: number, t: number, vel: number, bus: GainNode, decay = 1.6, bright = 2600): void {
  const g = ctx!.createGain();
  const f = filter('lowpass', bright, 0.6);
  f.frequency.setValueAtTime(bright, t);
  f.frequency.exponentialRampToValueAtTime(bright * 0.3, t + decay);
  osc('triangle', freq, t, t + decay + 0.1).connect(f);
  const o2 = osc('sine', freq * 2, t, t + decay + 0.1);
  const g2 = ctx!.createGain();
  g2.gain.value = 0.35;
  o2.connect(g2).connect(f);
  f.connect(g);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vel * 0.13, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  out(g, bus, 0.3);
}

/** Sino/campana: parciais inarmônicos com decaimento longo. */
function bell(freq: number, t: number, vel: number, bus: GainNode): void {
  for (const [m, a, dec] of [
    [1, 1, 2.6],
    [2.76, 0.4, 1.6],
    [5.4, 0.2, 0.9],
  ] as const) {
    const g = ctx!.createGain();
    osc('sine', freq * m, t, t + dec + 0.1).connect(g);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel * 0.09 * a, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
    out(g, bus, 0.35);
  }
}

/** Flauta: seno + triângulo com vibrato e sopro. */
function flute(freq: number, t: number, dur: number, vel: number, bus: GainNode): void {
  const g = ctx!.createGain();
  const o = osc('sine', freq, t, t + dur + 0.4);
  const o2 = osc('triangle', freq, t, t + dur + 0.4);
  const lfo = osc('sine', 5.2, t, t + dur + 0.4);
  const depth = ctx!.createGain();
  depth.gain.setValueAtTime(0, t);
  depth.gain.linearRampToValueAtTime(freq * 0.006, t + 0.35);
  lfo.connect(depth);
  depth.connect(o.frequency);
  depth.connect(o2.frequency);
  const mixT = ctx!.createGain();
  mixT.gain.value = 0.25;
  o.connect(g);
  o2.connect(mixT).connect(g);
  const breath = noiseSrc(t, dur + 0.4);
  const bf = filter('bandpass', freq * 2, 2);
  const bg = ctx!.createGain();
  bg.gain.value = 0.04;
  breath.connect(bf).connect(bg).connect(g);
  env(g, t, 0.08, vel * 0.09, 0.2, 0.8, 0.35, dur);
  out(g, bus, 0.4);
}

/** Metal (trompa): serra com filtro que abre no ataque. */
function brass(freq: number, t: number, dur: number, vel: number, bus: GainNode): void {
  const g = ctx!.createGain();
  const f = filter('lowpass', 400, 1.2);
  f.frequency.setValueAtTime(300, t);
  f.frequency.linearRampToValueAtTime(1800, t + 0.12);
  f.frequency.exponentialRampToValueAtTime(900, t + dur);
  osc('sawtooth', freq, t, t + dur + 0.5, -4).connect(f);
  osc('sawtooth', freq, t, t + dur + 0.5, 5).connect(f);
  f.connect(g);
  env(g, t, 0.06, vel * 0.07, 0.2, 0.75, 0.3, dur);
  out(g, bus, 0.3);
}

/** Baixo/zumbido. */
function drone(freq: number, t: number, dur: number, vel: number, bus: GainNode): void {
  const g = ctx!.createGain();
  const f = filter('lowpass', 500, 0.5);
  osc('triangle', freq, t, t + dur + 2).connect(f);
  osc('sine', freq / 2, t, t + dur + 2).connect(f);
  f.connect(g);
  env(g, t, 1.5, vel * 0.08, 0.5, 0.9, 1.8, dur);
  out(g, bus, 0.2);
}

/** Tambores: moldura (frame), taiko (grave) e chocalho. */
function drum(kind: 'frame' | 'taiko' | 'shaker' | 'tom', t: number, vel: number, bus: GainNode): void {
  const c = ctx!;
  if (kind === 'shaker') {
    const g = c.createGain();
    noiseSrc(t, 0.12).connect(filter('highpass', 5000)).connect(g);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel * 0.05, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    out(g, bus, 0.1);
    return;
  }
  const [f0, f1, dec, nAmt] = kind === 'taiko' ? [95, 45, 0.9, 0.5] : kind === 'tom' ? [180, 110, 0.4, 0.3] : [140, 70, 0.45, 0.6];
  const g = c.createGain();
  const o = osc('sine', f0, t, t + dec + 0.1);
  o.frequency.exponentialRampToValueAtTime(f1, t + dec * 0.6);
  o.connect(g);
  const ng = c.createGain();
  ng.gain.value = nAmt;
  noiseSrc(t, 0.15).connect(filter('bandpass', kind === 'taiko' ? 300 : 900, 0.8)).connect(ng).connect(g);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vel * (kind === 'taiko' ? 0.5 : 0.28), t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
  out(g, bus, kind === 'taiko' ? 0.35 : 0.2);
}

function noiseHit(t: number, dur: number, vel: number, type: BiquadFilterType, freq: number, q: number, bus: GainNode, wet = 0.15): void {
  const g = ctx!.createGain();
  noiseSrc(t, dur + 0.05).connect(filter(type, freq, q)).connect(g);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vel, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  out(g, bus, wet);
}

function chirp(f0: number, f1: number, t: number, dur: number, vel: number, type: OscillatorType, bus: GainNode, wet = 0.15): void {
  const g = ctx!.createGain();
  const o = osc(type, f0, t, t + dur + 0.05);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  o.connect(g);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vel, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  out(g, bus, wet);
}

// ------------------------------------------------------------------ efeitos

const lastPlayed = new Map<Sfx, number>();

/** Toca um efeito; `delay` em segundos (para casar com animações). Repetições muito próximas são ignoradas. */
export function play(sfx: Sfx, delay = 0): void {
  if (!sfxOn || !ctx) return;
  if (ctx.state === 'suspended') void ctx.resume();
  const now = ctx.currentTime;
  const t = now + delay;
  const prev = lastPlayed.get(sfx) ?? -1;
  if (Math.abs(t - prev) < 0.06) return;
  lastPlayed.set(sfx, t);
  const b = sfxBus;
  const n = midi;
  switch (sfx) {
    case 'click':
      noiseHit(t, 0.03, 0.3, 'bandpass', 2400, 3, b, 0);
      chirp(900, 700, t, 0.04, 0.1, 'triangle', b, 0);
      break;
    case 'page':
      noiseHit(t, 0.18, 0.06, 'bandpass', 3200, 0.8, b, 0.05);
      break;
    case 'select':
      pluck(n(76), t, 0.7, b, 0.5);
      pluck(n(83), t + 0.05, 0.5, b, 0.5);
      break;
    case 'selectMil':
      // lâmina sendo sacada
      noiseHit(t, 0.22, 0.25, 'bandpass', 5200, 6, b, 0.2);
      chirp(2400, 3600, t, 0.2, 0.06, 'sine', b, 0.25);
      break;
    case 'move':
      for (let k = 0; k < 3; k++) noiseHit(t + k * 0.13, 0.06, 0.25, 'lowpass', 700, 0.8, b, 0.05);
      break;
    case 'march':
      for (let k = 0; k < 4; k++) {
        noiseHit(t + k * 0.11, 0.07, 0.3, 'lowpass', 600, 0.8, b, 0.05);
        if (k % 2) noiseHit(t + k * 0.11 + 0.02, 0.05, 0.08, 'highpass', 4000, 1, b, 0.05);
      }
      break;
    case 'hooves':
      for (let k = 0; k < 6; k++) chirp(320, 180, t + k * 0.09 + (k % 2) * 0.03, 0.05, 0.14, 'triangle', b, 0.05);
      break;
    case 'oars':
      for (let k = 0; k < 2; k++) noiseHit(t + k * 0.35, 0.3, 0.2, 'bandpass', 900, 0.6, b, 0.25);
      break;
    case 'endTurn':
      bell(n(67), t, 0.6, b);
      bell(n(74), t + 0.12, 0.45, b);
      break;
    case 'turnStart':
      drum('frame', t, 0.4, b);
      pluck(n(62), t, 0.4, b, 1.2);
      break;
    case 'city':
      [72, 76, 79, 84].forEach((m, k) => bell(n(m), t + k * 0.11, 0.55, b));
      break;
    case 'grow':
      pluck(n(79), t, 0.45, b, 0.8);
      pluck(n(84), t + 0.09, 0.4, b, 0.9);
      break;
    case 'built':
      // bigorna + acorde
      bell(n(88), t, 0.5, b);
      bell(n(95), t + 0.15, 0.3, b);
      pluck(n(67), t + 0.1, 0.4, b, 1.2);
      break;
    case 'wonder':
      [60, 64, 67, 72].forEach((m) => pad(n(m), t, 2.2, 1.8, b, 2200));
      bell(n(84), t + 0.3, 0.5, b);
      bell(n(91), t + 0.6, 0.35, b);
      break;
    case 'tech':
      [76, 79, 83, 88].forEach((m, k) => pluck(n(m), t + k * 0.07, 0.5, b, 1.0, 4000));
      chirp(1800, 3200, t, 0.35, 0.02, 'sine', b, 0.4);
      break;
    case 'civic':
      [62, 66, 69, 74, 78].forEach((m, k) => pluck(n(m), t + k * 0.09, 0.5, b, 1.4));
      break;
    case 'boost':
      chirp(900, 2400, t, 0.18, 0.05, 'triangle', b, 0.3);
      bell(n(91), t + 0.12, 0.35, b);
      break;
    case 'combat':
    case 'clash':
      // choque de metal: ruído brilhante + parciais metálicos
      noiseHit(t, 0.16, 0.22, 'bandpass', 3500, 1.4, b, 0.2);
      for (const f of [1870, 2530, 3310]) chirp(f, f * 0.98, t, 0.35, 0.03, 'square', b, 0.2);
      noiseHit(t, 0.12, 0.18, 'lowpass', 400, 0.8, b, 0.1);
      break;
    case 'bow':
      chirp(220, 140, t, 0.08, 0.16, 'triangle', b, 0.05);
      noiseHit(t + 0.02, 0.28, 0.18, 'bandpass', 2600, 2, b, 0.1);
      break;
    case 'boom':
      drum('taiko', t, 0.9, b);
      noiseHit(t, 0.5, 0.25, 'lowpass', 300, 0.7, b, 0.3);
      break;
    case 'death':
      chirp(300, 90, t, 0.45, 0.11, 'sawtooth', b, 0.25);
      break;
    case 'war':
      drum('taiko', t, 1, b);
      drum('taiko', t + 0.45, 0.8, b);
      brass(n(45), t + 0.1, 1.1, 1.2, b);
      brass(n(52), t + 0.1, 1.1, 0.9, b);
      break;
    case 'peace':
      [60, 67, 72, 76].forEach((m) => pad(n(m), t, 1.6, 1.5, b, 1800));
      pluck(n(79), t + 0.3, 0.5, b, 1.5);
      break;
    case 'contact':
      brass(n(57), t, 0.35, 1, b);
      brass(n(64), t + 0.32, 0.6, 1, b);
      break;
    case 'era':
      [55, 60, 64, 67].forEach((m, k) => brass(n(m), t + k * 0.16, 0.5 + (k === 3 ? 0.7 : 0), 1.1, b));
      drum('taiko', t + 0.48, 0.7, b);
      break;
    case 'gold':
      [88, 93].forEach((m, k) => bell(n(m), t + k * 0.07, 0.45, b));
      break;
    case 'promote':
      [67, 72, 76].forEach((m, k) => brass(n(m), t + k * 0.12, 0.25, 0.8, b));
      break;
    case 'victory':
      [60, 64, 67, 72].forEach((m, k) => brass(n(m), t + k * 0.18, k === 3 ? 1.4 : 0.35, 1.1, b));
      [72, 76, 79, 84].forEach((m) => pad(n(m), t + 0.7, 2.5, 1.6, b, 2400));
      drum('taiko', t + 0.54, 0.8, b);
      break;
    case 'defeat':
      [57, 53, 50, 45].forEach((m, k) => brass(n(m), t + k * 0.35, 0.6, 0.9, b));
      break;
    case 'error':
      chirp(220, 160, t, 0.16, 0.06, 'square', b, 0);
      break;
    case 'notify':
      bell(n(81), t, 0.4, b);
      bell(n(86), t + 0.09, 0.3, b);
      break;
  }
}

// ------------------------------------------------------------------ trilha generativa

interface Style {
  root: number; // nota MIDI da tônica
  mode: number[]; // escala de 7 notas (semitons)
  melody: number[]; // escala da melodia (pode ser pentatônica)
  bpm: number;
  progressions: number[][]; // graus (0–6) por compasso
  lead: 'flute' | 'pluck' | 'bell' | 'brass';
  arp: 'pluck' | 'bell' | 'none';
  drums: 'none' | 'frame' | 'taiko' | 'light';
  drone: boolean;
  bright: number;
}

const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const MIXO = [0, 2, 4, 5, 7, 9, 10];
const AEOL = [0, 2, 3, 5, 7, 8, 10];
const PHRYG = [0, 1, 3, 5, 7, 8, 10];
const IONIAN = [0, 2, 4, 5, 7, 9, 11];
const PENT_MIN = [0, 3, 5, 7, 10];
const PENT_MAJ = [0, 2, 4, 7, 9];

function styleFor(mood: Mood, era: number): Style {
  if (mood === 'menu')
    return { root: 50, mode: AEOL, melody: AEOL, bpm: 58, progressions: [[0, 5, 2, 6], [0, 3, 5, 4]], lead: 'flute', arp: 'pluck', drums: 'none', drone: true, bright: 1300 };
  if (mood === 'triumph')
    return { root: 48, mode: IONIAN, melody: PENT_MAJ, bpm: 84, progressions: [[0, 3, 4, 0], [5, 3, 4, 4]], lead: 'brass', arp: 'bell', drums: 'taiko', drone: false, bright: 2400 };
  if (mood === 'war') {
    const roots = [50, 52, 50, 48, 45, 47];
    return {
      root: roots[Math.min(era, roots.length - 1)],
      mode: era >= 4 ? AEOL : PHRYG,
      melody: era >= 4 ? AEOL : PHRYG,
      bpm: 92 + era * 3,
      progressions: [[0, 1, 0, 6], [0, 5, 6, 0], [0, 3, 1, 0]],
      lead: 'brass',
      arp: 'none',
      drums: 'taiko',
      drone: true,
      bright: 900 + era * 120,
    };
  }
  // paz, por era
  const eras: Partial<Style>[] = [
    { root: 50, mode: DORIAN, melody: PENT_MIN, bpm: 64, lead: 'flute', arp: 'pluck', drums: 'frame', drone: true, bright: 900 },
    { root: 52, mode: DORIAN, melody: DORIAN, bpm: 70, lead: 'pluck', arp: 'pluck', drums: 'frame', drone: true, bright: 1100 },
    { root: 50, mode: MIXO, melody: MIXO, bpm: 74, lead: 'flute', arp: 'pluck', drums: 'light', drone: true, bright: 1200 },
    { root: 55, mode: IONIAN, melody: PENT_MAJ, bpm: 80, lead: 'flute', arp: 'pluck', drums: 'light', drone: false, bright: 1500 },
    { root: 48, mode: AEOL, melody: AEOL, bpm: 84, lead: 'pluck', arp: 'bell', drums: 'light', drone: false, bright: 1700 },
    { root: 57, mode: DORIAN, melody: PENT_MIN, bpm: 88, lead: 'bell', arp: 'bell', drums: 'light', drone: false, bright: 2000 },
  ];
  const e = eras[Math.min(era, eras.length - 1)];
  return {
    progressions: [
      [0, 6, 3, 0],
      [0, 3, 4, 0],
      [0, 5, 3, 6],
      [3, 4, 0, 0],
    ],
    ...e,
  } as Style;
}

let mood: Mood = 'menu';
let era = 0;
let style: Style = styleFor('menu', 0);
let pending: Style | null = null;
let timer: number | null = null;
let nextBar = 0;
let bar = 0;
let section: number[] = [];
let motif: { deg: number; len: number; at: number }[] = [];
let lastMotifBar = -99;
let nextBird = 0;
let wind: { src: AudioBufferSourceNode; gain: GainNode } | null = null;

/** Muda o clima/era; a música passa a nova na virada do próximo compasso. */
export function setMusicContext(m: Mood, e = 0): void {
  if (m === mood && e === era) return;
  mood = m;
  era = e;
  pending = styleFor(m, e);
  updateWind();
}

function startMusic(): void {
  if (!ctx || !musicOn || timer !== null) return;
  nextBar = ctx.currentTime + 0.3;
  timer = window.setInterval(tick, 60);
  updateWind();
}

function updateWind(): void {
  if (!ctx) return;
  const want = mood === 'peace' || mood === 'menu';
  if (want && !wind) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = filter('bandpass', 500, 0.6);
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lg = ctx.createGain();
    lg.gain.value = 260;
    lfo.connect(lg).connect(f.frequency);
    lfo.start();
    src.connect(f).connect(gain).connect(ambBus);
    src.start();
    gain.gain.setTargetAtTime(0.05, ctx.currentTime, 2);
    wind = { src, gain };
  } else if (!want && wind) {
    const w = wind;
    w.gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 1.2);
    w.src.stop(ctx.currentTime + 5);
    wind = null;
  }
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

/** Nota MIDI do grau (com oitava) na escala dada, a partir da tônica. */
function deg(scale: number[], d: number, root: number): number {
  const len = scale.length;
  const o = Math.floor(d / len);
  return root + scale[((d % len) + len) % len] + 12 * o;
}

function newMotif(): void {
  // 4–6 notas, passos curtos, começa e termina em nota do acorde
  const n = 4 + Math.floor(Math.random() * 3);
  const rhythms = [
    [1, 1, 2],
    [0.5, 0.5, 1, 2],
    [1.5, 0.5, 1, 1],
    [2, 1, 1],
    [1, 0.5, 0.5, 2],
  ];
  const r = pick(rhythms);
  motif = [];
  let d = pick([0, 2, 4]);
  let at = 0;
  for (let k = 0; k < n && at < 4; k++) {
    const len = r[k % r.length];
    motif.push({ deg: d, len, at });
    at += len;
    d += pick([-2, -1, -1, 1, 1, 2, 0]);
  }
}

function tick(): void {
  const c = ctx;
  if (!c || !musicOn) return;
  // pássaros ocasionais em tempo de paz
  if (mood === 'peace' && c.currentTime > nextBird) {
    nextBird = c.currentTime + rnd(7, 18);
    const t = c.currentTime + 0.2;
    const base = rnd(2600, 4200);
    for (let k = 0; k < 2 + Math.floor(Math.random() * 3); k++) chirp(base, base * rnd(1.2, 1.5), t + k * 0.12, 0.08, 0.012, 'sine', ambBus, 0.3);
  }
  while (nextBar < c.currentTime + 0.35) {
    scheduleBar(nextBar);
    nextBar += (60 / style.bpm) * 4;
  }
}

function scheduleBar(t: number): void {
  if (pending) {
    style = pending;
    pending = null;
    section = [];
    lastMotifBar = -99;
  }
  const s = style;
  if (!section.length) {
    section = [...pick(s.progressions), ...pick(s.progressions)];
    newMotif();
  }
  const beat = 60 / s.bpm;
  const chordDeg = section.shift()!;
  bar++;
  const breathe = bar % 16 === 15; // respiro: compasso só com zumbido
  const chordRoot = s.root - 12;
  const chord = [0, 2, 4].map((k) => deg(s.mode, chordDeg + k, chordRoot + 12));
  const mb = musicBus;
  if (s.drone) drone(midi(s.root - 12), t, beat * 4, 1, mb);
  if (breathe) return;
  // pad
  for (const m of chord) pad(midi(m), t, beat * 4, mood === 'war' ? 0.8 : 1, mb, s.bright);
  // arpejo
  if (s.arp !== 'none') {
    const notes = [...chord, chord[0] + 12, chord[1] + 12];
    const pattern = mood === 'menu' ? [0, 2, 4, 2] : pick([[0, 1, 2, 3, 4, 3, 2, 1], [0, 2, 1, 3, 2, 4, 3, 1], [0, 2, 4, 2, 0, 2, 4, 2]]);
    const step = mood === 'menu' ? beat : beat / 2;
    pattern.forEach((p, k) => {
      if (Math.random() < 0.15) return;
      const at = t + k * step;
      if (at >= t + beat * 4) return;
      const f = midi(notes[p % notes.length] + 12);
      if (s.arp === 'bell') bell(f, at, 0.35, mb);
      else pluck(f, at, 0.4 + Math.random() * 0.15, mb, 1.4, s.bright * 1.6);
    });
  }
  // melodia: motivo em compassos alternados, repetido e variado (AABA)
  if (bar - lastMotifBar >= 2 && Math.random() < 0.85) {
    lastMotifBar = bar;
    if (bar % 8 === 5) newMotif();
    const shift = bar % 8 === 3 ? pick([1, 2, -1]) : 0;
    for (const nt of motif) {
      const m = deg(s.melody, nt.deg + shift + (s.melody.length === 5 ? 5 : 7), s.root);
      const at = t + nt.at * beat;
      const dur = nt.len * beat * 0.95;
      if (s.lead === 'flute') flute(midi(m), at, dur, 0.9, mb);
      else if (s.lead === 'brass') brass(midi(m - 12), at, dur, 0.8, mb);
      else if (s.lead === 'bell') bell(midi(m), at, 0.5, mb);
      else pluck(midi(m), at, 0.6, mb, 1.8, s.bright * 1.8);
    }
  }
  // percussão
  if (s.drums === 'taiko') {
    for (const [b, v] of [
      [0, 1],
      [1.5, 0.6],
      [2, 0.9],
      [3, 0.5],
      [3.5, 0.7],
    ] as const)
      drum('taiko', t + b * beat, v * 0.8, mb);
    for (let k = 0; k < 8; k++) drum('shaker', t + k * beat * 0.5, 0.5, mb);
  } else if (s.drums === 'frame') {
    drum('frame', t, 0.5, mb);
    if (Math.random() < 0.6) drum('frame', t + beat * 2.5, 0.35, mb);
  } else if (s.drums === 'light') {
    drum('tom', t, 0.35, mb);
    for (let k = 0; k < 4; k++) if (Math.random() < 0.6) drum('shaker', t + k * beat + beat * 0.5, 0.35, mb);
  }
}
