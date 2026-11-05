import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadEnv, type Plugin } from 'vite';

const XAI = 'https://api.x.ai/v1';
const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'];
const AUDIO_EXT = ['.mp3', '.wav', '.ogg', '.m4a'];
const HOST_POSES = ['idle', 'listening', 'correct', 'incorrect'];
const SOUNDS = ['clap', 'correct', 'buzzer', 'stinger'];

interface JudgeAnswer {
  id: string;
  text: string;
  revealed?: boolean;
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

/** First file in `dir` named `base` with one of `exts`, preferring earlier extensions. */
function findAsset(publicDir: string, dir: string, base: string, exts: string[]): string | null {
  for (const ext of exts) {
    const rel = `${dir}/${base}${ext}`;
    if (fs.existsSync(path.join(publicDir, rel))) return `/${rel}`;
  }
  return null;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(the|a|an|my|your)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function forms(s: string): Set<string> {
  const n = normalize(s);
  return new Set([n, n.replace(/s$/, ''), n.replace(/es$/, '')].filter(Boolean));
}

function exactMatch(guess: string, answers: JudgeAnswer[]): string | null {
  const g = forms(guess);
  if (g.size === 0) return null;
  return answers.find((a) => [...forms(a.text)].some((f) => g.has(f)))?.id ?? null;
}

function outputText(data: any): string {
  if (typeof data?.output_text === 'string') return data.output_text;
  const parts: string[] = [];
  for (const item of data?.output ?? []) {
    for (const c of item?.content ?? []) {
      if (typeof c?.text === 'string') parts.push(c.text);
    }
  }
  if (parts.length) return parts.join('');
  return data?.choices?.[0]?.message?.content ?? '';
}

export function judgeInstructions(prompt: string, answers: JudgeAnswer[]): string {
  const list = answers.map((a) => `- ${a.id}: ${a.text}${a.revealed ? ' (already on the board)' : ''}`).join('\n');
  return [
    'You judge guesses on a Family Feud style game show at a work event.',
    `Survey question: "${prompt}"`,
    'Survey answers (id: text):',
    list,
    'Decide which single answer the guess matches. Be as generous as the TV show: synonyms, plurals, slang, brand names for the same thing, and close paraphrases count. A guess that names a clearly different idea does not count.',
    'If the guess matches an answer already on the board, still return that id.',
    'If nothing matches, return "none".',
  ].join('\n');
}

async function aiJudge(key: string, model: string, guess: string, prompt: string, answers: JudgeAnswer[]) {
  const ids = answers.map((a) => a.id);
  const body: Record<string, unknown> = {
    model,
    reasoning: { effort: 'low' },
    input: [
      { role: 'system', content: judgeInstructions(prompt, answers) },
      { role: 'user', content: `Contestant's guess: "${guess}"` },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'judgement',
        strict: true,
        schema: {
          type: 'object',
          properties: { answer_id: { type: 'string', enum: [...ids, 'none'] } },
          required: ['answer_id'],
          additionalProperties: false,
        },
      },
    },
  };

  const call = async (payload: Record<string, unknown>) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12_000);
    try {
      return await fetch(`${XAI}/responses`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };

  let r = await call(body);
  if (r.status === 400) {
    const { text: _drop, ...plain } = body;
    plain.input = [
      { role: 'system', content: `${judgeInstructions(prompt, answers)}\nReply with JSON only: {"answer_id": "<id or none>"}` },
      { role: 'user', content: `Contestant's guess: "${guess}"` },
    ];
    r = await call(plain);
  }
  if (!r.ok) throw new Error(`xAI ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const text = outputText(await r.json());
  let id: string | null = null;
  try {
    id = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)).answer_id ?? null;
  } catch {
    id = ids.find((x) => text.includes(x)) ?? null;
  }
  return id && ids.includes(id) ? id : null;
}

export function feudApi(): Plugin {
  let root = process.cwd();
  let mode = 'development';
  let publicDir = path.join(root, 'public');

  const env = () => {
    const e = { ...loadEnv(mode, root, ''), ...process.env } as Record<string, string | undefined>;
    return {
      key: (e.XAI_API_KEY ?? '').trim(),
      voiceModel: e.XAI_VOICE_MODEL || 'grok-voice-latest',
      judgeModel: e.XAI_JUDGE_MODEL || 'grok-4.7',
    };
  };

  const handler = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = (req.url ?? '').split('?')[0];
    if (!url.startsWith('/api/')) return next();
    try {
      if (url === '/api/status' && req.method === 'GET') {
        const { key, voiceModel, judgeModel } = env();
        return send(res, 200, { voice: Boolean(key), voiceModel, judgeModel });
      }

      if (url === '/api/assets' && req.method === 'GET') {
        const host = Object.fromEntries(
          HOST_POSES.map((p) => [p, findAsset(publicDir, 'host', p, IMAGE_EXT)]).filter(([, v]) => v),
        );
        const sounds = Object.fromEntries(
          SOUNDS.map((s) => [s, findAsset(publicDir, 'sounds', s, AUDIO_EXT)]).filter(([, v]) => v),
        );
        const personaDir = path.join(publicDir, 'personas');
        const personas: Record<string, string> = {};
        if (fs.existsSync(personaDir)) {
          const files = fs.readdirSync(personaDir);
          const bases = new Set(files.map((f) => f.replace(/\.[^.]+$/, '')));
          for (const b of bases) {
            const found = findAsset(publicDir, 'personas', b, IMAGE_EXT);
            if (found) personas[b] = found;
          }
        }
        const logo = findAsset(publicDir, 'brand', 'logo', IMAGE_EXT);
        return send(res, 200, { host, sounds, personas, logo });
      }

      if (url === '/api/realtime-token' && req.method === 'POST') {
        const { key, voiceModel } = env();
        if (!key) return send(res, 400, { error: 'No XAI_API_KEY in .env. Voice is off; manual controls still work.' });
        const r = await fetch(`${XAI}/realtime/client_secrets`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ expires_after: { seconds: 300 } }),
        });
        if (!r.ok) return send(res, 502, { error: `xAI token request failed (${r.status}): ${(await r.text()).slice(0, 300)}` });
        const data: any = await r.json();
        const token = data?.value ?? data?.client_secret?.value ?? data?.secret ?? data?.token;
        if (!token) return send(res, 502, { error: 'xAI token response had no token.' });
        return send(res, 200, { token, model: voiceModel, expiresAt: data?.expires_at ?? null });
      }

      if (url === '/api/judge' && req.method === 'POST') {
        const body = (await readJson(req)) as { guess?: string; prompt?: string; answers?: JudgeAnswer[] };
        const guess = String(body.guess ?? '').trim();
        const answers = Array.isArray(body.answers) ? body.answers.filter((a) => a && a.id && a.text) : [];
        if (!guess || answers.length === 0) return send(res, 400, { error: 'Need a guess and the board answers.' });
        const exact = exactMatch(guess, answers);
        if (exact) return send(res, 200, { answerId: exact, source: 'exact' });
        const { key, judgeModel } = env();
        if (!key) return send(res, 400, { error: 'No XAI_API_KEY in .env, so the typed judge is off.' });
        const answerId = await aiJudge(key, judgeModel, guess, String(body.prompt ?? ''), answers);
        return send(res, 200, { answerId, source: 'ai' });
      }

      return send(res, 404, { error: `No route ${req.method} ${url}` });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[feud-api]', message);
      return send(res, 500, { error: message });
    }
  };

  return {
    name: 'feud-api',
    configResolved(config) {
      root = config.root;
      mode = config.mode;
      publicDir = config.publicDir || path.join(root, 'public');
    },
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}
