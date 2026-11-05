import { useEffect } from 'react';
import { play, SOUND_KEYS } from '../audio/sounds';
import { store } from '../game/store';
import { voice } from '../voice/realtime';
import { dispatch, isLive, markWrong, slabAction, undo } from './actions';
import { fx } from './fx';

function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen().catch(() => undefined);
}

export function useHotkeys(inGame: boolean) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        fx.setHelp(false);
        if (typing(e.target)) (e.target as HTMLElement).blur();
        return;
      }
      if (typing(e.target) || e.altKey) return;

      const digit = /^(Digit|Numpad)([0-9])$/.exec(e.code);
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.code === 'KeyZ' && !e.shiftKey) {
        if (!inGame) return;
        e.preventDefault();
        undo();
        return;
      }
      if (mod) return;

      if (digit && !e.shiftKey) {
        const s = SOUND_KEYS.find((k) => k.key === digit[2]);
        if (s) {
          e.preventDefault();
          void play(s.name);
        }
        return;
      }
      if (e.key === '?' || (e.shiftKey && e.code === 'Slash')) {
        fx.setHelp(!fx.get().helpOpen);
        return;
      }
      if (e.code === 'KeyF') {
        toggleFullscreen();
        return;
      }
      if (!inGame) return;

      const game = store.get().session?.game;
      if (digit && e.shiftKey) {
        const n = Number(digit[2]);
        if (n >= 1) {
          e.preventDefault();
          slabAction(n - 1);
        }
        return;
      }
      if (e.code === 'KeyX' && isLive(game)) {
        e.preventDefault();
        markWrong('miss');
        return;
      }
      if (e.code === 'KeyN' && isLive(game)) {
        e.preventDefault();
        if (game?.phase === 'steal') markWrong('miss');
        else dispatch({ type: 'skipTurn' });
        return;
      }
      if (e.code === 'KeyM' && voice.get().available) {
        e.preventDefault();
        voice.toggle();
        return;
      }
      if (e.code === 'Space' && game?.phase === 'fastMoney' && game.fastMoney?.stage === 'play') {
        e.preventDefault();
        dispatch({ type: 'fmTimer', op: 'toggle', now: Date.now() });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inGame]);
}

export const SHORTCUTS: { keys: string; what: string }[] = [
  ...SOUND_KEYS.map((k) => ({ keys: k.key, what: k.label })),
  { keys: 'Shift + 1-8', what: 'Award that answer to the family at the podium (after the round: reveal it)' },
  { keys: 'Shift + click', what: 'Same as above, on a face-down slab' },
  { keys: 'X', what: 'Strike (or a missed steal)' },
  { keys: 'N', what: 'Skip to the next family' },
  { keys: 'Ctrl + Z', what: 'Undo the last step' },
  { keys: 'M', what: 'Mic on or off' },
  { keys: 'Space', what: 'Start or pause the Fast Money clock' },
  { keys: 'F', what: 'Full screen' },
  { keys: '?', what: 'This help' },
];
