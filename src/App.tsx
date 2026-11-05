import { useEffect, useState } from 'react';
import { unlockAudio } from './audio/sounds';
import { Setup } from './components/Setup';
import { Stage } from './components/Stage';
import { HelpOverlay, Toasts } from './components/Overlays';
import { useSaved } from './game/store';
import { useHotkeys } from './ui/hotkeys';

const VIEW_KEY = 'wf-family-fued:view';

function initialView(): 'setup' | 'game' {
  try {
    return sessionStorage.getItem(VIEW_KEY) === 'game' ? 'game' : 'setup';
  } catch {
    return 'setup';
  }
}

export function App() {
  const saved = useSaved();
  const [view, setViewState] = useState<'setup' | 'game'>(initialView);
  const inGame = view === 'game' && !!saved.session;

  const setView = (v: 'setup' | 'game') => {
    setViewState(v);
    try {
      sessionStorage.setItem(VIEW_KEY, v);
    } catch {
      /* private mode: refresh lands on setup, which can still resume */
    }
  };

  useHotkeys(inGame);

  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  return (
    <>
      {inGame ? <Stage onExit={() => setView('setup')} /> : <Setup onEnter={() => setView('game')} />}
      <Toasts />
      <HelpOverlay />
    </>
  );
}
