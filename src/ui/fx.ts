import { useSyncExternalStore } from 'react';
import type { HostPose } from '../assets';

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'warn' | 'error';
}

interface FxState {
  pose: HostPose;
  caption: string;
  /** Pose is in a timed correct/incorrect reaction. */
  reacting: boolean;
  /** Strike flash: how many X's to slam, and a nonce to retrigger. */
  flash: { count: number; nonce: number } | null;
  toasts: Toast[];
  helpOpen: boolean;
}

let state: FxState = { pose: 'idle', caption: '', reacting: false, flash: null, toasts: [], helpOpen: false };
const listeners = new Set<() => void>();
let poseTimer: ReturnType<typeof setTimeout> | null = null;
let flashTimer: ReturnType<typeof setTimeout> | null = null;
let toastId = 0;
const afterReaction: Array<() => void> = [];

function set(patch: Partial<FxState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export const fx = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },

  react(pose: 'correct' | 'incorrect', caption: string, ms = pose === 'correct' ? 3200 : 2600) {
    if (poseTimer) clearTimeout(poseTimer);
    set({ pose, caption, reacting: true });
    poseTimer = setTimeout(() => {
      poseTimer = null;
      set({ pose: 'idle', caption: '', reacting: false });
      const queued = afterReaction.splice(0);
      queued.forEach((fn) => fn());
    }, ms);
  },

  /** Held pose with no timeout, e.g. the winner screen. */
  hold(pose: HostPose, caption = '') {
    if (poseTimer) clearTimeout(poseTimer);
    poseTimer = null;
    set({ pose, caption, reacting: false });
  },

  listening(caption = 'Listening...') {
    if (state.reacting) return;
    set({ pose: 'listening', caption });
  },

  idle() {
    if (state.reacting) return;
    set({ pose: 'idle', caption: '' });
  },

  /** Run now, or once the current reaction finishes. Returns true when queued. */
  whenFree(fn: () => void): boolean {
    if (!state.reacting) {
      fn();
      return false;
    }
    afterReaction.length = 0;
    afterReaction.push(fn);
    return true;
  },

  hasQueued: () => afterReaction.length > 0,

  strike(count: number) {
    if (flashTimer) clearTimeout(flashTimer);
    set({ flash: { count, nonce: Date.now() } });
    flashTimer = setTimeout(() => set({ flash: null }), 1300);
  },

  toast(text: string, tone: Toast['tone'] = 'info', ms = 3800) {
    const id = ++toastId;
    set({ toasts: [...state.toasts.slice(-3), { id, text, tone }] });
    setTimeout(() => set({ toasts: state.toasts.filter((t) => t.id !== id) }), ms);
  },

  setHelp(open: boolean) {
    set({ helpOpen: open });
  },
};

export function useFx(): FxState {
  return useSyncExternalStore(fx.subscribe, fx.get, fx.get);
}
