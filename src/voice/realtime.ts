import { useSyncExternalStore } from 'react';
import { findQuestion } from '../game/engine';
import { store } from '../game/store';
import { applyJudgement, isLive } from '../ui/actions';
import { fx } from '../ui/fx';

export type VoiceStatus = 'off' | 'connecting' | 'live' | 'reconnecting' | 'error';

interface VoiceState {
  available: boolean | null;
  status: VoiceStatus;
  lastHeard: string;
  error: string | null;
}

const SAMPLE_RATE = 24_000;
const WAKE = /\b(steve\s+)?h[ae]r\s?v(e|a)?y\b|\bharv\b/i;
const WAKE_WINDOW_MS = 9_000;
const TRANSCRIPT_WAIT_MS = 1_500;

let state: VoiceState = { available: null, status: 'off', lastHeard: '', error: null };
const listeners = new Set<() => void>();

function set(patch: Partial<VoiceState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

let ws: WebSocket | null = null;
let media: MediaStream | null = null;
let audioCtx: AudioContext | null = null;
let worklet: AudioWorkletNode | null = null;
let wanted = false;
let retry = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let pending: Int16Array[] = [];
let utterance = '';
let utteranceFinal = false;
let wakeUntil = 0;
let transcriptsSeen = false;
let wakeIdleTimer: ReturnType<typeof setTimeout> | null = null;
let boardKey = '';

const WORKLET = `
class Pcm extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(2400); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.buf.length) {
          const out = new Int16Array(this.n);
          for (let j = 0; j < this.n; j++) {
            const s = Math.max(-1, Math.min(1, this.buf[j]));
            out[j] = s < 0 ? s * 0x8000 : s * 0x7fff;
          }
          this.port.postMessage(out, [out.buffer]);
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('pcm-capture', Pcm);
`;

function toBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function sendAudio(pcm: Int16Array) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: toBase64(pcm) }));
  } else {
    pending.push(pcm);
    if (pending.length > 10) pending = pending.slice(-10);
  }
}

function boardContext() {
  const s = store.get().session;
  const game = s?.game;
  const round = game?.round;
  if (!s || !game || !round || !isLive(game)) return null;
  const q = findQuestion(s.deck, round.questionId);
  if (!q) return null;
  return { q, round, key: `${game.id}:${round.number}:${Object.keys(round.revealed).sort().join(',')}:${game.phase}` };
}

function sessionConfig() {
  const ctx = boardContext();
  const ids = ctx ? ctx.q.answers.map((a) => a.id) : [];
  const board = ctx
    ? [
        `Survey question: "${ctx.q.prompt}"`,
        'Survey answers (id: text):',
        ...ctx.q.answers.map((a) => `- ${a.id}: ${a.text}${a.id in ctx.round.revealed ? ' (already on the board)' : ''}`),
      ].join('\n')
    : 'No question is in play right now. Do not call any tool.';

  const instructions = [
    'You are the silent judge for a Family Feud style game show at a work event. The host calls you "Harvey" or "Steve Harvey".',
    'Never speak, never answer out loud, and never mention any answer. Your only action is calling the judge_guess tool.',
    'Call judge_guess only when the host says "Harvey" or "Steve Harvey" and asks whether a guess is on the board, for example "Harvey, is coffee on the board?" or "Steve Harvey, show me traffic!". The guess may come in the same sentence or right after the wake phrase. Ignore every other conversation in the room.',
    board,
    'Match generously, like the TV show: synonyms, plurals, slang, brand names for the same thing, and close paraphrases count. A clearly different idea does not count.',
    'If the guess matches an answer already on the board, return that id. If nothing matches, return "none".',
  ].join('\n\n');

  return {
    type: 'session.update',
    session: {
      instructions,
      reasoning: { effort: 'none' },
      turn_detection: { type: 'server_vad' },
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: SAMPLE_RATE },
          transcription: { model: 'grok-transcribe', keyterms: ['Harvey', 'Steve Harvey'] },
        },
        output: { format: { type: 'audio/pcm', rate: SAMPLE_RATE } },
      },
      tools: [
        {
          type: 'function',
          name: 'judge_guess',
          description: 'Judge whether the guess the host asked Harvey about is on the survey board.',
          parameters: {
            type: 'object',
            properties: {
              heard_guess: { type: 'string', description: 'The guess exactly as the host said it.' },
              answer_id: { type: 'string', enum: [...ids, 'none'], description: 'Matching answer id, or "none".' },
            },
            required: ['heard_guess', 'answer_id'],
          },
        },
      ],
    },
  };
}

function pushBoard(force = false) {
  const key = boardContext()?.key ?? 'idle';
  if (!force && key === boardKey) return;
  boardKey = key;
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(sessionConfig()));
}

function onTranscript(text: string, final: boolean) {
  transcriptsSeen = true;
  utterance = text;
  utteranceFinal = final;
  if (text.trim()) set({ lastHeard: text.trim() });
  if (WAKE.test(text)) {
    wakeUntil = Date.now() + WAKE_WINDOW_MS;
    fx.listening('Listening...');
    if (wakeIdleTimer) clearTimeout(wakeIdleTimer);
    wakeIdleTimer = setTimeout(() => {
      if (Date.now() >= wakeUntil) fx.idle();
    }, WAKE_WINDOW_MS + 200);
  }
}

/** Without transcripts the model's own wake-phrase check is all we have. */
function wakeHeard() {
  return !transcriptsSeen || Date.now() < wakeUntil || WAKE.test(utterance);
}

async function onFunctionCall(ev: { name?: string; call_id?: string; arguments?: string }) {
  if (ev.name !== 'judge_guess') return;
  let args: { heard_guess?: string; answer_id?: string } = {};
  try {
    args = JSON.parse(ev.arguments ?? '{}');
  } catch {
    /* malformed args are treated as "none" */
  }

  const started = Date.now();
  while (transcriptsSeen && !wakeHeard() && !utteranceFinal && Date.now() - started < TRANSCRIPT_WAIT_MS) {
    await new Promise((r) => setTimeout(r, 100));
  }

  let result = 'ignored: no wake phrase';
  const ctx = boardContext();
  if (!wakeHeard()) {
    fx.idle();
  } else if (!ctx) {
    result = 'ignored: no question in play';
    fx.idle();
  } else {
    wakeUntil = 0;
    const id = args.answer_id && ctx.q.answers.some((a) => a.id === args.answer_id) ? args.answer_id : null;
    if (args.heard_guess) set({ lastHeard: `Guess: ${args.heard_guess}` });
    const queued = fx.whenFree(() => {
      void applyJudgement(id);
    });
    if (queued) fx.toast(`Next up: "${args.heard_guess ?? 'guess'}"`);
    result = 'applied';
  }

  if (ws && ws.readyState === WebSocket.OPEN && ev.call_id) {
    ws.send(
      JSON.stringify({
        type: 'conversation.item.create',
        item: { type: 'function_call_output', call_id: ev.call_id, output: JSON.stringify({ result }) },
      }),
    );
  }
}

function onMessage(raw: MessageEvent) {
  if (typeof raw.data !== 'string') return;
  let ev: any;
  try {
    ev = JSON.parse(raw.data);
  } catch {
    return;
  }
  switch (ev.type) {
    case 'session.created':
    case 'session.updated':
      if (state.status !== 'live') set({ status: 'live', error: null });
      retry = 0;
      break;
    case 'input_audio_buffer.speech_started':
      utterance = '';
      utteranceFinal = false;
      break;
    case 'conversation.item.input_audio_transcription.updated':
      onTranscript(String(ev.transcript ?? ''), false);
      break;
    case 'conversation.item.input_audio_transcription.delta':
      onTranscript(utterance + String(ev.delta ?? ''), false);
      break;
    case 'conversation.item.input_audio_transcription.completed':
      onTranscript(String(ev.transcript ?? utterance), true);
      break;
    case 'response.function_call_arguments.done':
      void onFunctionCall(ev);
      break;
    case 'error':
      console.warn('[voice] server error', ev);
      if (state.error !== (ev.error?.message ?? 'Voice server error')) {
        fx.toast(`Harvey voice: ${ev.error?.message ?? 'server error'}`, 'warn', 5000);
      }
      set({ error: ev.error?.message ?? 'Voice server error' });
      break;
  }
}

async function connect() {
  if (!wanted) return;
  set({ status: retry > 0 ? 'reconnecting' : 'connecting' });
  try {
    const r = await fetch('/api/realtime-token', { method: 'POST' });
    const data = (await r.json().catch(() => ({}))) as { token?: string; model?: string; error?: string };
    if (!r.ok || !data.token) throw new Error(data.error ?? `Token request failed (${r.status})`);
    if (!wanted) return;
    const socket = new WebSocket(
      `wss://api.x.ai/v1/realtime?model=${encodeURIComponent(data.model ?? 'grok-voice-latest')}`,
      [`xai-client-secret.${data.token}`],
    );
    ws = socket;
    socket.onopen = () => {
      boardKey = '';
      pushBoard(true);
      const flush = pending;
      pending = [];
      flush.forEach(sendAudio);
    };
    socket.onmessage = onMessage;
    socket.onerror = () => console.warn('[voice] socket error');
    socket.onclose = (e) => {
      if (ws === socket) ws = null;
      if (wanted) scheduleReconnect(`Voice connection closed (${e.code}${e.reason ? `: ${e.reason}` : ''})`);
    };
  } catch (err) {
    scheduleReconnect(err instanceof Error ? err.message : String(err));
  }
}

function scheduleReconnect(reason: string) {
  if (!wanted) return;
  retry++;
  const delay = Math.min(15_000, 1000 * 2 ** Math.min(retry - 1, 4));
  set({ status: 'reconnecting', error: reason });
  if (retry === 1 || retry % 4 === 0) fx.toast(`${reason}. Retrying; manual controls still work.`, 'warn', 5000);
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => void connect(), delay);
}

async function startMic() {
  media = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  });
  audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
  const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
  await audioCtx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);
  const src = audioCtx.createMediaStreamSource(media);
  worklet = new AudioWorkletNode(audioCtx, 'pcm-capture');
  worklet.port.onmessage = (e) => sendAudio(e.data as Int16Array);
  src.connect(worklet);
}

export const voice = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },

  async checkAvailable() {
    try {
      const r = await fetch('/api/status');
      const data = (await r.json()) as { voice?: boolean };
      set({ available: Boolean(data.voice) });
    } catch {
      set({ available: false });
    }
  },

  async start() {
    if (wanted) return;
    wanted = true;
    retry = 0;
    set({ status: 'connecting', error: null });
    try {
      await startMic();
    } catch (err) {
      wanted = false;
      const msg = err instanceof Error ? err.message : String(err);
      set({ status: 'error', error: `Microphone unavailable: ${msg}` });
      fx.toast(`Microphone unavailable: ${msg}`, 'error', 6000);
      voice.stop(true);
      return;
    }
    await connect();
  },

  stop(keepError = false) {
    wanted = false;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    try {
      ws?.close();
    } catch {
      /* already closed */
    }
    ws = null;
    worklet?.disconnect();
    worklet = null;
    media?.getTracks().forEach((t) => t.stop());
    media = null;
    void audioCtx?.close().catch(() => undefined);
    audioCtx = null;
    pending = [];
    wakeUntil = 0;
    transcriptsSeen = false;
    if (wakeIdleTimer) clearTimeout(wakeIdleTimer);
    fx.idle();
    set({ status: keepError ? state.status : 'off', error: keepError ? state.error : null });
  },

  toggle() {
    if (wanted) voice.stop();
    else void voice.start();
  },

  isOn: () => wanted,
};

store.subscribe(() => pushBoard());

export function useVoice(): VoiceState {
  return useSyncExternalStore(voice.subscribe, voice.get, voice.get);
}
