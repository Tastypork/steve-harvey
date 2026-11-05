import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Download,
  Flag,
  FolderOpen,
  Keyboard,
  Maximize,
  Menu,
  Mic,
  MicOff,
  RotateCcw,
  Send,
  SkipForward,
  SlidersHorizontal,
  Upload,
  X,
  Zap,
  Home,
  Trash2,
} from 'lucide-react';
import { deckWithFastMoneyFile, deckWithRoundsFile, downloadText, pickFile } from '../game/deck';
import { currentTeamId } from '../game/engine';
import { store, useSaved } from '../game/store';
import { dispatch, isLive, judgeTyped, markWrong, undo } from '../ui/actions';
import { fx } from '../ui/fx';
import { toggleFullscreen } from '../ui/hotkeys';
import { useVoice, voice } from '../voice/realtime';

function Popover({ open, onClose, children, label }: { open: boolean; onClose: () => void; children: ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.parentElement?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="popover" ref={ref} role="dialog" aria-label={label}>
      {children}
    </div>
  );
}

function Nudge({ label, value, onDelta }: { label: string; value: number; onDelta: (d: number) => void }) {
  return (
    <div className="nudge">
      <span className="nudge-label">{label}</span>
      <button onClick={() => onDelta(-10)}>-10</button>
      <button onClick={() => onDelta(-1)}>-1</button>
      <b>{value}</b>
      <button onClick={() => onDelta(1)}>+1</button>
      <button onClick={() => onDelta(10)}>+10</button>
    </div>
  );
}

export function HostBar({ onExit }: { onExit: () => void }) {
  const { session, past } = useSaved();
  const v = useVoice();
  const [guess, setGuess] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<'scores' | 'menu' | null>(null);
  if (!session) return null;
  const { game, deck } = session;
  const live = isLive(game);
  const round = game.round;
  const close = () => setOpen(null);

  const micLabel = !v.available
    ? 'Manual only'
    : v.status === 'live'
      ? 'Listening for "Harvey"'
      : v.status === 'connecting'
        ? 'Connecting...'
        : v.status === 'reconnecting'
          ? 'Reconnecting...'
          : v.status === 'error'
            ? 'Mic problem'
            : 'Mic off';

  const submitGuess = async () => {
    if (!guess.trim() || busy) return;
    setBusy(true);
    await judgeTyped(guess);
    setBusy(false);
    setGuess('');
  };

  const goFastMoney = () => {
    if (live && !window.confirm('End this round now, bank its points, and go to Fast Money?')) return;
    dispatch({ type: 'fmOpen' });
  };

  const loadCsv = async (kind: 'rounds' | 'fm') => {
    close();
    const file = await pickFile('.csv,text/csv');
    if (!file) return;
    try {
      const r = kind === 'rounds' ? await deckWithRoundsFile(deck, file) : await deckWithFastMoneyFile(deck, file);
      store.setSessionDeck(r.deck);
      store.setSetupDeck(r.deck);
      fx.toast(r.warnings[0] ?? `Loaded ${file.name}. New questions show up in "Up next".`, r.warnings.length ? 'warn' : 'info', 6000);
    } catch (err) {
      fx.toast(`Could not read ${file.name}: ${err instanceof Error ? err.message : err}`, 'error');
    }
  };

  const stealTargetPick =
    game.phase === 'steal' && round?.steal && round.steal.position === 0 ? (
      <label className="bar-select">
        <span>Target</span>
        <select
          value={round.steal.targetTeamId}
          onChange={(e) => dispatch({ type: 'setStealTarget', teamId: e.target.value })}
        >
          {game.teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({round.piles[t.id] ?? 0})
            </option>
          ))}
        </select>
      </label>
    ) : null;

  return (
    <footer className="hostbar" aria-label="Host controls">
      <div className="bar-group">
        <button
          className={`bar-btn mic is-${v.status}`}
          disabled={!v.available}
          onClick={() => voice.toggle()}
          title={v.error ?? (v.available ? 'Toggle the mic (M)' : 'Add XAI_API_KEY to .env to use voice')}
        >
          {v.status === 'off' || !v.available ? <MicOff size={16} /> : <Mic size={16} />}
          <span>{micLabel}</span>
        </button>
        {v.lastHeard ? (
          <span className="heard" title={v.lastHeard}>
            "{v.lastHeard}"
          </span>
        ) : null}
        <form
          className="guess-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submitGuess();
          }}
        >
          <input
            className="bar-input"
            value={guess}
            onChange={(e) => setGuess(e.target.value)}
            placeholder={v.available ? (live ? 'Type a guess for Harvey' : 'No guess in play') : 'Typed judge needs a key'}
            disabled={!v.available || !live || busy}
            aria-label="Type a guess"
          />
          <button className="bar-btn" type="submit" disabled={!v.available || !live || busy || !guess.trim()} aria-label="Judge guess">
            <Send size={15} />
          </button>
        </form>
      </div>

      <div className="bar-group">
        {stealTargetPick}
        <button className="bar-btn" disabled={!live} onClick={() => markWrong('miss')} title="Strike (X)">
          <X size={16} /> <span>Strike</span>
        </button>
        <button
          className="bar-btn"
          disabled={!live}
          onClick={() => (game.phase === 'steal' ? markWrong('miss') : dispatch({ type: 'skipTurn' }))}
          title="Next family (N)"
        >
          <SkipForward size={16} /> <span>Next family</span>
        </button>
        <button
          className="bar-btn"
          disabled={!live}
          onClick={() => {
            if (window.confirm('End this round now and bank what each family has?')) dispatch({ type: 'endRound' });
          }}
        >
          <Flag size={16} /> <span>End round</span>
        </button>
        <button className="bar-btn" disabled={past.length === 0} onClick={undo} title="Undo (Ctrl+Z)">
          <RotateCcw size={16} /> <span>Undo</span>
        </button>
      </div>

      <div className="bar-group">
        <div className="pop-anchor">
          <button className="bar-btn" onClick={() => setOpen(open === 'scores' ? null : 'scores')} aria-expanded={open === 'scores'}>
            <SlidersHorizontal size={16} /> <span>Scores</span>
          </button>
          <Popover open={open === 'scores'} onClose={close} label="Adjust scores">
            <h3>Adjust scores</h3>
            {game.teams.map((t) => (
              <div className="nudge-row" key={t.id}>
                <span className="nudge-team">
                  {t.name}
                  {t.id === currentTeamId(game) ? <em> (up)</em> : null}
                </span>
                {round ? (
                  <Nudge
                    label="Round"
                    value={round.piles[t.id] ?? 0}
                    onDelta={(d) => dispatch({ type: 'adjustPile', teamId: t.id, delta: d })}
                  />
                ) : null}
                <Nudge label="Match" value={t.total} onDelta={(d) => dispatch({ type: 'adjustTotal', teamId: t.id, delta: d })} />
              </div>
            ))}
            <p className="pop-note">After the round banks, round changes update the match total at x{round?.multiplier ?? 1}.</p>
          </Popover>
        </div>

        {game.phase !== 'fastMoney' && game.phase !== 'winner' ? (
          <button className="bar-btn is-gold" onClick={goFastMoney}>
            <Zap size={16} /> <span>Fast Money</span>
          </button>
        ) : null}

        <div className="pop-anchor">
          <button className="bar-btn" onClick={() => setOpen(open === 'menu' ? null : 'menu')} aria-expanded={open === 'menu'} aria-label="Menu">
            <Menu size={16} />
          </button>
          <Popover open={open === 'menu'} onClose={close} label="Menu">
            <button className="menu-item" onClick={() => { close(); toggleFullscreen(); }}>
              <Maximize size={16} /> Full screen <kbd>F</kbd>
            </button>
            <button className="menu-item" onClick={() => { close(); fx.setHelp(true); }}>
              <Keyboard size={16} /> Shortcuts <kbd>?</kbd>
            </button>
            <button className="menu-item" onClick={() => void loadCsv('rounds')}>
              <Upload size={16} /> Load rounds CSV
            </button>
            <button className="menu-item" onClick={() => void loadCsv('fm')}>
              <Upload size={16} /> Load Fast Money CSV
            </button>
            <button
              className="menu-item"
              onClick={() => {
                close();
                downloadText(`family-fued-save-${new Date().toISOString().slice(0, 19).replace(/:/g, '')}.json`, store.exportJson());
              }}
            >
              <Download size={16} /> Download save
            </button>
            <button
              className="menu-item"
              onClick={async () => {
                close();
                const file = await pickFile('.json,application/json');
                if (!file) return;
                if (!window.confirm('Replace the current game with this save?')) return;
                const err = store.importJson(await file.text());
                fx.toast(err ?? 'Save loaded.', err ? 'error' : 'info');
              }}
            >
              <FolderOpen size={16} /> Load save
            </button>
            <button className="menu-item" onClick={() => { close(); voice.stop(); onExit(); }}>
              <Home size={16} /> Back to setup (keeps game)
            </button>
            <button
              className="menu-item is-danger"
              onClick={() => {
                close();
                if (!window.confirm('End this game for good and start over? Download the save first if you need it.')) return;
                voice.stop();
                store.clearSession();
                onExit();
              }}
            >
              <Trash2 size={16} /> New game
            </button>
          </Popover>
        </div>
      </div>
      {store.saveError() ? <div className="bar-error">{store.saveError()}</div> : null}
    </footer>
  );
}
