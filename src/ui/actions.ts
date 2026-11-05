import { play, playAnswer } from '../audio/sounds';
import { currentTeamId, findQuestion, type Action } from '../game/engine';
import { store } from '../game/store';
import type { GameState } from '../game/types';
import { fx } from './fx';

function session() {
  return store.get().session;
}

function teamName(game: GameState, id: string | null | undefined): string {
  return game.teams.find((t) => t.id === id)?.name ?? 'That family';
}

export function isLive(game: GameState | undefined | null): boolean {
  return !!game && (game.phase === 'playing' || game.phase === 'steal');
}

export function markCorrect(answerId: string) {
  const s = session();
  if (!s || !isLive(s.game)) return;
  const before = s.game;
  if (before.round && answerId in before.round.revealed) {
    markWrong('repeat');
    return;
  }
  const after = store.dispatch({ type: 'correct', answerId });
  if (!after) return;
  playAnswer();
  const outcome = after.round?.outcome;
  if (outcome === 'stolen') {
    fx.react('correct', `Stolen by ${teamName(after, after.round?.stealerTeamId)}!`, 4200);
    setTimeout(() => play('stinger'), 650);
  } else if (outcome === 'cleared') {
    fx.react('correct', 'Board cleared!', 4200);
  } else {
    fx.react('correct', 'Good answer!');
  }
}

export function markWrong(reason: 'miss' | 'repeat' = 'miss') {
  const s = session();
  if (!s || !isLive(s.game)) return;
  const before = s.game;
  const after = store.dispatch({ type: 'wrong' });
  if (!after) return;
  play('buzzer');
  const wasSteal = before.phase === 'steal';
  fx.strike(wasSteal ? 1 : Math.min(3, after.round?.strikes ?? 1));
  const outcome = after.round?.outcome;
  let caption = reason === 'repeat' ? 'Already on the board!' : 'Survey says... no!';
  if (wasSteal) {
    const target = teamName(after, after.round?.steal?.targetTeamId);
    caption = outcome === 'defended' ? 'No one stole it.' : `${target} is now the target.`;
  }
  if (outcome === 'empty') caption = 'Nothing to steal!';
  fx.react('incorrect', caption);
  if (!wasSteal && after.phase === 'steal') {
    const stealer = teamName(after, currentTeamId(after));
    fx.toast(`Three strikes. ${stealer}, steal it!`);
  }
}

const CHECK_MS = 1000;
let checkGen = 0;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Round identity, so a late Harvey answer does not land after the host has moved on. */
function liveStamp(): string | null {
  const s = session();
  const round = s?.game.round;
  if (!s || !round || !isLive(s.game)) return null;
  const revealed = Object.keys(round.revealed).sort().join(',');
  return `${s.game.id}:${round.number}:${s.game.phase}:${round.strikes}:${round.turnIndex}:${revealed}`;
}

/** Keep the current listening bubble. Only open one if Harvey is not already listening. */
function stayListening() {
  if (fx.get().pose === 'listening') return;
  fx.listening();
}

/** Shared entry point for voice and typed judging. `null` means not on the board. */
export async function applyJudgement(answerId: string | null, startedAt = Date.now()) {
  const gen = ++checkGen;
  const stamp = liveStamp();
  if (!stamp) {
    fx.idle();
    fx.toast('No question is in play right now.', 'warn');
    return;
  }
  stayListening();
  const wait = Math.max(0, CHECK_MS - (Date.now() - startedAt));
  if (wait) await sleep(wait);
  if (gen !== checkGen) return;
  if (liveStamp() !== stamp) {
    fx.idle();
    return;
  }
  if (answerId) markCorrect(answerId);
  else markWrong('miss');
}

export function revealOnly(answerId: string) {
  const s = session();
  if (!s || s.game.phase !== 'roundEnd') return;
  const after = store.dispatch({ type: 'revealOnly', answerId });
  if (after !== s.game) playAnswer();
}

/** Shift+click / Shift+number on slab n (0-based). */
export function slabAction(index: number) {
  const s = session();
  if (!s?.game.round) return;
  const q = findQuestion(s.deck, s.game.round.questionId);
  const answer = q?.answers[index];
  if (!answer) return;
  if (s.game.phase === 'roundEnd') revealOnly(answer.id);
  else if (isLive(s.game)) markCorrect(answer.id);
}

export function undo() {
  if (store.undo()) {
    fx.idle();
    fx.toast('Undid the last step.');
  } else {
    fx.toast('Nothing to undo.', 'warn');
  }
}

export function dispatch(action: Action) {
  return store.dispatch(action);
}

export async function judgeTyped(guess: string): Promise<void> {
  const s = session();
  const text = guess.trim();
  if (!s || !text) return;
  if (!isLive(s.game) || !s.game.round) {
    fx.toast('No question is in play right now.', 'warn');
    return;
  }
  const q = findQuestion(s.deck, s.game.round.questionId);
  if (!q) return;
  const roundKey = `${s.game.id}:${s.game.round.number}`;
  const revealed = s.game.round.revealed;
  const started = Date.now();
  stayListening();
  try {
    const r = await fetch('/api/judge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guess: text,
        prompt: q.prompt,
        answers: q.answers.map((a) => ({ id: a.id, text: a.text, revealed: a.id in revealed })),
      }),
    });
    const data = (await r.json().catch(() => ({}))) as { answerId?: string | null; error?: string };
    if (!r.ok) throw new Error(data.error ?? `Judge failed (${r.status})`);
    const now = session();
    if (!now || `${now.game.id}:${now.game.round?.number}` !== roundKey) return;
    let queued = false;
    queued = fx.whenFree(() => {
      void applyJudgement(data.answerId ?? null, queued ? Date.now() : started);
    });
  } catch (err) {
    fx.idle();
    fx.toast(`${err instanceof Error ? err.message : 'Judge failed'}. Use Shift+click or X instead.`, 'error', 6000);
  }
}
