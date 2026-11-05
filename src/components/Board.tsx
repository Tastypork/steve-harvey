import { ArrowRight, Zap } from 'lucide-react';
import { personaImage } from '../assets';
import {
  boardPot,
  currentTeamId,
  findQuestion,
  multiplierFor,
  multiplierLabel,
} from '../game/engine';
import { useSaved } from '../game/store';
import type { GameState, Question, RoundState } from '../game/types';
import { dispatch, isLive, slabAction } from '../ui/actions';
import { fx, useFx } from '../ui/fx';
import { TeamPlate, type PlateRole } from './TeamPlate';

function StrikeX({ on }: { on: boolean }) {
  return (
    <svg className={`strike ${on ? 'is-on' : ''}`} viewBox="0 0 100 100" aria-hidden="true">
      <path d="M22 14 L50 42 L78 14 L86 22 L58 50 L86 78 L78 86 L50 58 L22 86 L14 78 L42 50 L14 22 Z" />
    </svg>
  );
}

function StrikeFlash() {
  const { flash } = useFx();
  if (!flash) return null;
  return (
    <div className="strike-flash" key={flash.nonce} aria-hidden="true">
      {Array.from({ length: flash.count }, (_, i) => (
        <StrikeX key={i} on />
      ))}
    </div>
  );
}

function teamName(game: GameState, id: string | null | undefined) {
  return game.teams.find((t) => t.id === id)?.name ?? '';
}

function Callout({ game, round }: { game: GameState; round: RoundState }) {
  const upId = currentTeamId(game);
  const up = game.teams.find((t) => t.id === upId);

  if (game.phase === 'steal' && round.steal && up) {
    const target = round.steal.targetTeamId;
    return (
      <div className="callout is-steal">
        <span className="callout-tag">Steal</span>
        <img src={personaImage(up.personaId)} alt="" />
        <span>
          {up.name} can steal <b>{round.piles[target] ?? 0}</b> from {teamName(game, target)}
        </span>
      </div>
    );
  }

  if (game.phase === 'playing' && up) {
    return (
      <div className="callout">
        <img src={personaImage(up.personaId)} alt="" />
        <span>{up.name}, your answer?</span>
      </div>
    );
  }

  if (game.phase === 'roundEnd' && round.banked) {
    const winners = game.teams
      .map((t) => ({ t, amount: round.banked?.[t.id] ?? 0 }))
      .filter((x) => x.amount > 0)
      .sort((a, b) => b.amount - a.amount);
    let headline = 'Round over';
    if (round.outcome === 'stolen') headline = `${teamName(game, round.stealerTeamId)} steals it!`;
    if (round.outcome === 'defended') headline = 'No one stole it.';
    if (round.outcome === 'cleared') headline = 'Board cleared!';
    if (round.outcome === 'empty') headline = 'Nobody scored this round';
    return (
      <div className="callout is-result">
        <span className="callout-tag">{headline}</span>
        <span>
          {winners.length
            ? winners.map((w) => `${w.t.name} +${w.amount}`).join('  ·  ')
            : 'No points banked'}
        </span>
      </div>
    );
  }
  return null;
}

function RoundEndControls({ game, questions }: { game: GameState; questions: Question[] }) {
  const nextNumber = game.roundsPlayed + 1;
  const m = multiplierFor(nextNumber);
  const nextId = game.nextQuestionId;
  const unused = questions.filter((q) => !game.usedQuestionIds.includes(q.id));
  const used = questions.filter((q) => game.usedQuestionIds.includes(q.id));
  const canNext = !!nextId;

  return (
    <div className="round-end">
      <label className="next-pick">
        <span className="field-label">Up next</span>
        <select
          className="text-input"
          value={nextId ?? ''}
          onChange={(e) => e.target.value && dispatch({ type: 'selectNext', questionId: e.target.value })}
        >
          {!nextId ? <option value="">Out of new questions, pick a repeat</option> : null}
          {unused.length ? (
            <optgroup label="New">
              {unused.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.prompt}
                </option>
              ))}
            </optgroup>
          ) : null}
          {used.length ? (
            <optgroup label="Already played">
              {used.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.prompt}
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
      </label>
      <button className="show-btn" disabled={!canNext} onClick={() => dispatch({ type: 'nextQuestion' })}>
        Next question <span className="mult-chip">x{m}</span> <ArrowRight size={22} />
      </button>
      <button className="show-btn is-gold" onClick={() => dispatch({ type: 'fmOpen' })}>
        <Zap size={22} /> Fast Money
      </button>
    </div>
  );
}

function plateRole(game: GameState, teamId: string): PlateRole {
  const r = game.round;
  if (!r) return null;
  if (game.phase === 'steal' && r.steal) {
    if (teamId === currentTeamId(game)) return 'stealing';
    if (teamId === r.steal.targetTeamId) return 'target';
    return null;
  }
  if (game.phase === 'playing' && teamId === currentTeamId(game)) return 'up';
  return null;
}

export function Board() {
  const { session } = useSaved();
  if (!session) return null;
  const { game, deck } = session;
  const round = game.round;
  const question = round ? findQuestion(deck, round.questionId) : undefined;

  if (!round || !question) {
    return (
      <div className="board-missing">
        <p>This round's question is not in the loaded deck.</p>
        <button className="show-btn" onClick={() => dispatch({ type: 'fmOpen' })}>
          Go to Fast Money
        </button>
      </div>
    );
  }

  const live = isLive(game);
  const two = game.teams.length === 2;
  const pot = boardPot(round, question);
  const slabs = Math.max(4, question.answers.length);

  const onPlate = (teamId: string) => {
    if (game.phase === 'playing') {
      dispatch({ type: 'setTurn', teamId });
      fx.toast(`${teamName(game, teamId)} is up.`);
    } else if (game.phase === 'steal' && round.steal?.position === 0 && teamId !== round.steal.targetTeamId) {
      dispatch({ type: 'setStealTarget', teamId });
      fx.toast(`${teamName(game, teamId)} is now the steal target.`);
    }
  };

  const plates = game.teams.map((t) => (
    <TeamPlate
      key={t.id}
      team={t}
      pile={round.piles[t.id] ?? 0}
      role={plateRole(game, t.id)}
      banked={game.phase === 'roundEnd' ? round.banked?.[t.id] : null}
      onClick={live ? () => onPlate(t.id) : undefined}
      clickHint={game.phase === 'playing' ? 'Click to put this family at the podium' : game.phase === 'steal' ? 'Click to make this family the steal target' : undefined}
    />
  ));

  return (
    <div className={`main-game ${two ? 'is-flank' : 'is-row'}`}>
      {two ? plates[0] : null}

      <div className="board-col">
        <div className="banner">
          <p className="banner-q">{question.prompt}</p>
        </div>
        <Callout game={game} round={round} />

        {game.phase === 'roundEnd' ? (
          <RoundEndControls game={game} questions={deck.questions} />
        ) : (
          <div className="board-head">
            <span className="mult-badge">
              {multiplierLabel(round.multiplier)}
              {round.multiplier > 1 ? <small>x{round.multiplier}</small> : null}
            </span>
            <div className="strikes" aria-label={`${round.strikes} of 3 strikes`}>
              {[0, 1, 2].map((i) => (
                <StrikeX key={i} on={i < round.strikes} />
              ))}
            </div>
            <span className="pot" aria-label="Points on the board">
              {pot}
            </span>
          </div>
        )}

        <div className="marquee">
          <ol className="slabs" style={{ ['--rows' as string]: slabs }}>
            {Array.from({ length: slabs }, (_, i) => {
              const a = question.answers[i];
              if (!a) return <li key={`empty-${i}`} className="slab is-empty" aria-hidden="true" />;
              const revealed = a.id in round.revealed;
              const by = round.revealed[a.id];
              const byTeam = by ? game.teams.find((t) => t.id === by) : undefined;
              return (
                <li key={a.id} className={`slab ${revealed ? 'is-revealed' : ''}`}>
                  <button
                    className="slab-hit"
                    disabled={revealed}
                    title={live ? 'Shift+click to award to the family at the podium' : 'Click to reveal'}
                    aria-label={revealed ? `${a.text}, ${a.points}` : `Answer ${i + 1}, hidden`}
                    onClick={(e) => {
                      if (game.phase === 'roundEnd' || e.shiftKey) slabAction(i);
                      else if (live) fx.toast('Shift+click awards this answer. Press X for a strike.');
                    }}
                  >
                    <span className="slab-inner">
                      <span className="slab-face slab-front">
                        <span className="slab-rank">{i + 1}</span>
                      </span>
                      <span className="slab-face slab-back" aria-hidden={!revealed}>
                        <span className="slab-text">{a.text}</span>
                        {byTeam ? <img className="slab-by" src={personaImage(byTeam.personaId)} alt={byTeam.name} /> : null}
                        <span className="slab-points">{a.points}</span>
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <StrikeFlash />
        </div>
      </div>

      {two ? plates[1] : <div className="plates-row">{plates}</div>}
    </div>
  );
}
