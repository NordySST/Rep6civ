/**
 * Efeitos sonoros sintetizados com WebAudio (sem arquivos de áudio).
 * O contexto só é criado após um gesto do usuário (regras de autoplay).
 */
export type Sfx = 'click' | 'endTurn' | 'city' | 'combat' | 'victory' | 'error' | 'notify';

let ctx: AudioContext | null = null;
let enabled = true;

export function setSoundEnabled(on: boolean): void {
  enabled = on;
}

export function unlockAudio(): void {
  if (ctx) return;
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AC) ctx = new AC();
  } catch {
    ctx = null;
  }
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', gain = 0.12): void {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  const t0 = ctx.currentTime + start;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function noise(start: number, dur: number, gain = 0.15): void {
  if (!ctx) return;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  const g = ctx.createGain();
  g.gain.value = gain;
  src.buffer = buf;
  src.connect(g).connect(ctx.destination);
  src.start(ctx.currentTime + start);
}

export function play(sfx: Sfx): void {
  if (!enabled || !ctx) return;
  if (ctx.state === 'suspended') void ctx.resume();
  switch (sfx) {
    case 'click':
      tone(660, 0, 0.06, 'triangle', 0.06);
      break;
    case 'endTurn':
      tone(392, 0, 0.12, 'triangle');
      tone(523, 0.1, 0.18, 'triangle');
      break;
    case 'city':
      tone(523, 0, 0.3);
      tone(659, 0.05, 0.3);
      tone(784, 0.1, 0.35);
      break;
    case 'combat':
      noise(0, 0.18, 0.2);
      tone(140, 0, 0.15, 'sawtooth', 0.08);
      break;
    case 'victory':
      [523, 659, 784, 1047].forEach((f, k) => tone(f, k * 0.12, 0.4, 'triangle', 0.1));
      break;
    case 'error':
      tone(180, 0, 0.18, 'square', 0.05);
      break;
    case 'notify':
      tone(880, 0, 0.1, 'sine', 0.07);
      tone(1175, 0.08, 0.12, 'sine', 0.06);
      break;
  }
}
