import { useSyncExternalStore } from 'react';
import { createGame, reduce, type Action } from './engine';
import type { Deck, GameState, TeamSetup } from './types';

const KEY = 'wf-family-fued:v1';
const MAX_UNDO = 60;
const NOT_UNDOABLE = new Set<Action['type']>(['fmTimer']);

export interface Session {
  deck: Deck;
  game: GameState;
}

export interface Saved {
  version: 1;
  savedAt: number;
  session: Session | null;
  past: GameState[];
  setupDeck: Deck | null;
}

function empty(): Saved {
  return { version: 1, savedAt: Date.now(), session: null, past: [], setupDeck: null };
}

function isDeck(d: unknown): d is Deck {
  const x = d as Deck;
  return !!x && Array.isArray(x.questions) && Array.isArray(x.fastMoney);
}

function isGame(g: unknown): g is GameState {
  const x = g as GameState;
  return !!x && x.version === 1 && Array.isArray(x.teams) && typeof x.phase === 'string';
}

export function validateSaved(raw: unknown): Saved | null {
  const x = raw as Saved;
  if (!x || x.version !== 1) return null;
  const session =
    x.session && isDeck(x.session.deck) && isGame(x.session.game)
      ? { deck: x.session.deck, game: x.session.game }
      : null;
  return {
    version: 1,
    savedAt: typeof x.savedAt === 'number' ? x.savedAt : Date.now(),
    session,
    past: Array.isArray(x.past) ? x.past.filter(isGame).slice(-MAX_UNDO) : [],
    setupDeck: isDeck(x.setupDeck) ? x.setupDeck : null,
  };
}

function load(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    return validateSaved(JSON.parse(raw)) ?? empty();
  } catch (err) {
    console.error('Could not read saved game', err);
    return empty();
  }
}

let state: Saved = typeof localStorage === 'undefined' ? empty() : load();
let saveError: string | null = null;
const listeners = new Set<() => void>();

function persist() {
  if (typeof localStorage === 'undefined') return;
  const write = (s: Saved) => localStorage.setItem(KEY, JSON.stringify(s));
  try {
    write(state);
    saveError = null;
  } catch {
    try {
      state = { ...state, past: state.past.slice(-10) };
      write(state);
      saveError = null;
    } catch (err) {
      saveError = 'Browser storage is full; the game keeps running but is not being saved.';
      console.error(err);
    }
  }
}

function set(next: Saved) {
  state = { ...next, savedAt: Date.now() };
  persist();
  listeners.forEach((l) => l());
}

export const store = {
  get: () => state,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  saveError: () => saveError,

  dispatch(action: Action): GameState | null {
    const s = state.session;
    if (!s) return null;
    let next: GameState;
    try {
      next = reduce(s.game, action, s.deck);
    } catch (err) {
      console.error('Game action failed', action, err);
      return s.game;
    }
    if (next === s.game) return next;
    const past = NOT_UNDOABLE.has(action.type) ? state.past : [...state.past, s.game].slice(-MAX_UNDO);
    set({ ...state, session: { ...s, game: next }, past });
    return next;
  },

  /** Replace game state directly, as an undoable step. For manual repairs. */
  replaceGame(game: GameState) {
    const s = state.session;
    if (!s) return;
    set({ ...state, session: { ...s, game }, past: [...state.past, s.game].slice(-MAX_UNDO) });
  },

  undo(): boolean {
    const s = state.session;
    if (!s || state.past.length === 0) return false;
    const prev = state.past[state.past.length - 1];
    set({ ...state, session: { ...s, game: prev }, past: state.past.slice(0, -1) });
    return true;
  },

  canUndo: () => state.past.length > 0,

  startGame(teams: TeamSetup[], deck: Deck, firstQuestionId?: string | null) {
    const game = createGame(teams, deck, firstQuestionId);
    set({ ...state, session: { deck, game }, past: [] });
  },

  setSetupDeck(deck: Deck) {
    set({ ...state, setupDeck: deck });
  },

  /** Keeps the current game's deck in sync when the host loads a CSV mid-game. */
  setSessionDeck(deck: Deck) {
    const s = state.session;
    if (!s) return;
    set({ ...state, session: { ...s, deck } });
  },

  clearSession() {
    set({ ...state, session: null, past: [] });
  },

  exportJson(): string {
    return JSON.stringify(state, null, 2);
  },

  importJson(text: string): string | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return 'That file is not valid JSON.';
    }
    const valid = validateSaved(parsed);
    if (!valid) return 'That file is not a Wells Fargo Family Fued save.';
    set(valid);
    return null;
  },
};

export function useSaved(): Saved {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
