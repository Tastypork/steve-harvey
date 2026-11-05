import { soundOverride, type SoundName } from '../assets';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const decoded = new Map<string, AudioBuffer | null>();
let applauseBuffer: AudioBuffer | null = null;

function audio(): { ctx: AudioContext; out: GainNode } | null {
  try {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.8;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return { ctx, out: master! };
  } catch (err) {
    console.warn('Audio unavailable', err);
    return null;
  }
}

/** Browsers only allow audio after a user gesture; call this from any click/keydown. */
export function unlockAudio() {
  audio();
}

async function overrideBuffer(name: SoundName): Promise<AudioBuffer | null> {
  const url = soundOverride(name);
  if (!url) return null;
  if (decoded.has(url)) return decoded.get(url) ?? null;
  const a = audio();
  if (!a) return null;
  try {
    const r = await fetch(url);
    const type = r.headers.get('content-type') ?? '';
    if (!r.ok || type.includes('text/html')) throw new Error(`not audio (${r.status} ${type})`);
    const buf = await a.ctx.decodeAudioData(await r.arrayBuffer());
    decoded.set(url, buf);
    return buf;
  } catch (err) {
    console.warn(`Sound override ${url} failed, using built-in tone`, err);
    decoded.set(url, null);
    return null;
  }
}

export function preloadSounds() {
  (['clap', 'correct', 'buzzer', 'stinger'] as SoundName[]).forEach((n) => void overrideBuffer(n));
}

function tone(
  a: { ctx: AudioContext; out: GainNode },
  opts: { type: OscillatorType; freq: number; start: number; dur: number; gain: number; attack?: number; detune?: number; filter?: number },
) {
  const { ctx: c, out } = a;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = opts.type;
  osc.frequency.value = opts.freq;
  if (opts.detune) osc.detune.value = opts.detune;
  const t0 = c.currentTime + opts.start;
  const attack = opts.attack ?? 0.005;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(opts.gain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
  let node: AudioNode = osc;
  if (opts.filter) {
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = opts.filter;
    osc.connect(f);
    node = f;
  }
  node.connect(g);
  g.connect(out);
  osc.start(t0);
  osc.stop(t0 + opts.dur + 0.05);
}

function ding(a: { ctx: AudioContext; out: GainNode }) {
  tone(a, { type: 'sine', freq: 1318.5, start: 0, dur: 1.4, gain: 0.5 });
  tone(a, { type: 'sine', freq: 2637, start: 0, dur: 0.9, gain: 0.18 });
  tone(a, { type: 'triangle', freq: 659.3, start: 0, dur: 1.1, gain: 0.22 });
}

function buzzer(a: { ctx: AudioContext; out: GainNode }) {
  const dur = 0.95;
  tone(a, { type: 'sawtooth', freq: 98, start: 0, dur, gain: 0.32, attack: 0.01, filter: 1400 });
  tone(a, { type: 'square', freq: 104, start: 0, dur, gain: 0.18, attack: 0.01, filter: 1100 });
  tone(a, { type: 'sawtooth', freq: 196, start: 0, dur, gain: 0.12, attack: 0.01, detune: 12, filter: 1800 });
}

function stinger(a: { ctx: AudioContext; out: GainNode }) {
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((f, i) => {
    const last = i === notes.length - 1;
    tone(a, { type: 'sawtooth', freq: f, start: i * 0.12, dur: last ? 1.3 : 0.2, gain: 0.16, filter: 2600 });
    tone(a, { type: 'square', freq: f / 2, start: i * 0.12, dur: last ? 1.3 : 0.2, gain: 0.07, filter: 1600 });
  });
}

function makeApplause(c: AudioContext): AudioBuffer {
  const seconds = 4;
  const rate = c.sampleRate;
  const buf = c.createBuffer(2, seconds * rate, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    const claps = 900;
    for (let k = 0; k < claps; k++) {
      // Front-loaded density so it swells then tails off.
      const t = Math.pow(Math.random(), 1.6) * (seconds - 0.2);
      const start = Math.floor(t * rate);
      const len = Math.floor(rate * (0.008 + Math.random() * 0.012));
      const amp = (0.25 + Math.random() * 0.5) * (1 - t / seconds);
      for (let i = 0; i < len && start + i < data.length; i++) {
        data[start + i] += (Math.random() * 2 - 1) * amp * Math.exp(-i / (len / 4));
      }
    }
    for (let i = 0; i < data.length; i++) data[i] = Math.max(-1, Math.min(1, data[i] * 0.6));
  }
  return buf;
}

function applause(a: { ctx: AudioContext; out: GainNode }) {
  if (!applauseBuffer) applauseBuffer = makeApplause(a.ctx);
  const src = a.ctx.createBufferSource();
  src.buffer = applauseBuffer;
  const bp = a.ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 2200;
  bp.Q.value = 0.6;
  const g = a.ctx.createGain();
  g.gain.value = 1.4;
  src.connect(bp).connect(g).connect(a.out);
  src.start();
}

const SYNTH: Record<SoundName, (a: { ctx: AudioContext; out: GainNode }) => void> = {
  clap: applause,
  correct: ding,
  buzzer,
  stinger,
};

/** Correct-answer ding, then the crowd. */
export async function playAnswer() {
  await play('correct');
  window.setTimeout(() => void play('clap'), 400);
}

export async function play(name: SoundName) {
  const a = audio();
  if (!a) return;
  const buf = await overrideBuffer(name);
  try {
    if (buf) {
      const src = a.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(a.out);
      src.start();
    } else {
      SYNTH[name](a);
    }
  } catch (err) {
    console.warn('Could not play sound', name, err);
  }
}

export const SOUND_KEYS: { key: string; name: SoundName; label: string }[] = [
  { key: '1', name: 'clap', label: 'Applause' },
  { key: '2', name: 'correct', label: 'Good answer ding' },
  { key: '3', name: 'buzzer', label: 'Strike buzzer' },
  { key: '4', name: 'stinger', label: 'Steal / win stinger' },
];
