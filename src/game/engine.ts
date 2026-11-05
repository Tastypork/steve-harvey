import type {
  Deck,
  FastMoneyEntry,
  FastMoneyQuestion,
  FastMoneyState,
  FastMoneyTimer,
  GameState,
  Question,
  RoundOutcome,
  RoundState,
  Team,
  TeamSetup,
} from './types';

export const MAX_TEAMS = 5;
export const MIN_TEAMS = 2;
export const FAST_MONEY_MS = 25_000;
export const FAST_MONEY_COUNT = 5;

export type Action =
  | { type: 'correct'; answerId: string }
  | { type: 'wrong' }
  | { type: 'revealOnly'; answerId: string }
  | { type: 'skipTurn' }
  | { type: 'setTurn'; teamId: string }
  | { type: 'endRound' }
  | { type: 'setStealTarget'; teamId: string }
  | { type: 'adjustPile'; teamId: string; delta: number }
  | { type: 'adjustTotal'; teamId: string; delta: number }
  | { type: 'selectNext'; questionId: string }
  | { type: 'nextQuestion' }
  | { type: 'fmOpen' }
  | { type: 'fmPick'; teamIds: [string, string] }
  | { type: 'fmRecord'; index: number; answer: string }
  | { type: 'fmUnrecord'; index: number }
  | { type: 'fmTimer'; op: 'start' | 'pause' | 'toggle' | 'reset'; now: number }
  | { type: 'fmToReveal'; now: number }
  | { type: 'fmShowAnswer'; player: 0 | 1; index: number }
  | { type: 'fmSetPoints'; player: 0 | 1; index: number; points: number }
  | { type: 'fmNextFamily' }
  | { type: 'fmBank' };

export function multiplierFor(roundNumber: number): number {
  if (roundNumber <= 2) return 1;
  if (roundNumber === 3) return 2;
  return 3;
}

export function multiplierLabel(m: number): string {
  if (m === 1) return 'Single';
  if (m === 2) return 'Double';
  if (m === 3) return 'Triple';
  return `x${m}`;
}

export function findQuestion(deck: Deck, id: string | null | undefined): Question | undefined {
  if (!id) return undefined;
  return deck.questions.find((q) => q.id === id);
}

export function defaultNextQuestionId(deck: Deck, used: string[]): string | null {
  const next = deck.questions.find((q) => !used.includes(q.id));
  return next ? next.id : null;
}

export function currentTeamId(game: GameState): string | null {
  const r = game.round;
  if (!r) return null;
  if (game.phase === 'steal' && r.steal) {
    return r.steal.queue[r.steal.position] ?? null;
  }
  if (game.phase === 'playing') return game.teams[r.turnIndex]?.id ?? null;
  return null;
}

export function boardPot(round: RoundState, question: Question | undefined): number {
  if (!question) return 0;
  return question.answers.reduce((sum, a) => (a.id in round.revealed ? sum + a.points : sum), 0);
}

function makeRound(game: GameState, question: Question): RoundState {
  const number = game.roundsPlayed + 1;
  const startTeamIndex = (number - 1) % game.teams.length;
  return {
    questionId: question.id,
    number,
    multiplier: multiplierFor(number),
    startTeamIndex,
    turnIndex: startTeamIndex,
    strikes: 0,
    revealed: {},
    piles: Object.fromEntries(game.teams.map((t) => [t.id, 0])),
    steal: null,
    outcome: null,
    banked: null,
    stealerTeamId: null,
  };
}

export function createGame(teamsSetup: TeamSetup[], deck: Deck, firstQuestionId?: string | null): GameState {
  const teams: Team[] = teamsSetup.slice(0, MAX_TEAMS).map((t, i) => ({
    id: `t${i + 1}`,
    name: t.name.trim() || `Family ${i + 1}`,
    personaId: t.personaId,
    total: 0,
  }));
  const base: GameState = {
    version: 1,
    id: `g${Date.now().toString(36)}`,
    createdAt: Date.now(),
    phase: 'roundEnd',
    teams,
    usedQuestionIds: [],
    roundsPlayed: 0,
    round: null,
    nextQuestionId: firstQuestionId ?? defaultNextQuestionId(deck, []),
    fastMoney: null,
    winnerTeamIds: [],
  };
  return reduce(base, { type: 'nextQuestion' }, deck);
}

/** Turn-order positions starting at `from`, wrapping around. */
function rotation(count: number, from: number): number[] {
  return Array.from({ length: count }, (_, i) => (from + i) % count);
}

function bankRound(game: GameState, deck: Deck, outcome: RoundOutcome): GameState {
  const r = game.round;
  if (!r || r.banked) return game;
  const banked: Record<string, number> = {};
  const teams = game.teams.map((t) => {
    const amount = (r.piles[t.id] ?? 0) * r.multiplier;
    banked[t.id] = amount;
    return { ...t, total: t.total + amount };
  });
  const usedQuestionIds = game.usedQuestionIds.includes(r.questionId)
    ? game.usedQuestionIds
    : [...game.usedQuestionIds, r.questionId];
  return {
    ...game,
    phase: 'roundEnd',
    teams,
    usedQuestionIds,
    roundsPlayed: Math.max(game.roundsPlayed, r.number),
    round: { ...r, outcome, banked },
    nextQuestionId: defaultNextQuestionId(deck, usedQuestionIds),
  };
}

/** One steal chance each, starting with the family after the target. */
function stealQueue(game: GameState, targetTeamId: string): string[] {
  const n = game.teams.length;
  const targetIdx = game.teams.findIndex((t) => t.id === targetTeamId);
  if (targetIdx === -1) return [];
  return rotation(n, (targetIdx + 1) % n)
    .map((i) => game.teams[i].id)
    .filter((id) => id !== targetTeamId);
}

function startSteal(game: GameState, struckOutTeamId: string): GameState {
  const r = game.round!;
  return {
    ...game,
    phase: 'steal',
    round: {
      ...r,
      strikes: 3,
      steal: {
        targetTeamId: struckOutTeamId,
        struckOutTeamId,
        queue: stealQueue(game, struckOutTeamId),
        position: 0,
      },
    },
  };
}

function allRevealed(round: RoundState, question: Question): boolean {
  return question.answers.every((a) => a.id in round.revealed);
}

function emptyEntries(count: number): FastMoneyEntry[] {
  return Array.from({ length: count }, () => ({
    answer: '',
    recorded: false,
    answerShown: false,
    points: null,
    pointsShown: false,
  }));
}

function freshTimer(): FastMoneyTimer {
  return { durationMs: FAST_MONEY_MS, remainingMs: FAST_MONEY_MS, runningSince: null };
}

export function timerRemaining(t: FastMoneyTimer, now: number): number {
  if (t.runningSince == null) return t.remainingMs;
  return Math.max(0, t.remainingMs - (now - t.runningSince));
}

function pauseTimer(t: FastMoneyTimer, now: number): FastMoneyTimer {
  if (t.runningSince == null) return t;
  return { ...t, remainingMs: timerRemaining(t, now), runningSince: null };
}

export function fastMoneyQuestions(deck: Deck): FastMoneyQuestion[] {
  const picked = deck.fastMoney.slice(0, FAST_MONEY_COUNT);
  if (picked.length > 0) return picked;
  return Array.from({ length: FAST_MONEY_COUNT }, (_, i) => ({
    id: `fm-placeholder-${i + 1}`,
    order: i + 1,
    prompt: `Fast Money question ${i + 1}`,
    answers: [],
  }));
}

export function rankTeams(teams: Team[]): Team[] {
  return teams
    .map((t, i) => ({ t, i }))
    .sort((a, b) => b.t.total - a.t.total || a.i - b.i)
    .map((x) => x.t);
}

export function fastMoneySum(entries: FastMoneyEntry[]): number {
  return entries.reduce((s, e) => s + (e.pointsShown && e.points ? e.points : 0), 0);
}

export function normalizeAnswer(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isDuplicateOfFirst(fm: FastMoneyState, index: number, answer: string): boolean {
  const first = fm.entries[0][index]?.answer ?? '';
  const a = normalizeAnswer(answer);
  return a !== '' && a === normalizeAnswer(first);
}

/** Suggested points for a typed Fast Money answer, from the CSV key. */
export function suggestFastMoneyPoints(q: FastMoneyQuestion | undefined, answer: string): number | null {
  if (!q) return null;
  const a = normalizeAnswer(answer);
  if (!a) return 0;
  const hit = q.answers.find((x) => normalizeAnswer(x.text) === a);
  return hit ? hit.points : null;
}

function updateFm(game: GameState, fn: (fm: FastMoneyState) => FastMoneyState): GameState {
  if (!game.fastMoney) return game;
  return { ...game, fastMoney: fn(game.fastMoney) };
}

function setEntry(
  fm: FastMoneyState,
  player: 0 | 1,
  index: number,
  patch: Partial<FastMoneyEntry>,
): FastMoneyState {
  const entries = [fm.entries[0].slice(), fm.entries[1].slice()] as [FastMoneyEntry[], FastMoneyEntry[]];
  if (!entries[player][index]) return fm;
  entries[player][index] = { ...entries[player][index], ...patch };
  return { ...fm, entries };
}

export function reduce(game: GameState, action: Action, deck: Deck): GameState {
  const r = game.round;
  const question = r ? findQuestion(deck, r.questionId) : undefined;
  const live = game.phase === 'playing' || game.phase === 'steal';

  switch (action.type) {
    case 'correct': {
      if (!r || !question || !live) return game;
      const answer = question.answers.find((a) => a.id === action.answerId);
      if (!answer) return game;
      if (answer.id in r.revealed) return reduce(game, { type: 'wrong' }, deck);

      if (game.phase === 'steal' && r.steal) {
        const stealer = r.steal.queue[r.steal.position];
        const target = r.steal.targetTeamId;
        const piles = { ...r.piles };
        piles[stealer] = (piles[stealer] ?? 0) + answer.points + (piles[target] ?? 0);
        piles[target] = 0;
        const next: GameState = {
          ...game,
          round: { ...r, revealed: { ...r.revealed, [answer.id]: stealer }, piles, stealerTeamId: stealer },
        };
        return bankRound(next, deck, 'stolen');
      }

      const teamId = game.teams[r.turnIndex].id;
      const round: RoundState = {
        ...r,
        revealed: { ...r.revealed, [answer.id]: teamId },
        piles: { ...r.piles, [teamId]: (r.piles[teamId] ?? 0) + answer.points },
        turnIndex: (r.turnIndex + 1) % game.teams.length,
      };
      const next = { ...game, round };
      return allRevealed(round, question) ? bankRound(next, deck, 'cleared') : next;
    }

    case 'wrong': {
      if (!r || !live) return game;
      if (game.phase === 'steal' && r.steal) {
        const failed = r.steal.queue[r.steal.position];
        const position = r.steal.position + 1;
        const next: GameState = {
          ...game,
          round: { ...r, steal: { ...r.steal, targetTeamId: failed, position } },
        };
        return position >= r.steal.queue.length ? bankRound(next, deck, 'defended') : next;
      }
      const struckOut = game.teams[r.turnIndex].id;
      const strikes = r.strikes + 1;
      if (strikes >= 3) return startSteal(game, struckOut);
      return {
        ...game,
        round: { ...r, strikes, turnIndex: (r.turnIndex + 1) % game.teams.length },
      };
    }

    case 'revealOnly': {
      if (!r || !question || game.phase !== 'roundEnd') return game;
      if (action.answerId in r.revealed) return game;
      if (!question.answers.some((a) => a.id === action.answerId)) return game;
      return { ...game, round: { ...r, revealed: { ...r.revealed, [action.answerId]: null } } };
    }

    case 'skipTurn': {
      if (!r || !live) return game;
      if (game.phase === 'steal' && r.steal) {
        return reduce(game, { type: 'wrong' }, deck);
      }
      return { ...game, round: { ...r, turnIndex: (r.turnIndex + 1) % game.teams.length } };
    }

    case 'setTurn': {
      if (!r || game.phase !== 'playing') return game;
      const idx = game.teams.findIndex((t) => t.id === action.teamId);
      if (idx === -1) return game;
      return { ...game, round: { ...r, turnIndex: idx } };
    }

    case 'endRound': {
      if (!r || !live) return game;
      return bankRound(game, deck, 'ended');
    }

    case 'setStealTarget': {
      if (!r || game.phase !== 'steal' || !r.steal || r.steal.position !== 0) return game;
      if (!game.teams.some((t) => t.id === action.teamId)) return game;
      return {
        ...game,
        round: {
          ...r,
          steal: {
            ...r.steal,
            targetTeamId: action.teamId,
            queue: stealQueue(game, action.teamId),
          },
        },
      };
    }

    case 'adjustPile': {
      if (!r) return game;
      const piles = { ...r.piles, [action.teamId]: Math.max(0, (r.piles[action.teamId] ?? 0) + action.delta) };
      const applied = piles[action.teamId] - (r.piles[action.teamId] ?? 0);
      if (r.banked) {
        const delta = applied * r.multiplier;
        return {
          ...game,
          teams: game.teams.map((t) => (t.id === action.teamId ? { ...t, total: t.total + delta } : t)),
          round: { ...r, piles, banked: { ...r.banked, [action.teamId]: (r.banked[action.teamId] ?? 0) + delta } },
        };
      }
      return { ...game, round: { ...r, piles } };
    }

    case 'adjustTotal': {
      return {
        ...game,
        teams: game.teams.map((t) => (t.id === action.teamId ? { ...t, total: t.total + action.delta } : t)),
      };
    }

    case 'selectNext': {
      if (!findQuestion(deck, action.questionId)) return game;
      return { ...game, nextQuestionId: action.questionId };
    }

    case 'nextQuestion': {
      if (game.phase !== 'roundEnd') return game;
      const q = findQuestion(deck, game.nextQuestionId) ?? findQuestion(deck, defaultNextQuestionId(deck, game.usedQuestionIds));
      if (!q) return game;
      const round = makeRound(game, q);
      return {
        ...game,
        phase: 'playing',
        round,
        usedQuestionIds: game.usedQuestionIds.includes(q.id) ? game.usedQuestionIds : [...game.usedQuestionIds, q.id],
        nextQuestionId: null,
      };
    }

    case 'fmOpen': {
      if (game.phase === 'fastMoney' || game.phase === 'winner') return game;
      const banked = live ? bankRound(game, deck, 'ended') : game;
      const ranked = rankTeams(banked.teams);
      const questions = fastMoneyQuestions(deck);
      return {
        ...banked,
        phase: 'fastMoney',
        fastMoney: {
          teamIds: [ranked[0].id, ranked[1].id],
          questionIds: questions.map((q) => q.id),
          stage: 'pick',
          active: 0,
          entries: [emptyEntries(questions.length), emptyEntries(questions.length)],
          timers: [freshTimer(), freshTimer()],
          banked: null,
        },
      };
    }

    case 'fmPick': {
      const [a, b] = action.teamIds;
      if (a === b || !game.teams.some((t) => t.id === a) || !game.teams.some((t) => t.id === b)) return game;
      return updateFm(game, (fm) => (fm.stage === 'pick' ? { ...fm, teamIds: [a, b], stage: 'play', active: 0 } : fm));
    }

    case 'fmRecord':
      return updateFm(game, (fm) =>
        fm.stage === 'play' ? setEntry(fm, fm.active, action.index, { answer: action.answer.trim(), recorded: true }) : fm,
      );

    case 'fmUnrecord':
      return updateFm(game, (fm) =>
        fm.stage === 'play' ? setEntry(fm, fm.active, action.index, { recorded: false }) : fm,
      );

    case 'fmTimer':
      return updateFm(game, (fm) => {
        if (fm.stage !== 'play') return fm;
        const timers = fm.timers.slice() as [FastMoneyTimer, FastMoneyTimer];
        const t = timers[fm.active];
        const running = t.runningSince != null;
        let op = action.op;
        if (op === 'toggle') op = running ? 'pause' : 'start';
        if (op === 'start') {
          if (running || t.remainingMs <= 0) return fm;
          timers[fm.active] = { ...t, runningSince: action.now };
        } else if (op === 'pause') {
          timers[fm.active] = pauseTimer(t, action.now);
        } else {
          timers[fm.active] = freshTimer();
        }
        return { ...fm, timers };
      });

    case 'fmToReveal':
      return updateFm(game, (fm) => {
        if (fm.stage !== 'play') return fm;
        const timers = fm.timers.slice() as [FastMoneyTimer, FastMoneyTimer];
        timers[fm.active] = pauseTimer(timers[fm.active], action.now);
        const entries = [fm.entries[0].slice(), fm.entries[1].slice()] as [FastMoneyEntry[], FastMoneyEntry[]];
        entries[fm.active] = entries[fm.active].map((e) => ({ ...e, recorded: true }));
        return { ...fm, timers, entries, stage: 'reveal' };
      });

    case 'fmShowAnswer':
      return updateFm(game, (fm) =>
        fm.stage === 'reveal' && action.player === fm.active
          ? setEntry(fm, action.player, action.index, { answerShown: true })
          : fm,
      );

    case 'fmSetPoints':
      return updateFm(game, (fm) =>
        fm.stage === 'reveal' && action.player === fm.active
          ? setEntry(fm, action.player, action.index, {
              points: Math.max(0, Math.round(action.points)),
              pointsShown: true,
              answerShown: true,
            })
          : fm,
      );

    case 'fmNextFamily':
      return updateFm(game, (fm) => (fm.stage === 'reveal' && fm.active === 0 ? { ...fm, active: 1, stage: 'play' } : fm));

    case 'fmBank': {
      const fm = game.fastMoney;
      if (!fm || fm.banked || fm.stage !== 'reveal' || fm.active !== 1) return game;
      const sums: [number, number] = [fastMoneySum(fm.entries[0]), fastMoneySum(fm.entries[1])];
      const teams = game.teams.map((t) => {
        const i = fm.teamIds.indexOf(t.id);
        return i === -1 ? t : { ...t, total: t.total + sums[i] };
      });
      const best = Math.max(...teams.map((t) => t.total));
      return {
        ...game,
        teams,
        phase: 'winner',
        fastMoney: { ...fm, banked: sums },
        winnerTeamIds: teams.filter((t) => t.total === best).map((t) => t.id),
      };
    }
  }
}
