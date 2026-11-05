import { useEffect, useRef, useState } from 'react';
import { Check, Pause, Play, RotateCcw, Trophy, Eye } from 'lucide-react';
import { personaImage } from '../assets';
import { play, playAnswer } from '../audio/sounds';
import {
  fastMoneyQuestions,
  fastMoneySum,
  isDuplicateOfFirst,
  rankTeams,
  suggestFastMoneyPoints,
  timerRemaining,
} from '../game/engine';
import { useSaved } from '../game/store';
import type { FastMoneyState, FastMoneyTimer, GameState } from '../game/types';
import { dispatch } from '../ui/actions';
import { fx } from '../ui/fx';

function useNow(running: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [running]);
  return running ? now : Date.now();
}

function Clock({ timer }: { timer: FastMoneyTimer }) {
  const running = timer.runningSince != null;
  const now = useNow(running);
  const left = timerRemaining(timer, now);
  const fired = useRef(false);

  useEffect(() => {
    if (running && left <= 0 && !fired.current) {
      fired.current = true;
      void play('buzzer');
      dispatch({ type: 'fmTimer', op: 'pause', now: Date.now() });
      fx.toast("Time's up!");
    }
    if (left > 0) fired.current = false;
  }, [running, left]);

  const secs = Math.ceil(left / 1000);
  return (
    <div className={`fm-clock ${running ? 'is-running' : ''} ${secs <= 5 ? 'is-low' : ''}`} aria-label={`${secs} seconds left`}>
      {secs}
    </div>
  );
}

function Pick({ game }: { game: GameState }) {
  const fm = game.fastMoney!;
  const ranked = rankTeams(game.teams);
  const [a, setA] = useState(fm.teamIds[0]);
  const [b, setB] = useState(fm.teamIds[1]);
  const tieAtCut = ranked.length > 2 && ranked[1].total === ranked[2].total;
  const tieTop = ranked[0].total === ranked[1].total;

  return (
    <div className="fm-pick">
      <h2 className="fm-title">Fast Money</h2>
      <ol className="fm-standings">
        {ranked.map((t) => (
          <li key={t.id} className={t.id === a || t.id === b ? 'is-in' : ''}>
            <img src={personaImage(t.personaId)} alt="" />
            <span>{t.name}</span>
            <b>{t.total}</b>
          </li>
        ))}
      </ol>
      {tieAtCut || tieTop ? (
        <p className="warn-line">
          {tieAtCut ? 'Second place is tied. ' : ''}
          {tieTop ? 'First place is tied, so choose who plays first. ' : ''}
          Break the tie below before the clock starts.
        </p>
      ) : null}
      <div className="fm-pick-row">
        <label>
          <span className="field-label">Plays first</span>
          <select className="text-input" value={a} onChange={(e) => setA(e.target.value)}>
            {game.teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="field-label">Plays second</span>
          <select className="text-input" value={b} onChange={(e) => setB(e.target.value)}>
            {game.teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <button className="show-btn is-gold" disabled={a === b} onClick={() => dispatch({ type: 'fmPick', teamIds: [a, b] })}>
          <Play size={20} /> Start Fast Money
        </button>
      </div>
    </div>
  );
}

function AnswerInput({ fm, index, autoFocus }: { fm: FastMoneyState; index: number; autoFocus: boolean }) {
  const [value, setValue] = useState(fm.entries[fm.active][index].answer);
  const [dupWarned, setDupWarned] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  const record = () => {
    if (fm.active === 1 && isDuplicateOfFirst(fm, index, value) && !dupWarned) {
      void play('buzzer');
      setDupWarned(true);
      return;
    }
    dispatch({ type: 'fmRecord', index, answer: value });
  };

  return (
    <div className={`fm-entry ${dupWarned ? 'is-dup' : ''}`}>
      <input
        ref={ref}
        className="fm-input"
        value={value}
        placeholder="Type answer, Enter"
        onChange={(e) => {
          setValue(e.target.value);
          setDupWarned(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            record();
          }
          if (e.code === 'Space' && !value) {
            e.preventDefault();
            dispatch({ type: 'fmTimer', op: 'toggle', now: Date.now() });
          }
        }}
        aria-label={`Answer ${index + 1}`}
      />
      {dupWarned ? <span className="fm-dup">Duplicate. Try again, or Enter to keep it</span> : null}
    </div>
  );
}

function PointsInput({ suggested, onReveal }: { suggested: number | null; onReveal: (n: number) => void }) {
  const [value, setValue] = useState(suggested == null ? '' : String(suggested));
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const n = Number.parseInt(value, 10);
  return (
    <form
      className="fm-points-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (Number.isFinite(n)) onReveal(n);
      }}
    >
      <input
        ref={ref}
        className="fm-points-input"
        inputMode="numeric"
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, ''))}
        placeholder="pts"
        aria-label="Points"
      />
      <button className="chip-btn" type="submit" disabled={!Number.isFinite(n)}>
        Reveal
      </button>
    </form>
  );
}

export function FastMoney() {
  const { session } = useSaved();
  if (!session?.game.fastMoney) return null;
  const { game, deck } = session;
  const fm = game.fastMoney!;
  if (fm.stage === 'pick') return <Pick game={game} />;

  const questions = fastMoneyQuestions(deck);
  const teams = fm.teamIds.map((id) => game.teams.find((t) => t.id === id)!);
  const active = fm.active;
  const entries = fm.entries[active];
  const firstOpen = entries.findIndex((e) => !e.recorded);
  const firstUnrevealed = entries.findIndex((e) => !e.pointsShown);
  const sums = [fastMoneySum(fm.entries[0]), fastMoneySum(fm.entries[1])];
  const timer = fm.timers[active];
  const running = timer.runningSince != null;

  const revealPoints = (index: number, n: number) => {
    dispatch({ type: 'fmSetPoints', player: active, index, points: n });
    if (n > 0) playAnswer();
    else void play('buzzer');
  };

  const cell = (player: 0 | 1, index: number) => {
    const e = fm.entries[player][index];
    const hidden = player === 0 && active === 1 && fm.stage === 'play';
    if (player > active) return <div className="fm-cell is-blank" />;
    if (hidden) return <div className="fm-cell is-covered" />;

    if (player === active && fm.stage === 'play') {
      if (!e.recorded) return <div className="fm-cell is-input"><AnswerInput fm={fm} index={index} autoFocus={index === firstOpen} /></div>;
      return (
        <button className="fm-cell is-recorded" onClick={() => dispatch({ type: 'fmUnrecord', index })} title="Click to edit">
          <Check size={20} /> {e.answer ? 'Recorded' : 'Pass'}
        </button>
      );
    }

    if (player === active && fm.stage === 'reveal' && !e.answerShown) {
      return (
        <button className="fm-cell is-recorded" onClick={() => dispatch({ type: 'fmShowAnswer', player, index })}>
          <Eye size={20} /> Show answer
        </button>
      );
    }

    const dup = player === 1 && isDuplicateOfFirst(fm, index, e.answer);
    return (
      <div className="fm-cell is-shown">
        <span className="fm-answer">{e.answer || '-'}</span>
        {e.pointsShown ? (
          <span className={`fm-points ${e.points ? '' : 'is-zero'}`}>{e.points ?? 0}</span>
        ) : player === active ? (
          <PointsInput
            suggested={dup || !e.answer ? 0 : suggestFastMoneyPoints(questions[index], e.answer)}
            onReveal={(n) => revealPoints(index, n)}
          />
        ) : null}
      </div>
    );
  };

  return (
    <div className="fm">
      <div className="fm-head">
        <h2 className="fm-title">Fast Money</h2>
        <div className="fm-player">
          <img src={personaImage(teams[active].personaId)} alt="" />
          <span>{teams[active].name}</span>
        </div>
        {fm.stage === 'play' ? <Clock timer={timer} /> : <div className="fm-clock is-done">{Math.ceil(timer.remainingMs / 1000)}</div>}
      </div>

      <div className="fm-sheet">
        <div className="fm-row fm-row-head">
          <span />
          {teams.map((t, i) => (
            <span key={t.id} className={`fm-col-name ${i === active ? 'is-active' : ''}`}>
              {t.name}
            </span>
          ))}
        </div>
        {questions.map((q, i) => (
          <div className="fm-row" key={q.id}>
            <span className="fm-q">
              <b>{i + 1}</b> {q.prompt}
            </span>
            {cell(0, i)}
            {cell(1, i)}
          </div>
        ))}
        <div className="fm-row fm-row-total">
          <span className="fm-total-label">Total</span>
          <span className="fm-total">{sums[0]}</span>
          <span className="fm-total">{active === 1 ? sums[1] : ''}</span>
        </div>
      </div>

      <div className="fm-controls">
        {fm.stage === 'play' ? (
          <>
            <button
              className="show-btn"
              onClick={() => dispatch({ type: 'fmTimer', op: 'toggle', now: Date.now() })}
              disabled={!running && timer.remainingMs <= 0}
            >
              {running ? <Pause size={20} /> : <Play size={20} />} {running ? 'Pause clock' : 'Start clock'} <kbd>Space</kbd>
            </button>
            <button className="show-btn is-quiet" onClick={() => dispatch({ type: 'fmTimer', op: 'reset', now: Date.now() })}>
              <RotateCcw size={18} /> Reset clock
            </button>
            <button className="show-btn is-gold" onClick={() => dispatch({ type: 'fmToReveal', now: Date.now() })}>
              <Eye size={20} /> Reveal answers
            </button>
          </>
        ) : active === 0 ? (
          <button
            className="show-btn is-gold"
            onClick={() => {
              if (firstUnrevealed !== -1 && !window.confirm('Some answers are not revealed yet. Move on anyway?')) return;
              dispatch({ type: 'fmNextFamily' });
            }}
          >
            <Play size={20} /> {teams[1].name}'s turn
          </button>
        ) : (
          <button
            className="show-btn is-gold"
            onClick={() => {
              if (firstUnrevealed !== -1 && !window.confirm('Some answers are not revealed yet. Bank the points anyway?')) return;
              dispatch({ type: 'fmBank' });
            }}
          >
            <Trophy size={20} /> Bank Fast Money
          </button>
        )}
      </div>
    </div>
  );
}
