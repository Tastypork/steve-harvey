export interface Answer {
  id: string;
  text: string;
  points: number;
}

export interface Question {
  id: string;
  round: number;
  prompt: string;
  answers: Answer[];
}

export interface FastMoneyAnswer {
  text: string;
  points: number;
}

export interface FastMoneyQuestion {
  id: string;
  order: number;
  prompt: string;
  answers: FastMoneyAnswer[];
}

export interface FastMoneyFile {
  name: string;
  questions: FastMoneyQuestion[];
}

export interface Deck {
  questions: Question[];
  fastMoney: FastMoneyQuestion[];
  roundsSource: string;
  fastMoneySource: string;
  /** CSV sets found in public/data/fast-money. The active set is `fastMoney`. */
  fastMoneyFiles?: FastMoneyFile[];
}

export interface Team {
  id: string;
  name: string;
  personaId: string;
  total: number;
}

export type Phase = 'playing' | 'steal' | 'roundEnd' | 'fastMoney' | 'winner';

export interface StealState {
  /** Family whose pile can be taken. The family that just struck, then each family that misses the steal. */
  targetTeamId: string;
  struckOutTeamId: string;
  queue: string[];
  position: number;
}

export type RoundOutcome = 'cleared' | 'stolen' | 'defended' | 'ended' | 'empty';

export interface RoundState {
  questionId: string;
  number: number;
  multiplier: number;
  startTeamIndex: number;
  turnIndex: number;
  strikes: number;
  /** answerId -> teamId that earned it, or null when revealed with no award */
  revealed: Record<string, string | null>;
  piles: Record<string, number>;
  steal: StealState | null;
  outcome: RoundOutcome | null;
  /** teamId -> points added to the match total when the round banked */
  banked: Record<string, number> | null;
  stealerTeamId: string | null;
}

export interface FastMoneyEntry {
  answer: string;
  recorded: boolean;
  answerShown: boolean;
  points: number | null;
  pointsShown: boolean;
}

export interface FastMoneyTimer {
  durationMs: number;
  remainingMs: number;
  runningSince: number | null;
}

export type FastMoneyStage = 'pick' | 'play' | 'reveal';

export interface FastMoneyState {
  teamIds: [string, string];
  questionIds: string[];
  stage: FastMoneyStage;
  active: 0 | 1;
  entries: [FastMoneyEntry[], FastMoneyEntry[]];
  timers: [FastMoneyTimer, FastMoneyTimer];
  banked: [number, number] | null;
}

export interface GameState {
  version: 1;
  id: string;
  createdAt: number;
  phase: Phase;
  teams: Team[];
  usedQuestionIds: string[];
  roundsPlayed: number;
  round: RoundState | null;
  nextQuestionId: string | null;
  fastMoney: FastMoneyState | null;
  winnerTeamIds: string[];
}

export interface TeamSetup {
  name: string;
  personaId: string;
}
