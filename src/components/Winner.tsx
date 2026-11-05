import { useEffect } from 'react';
import confetti from 'canvas-confetti';
import { RotateCcw } from 'lucide-react';
import { personaImage } from '../assets';
import { play } from '../audio/sounds';
import { rankTeams } from '../game/engine';
import { useSaved } from '../game/store';
import { undo } from '../ui/actions';
import { fx } from '../ui/fx';
import { Host } from './Host';

const COLORS = ['#ffcd41', '#ffffff', '#d7263d', '#1d5bff', '#ff9f1c'];
let lastFanfare = 0;

export function Winner() {
  const { session } = useSaved();
  const game = session?.game;

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    fx.hold('correct', 'What a family!');
    const fanfare = Date.now() - lastFanfare > 3000;
    if (fanfare) {
      lastFanfare = Date.now();
      void play('stinger');
    }
    const clap = setTimeout(() => void play('clap'), 900);
    const end = Date.now() + 7000;
    let raf = 0;
    const burst = () => {
      confetti({ particleCount: 160, spread: 110, origin: { y: 0.55 }, colors: COLORS, disableForReducedMotion: true });
    };
    burst();
    const frame = () => {
      confetti({ particleCount: 5, angle: 60, spread: 60, origin: { x: 0, y: 0.7 }, colors: COLORS, disableForReducedMotion: true });
      confetti({ particleCount: 5, angle: 120, spread: 60, origin: { x: 1, y: 0.7 }, colors: COLORS, disableForReducedMotion: true });
      if (Date.now() < end) raf = requestAnimationFrame(frame);
    };
    if (!reduce) raf = requestAnimationFrame(frame);
    const again = setInterval(burst, 3500);
    return () => {
      clearTimeout(clap);
      clearInterval(again);
      cancelAnimationFrame(raf);
      confetti.reset();
      fx.hold('idle');
    };
  }, []);

  if (!game) return null;
  const winners = game.teams.filter((t) => game.winnerTeamIds.includes(t.id));
  const ranked = rankTeams(game.teams);
  const fm = game.fastMoney;

  return (
    <div className="winner" role="dialog" aria-label="Winner">
      <div className="winner-rays" aria-hidden="true" />
      <div className="winner-main">
        {winners.length > 1 ? <p className="winner-tie">Tie game</p> : null}
        <div className="winner-names">
          {winners.map((w) => (
            <div className="winner-team" key={w.id}>
              <img src={personaImage(w.personaId)} alt="" />
              <h2>{w.name}</h2>
              <span className="winner-total">{w.total}</span>
            </div>
          ))}
        </div>
        <ol className="winner-standings">
          {ranked.map((t) => {
            const i = fm?.teamIds.indexOf(t.id) ?? -1;
            return (
              <li key={t.id}>
                <span>{t.name}</span>
                {i !== -1 && fm?.banked ? <small>Fast Money +{fm.banked[i]}</small> : null}
                <b>{t.total}</b>
              </li>
            );
          })}
        </ol>
        <div className="winner-actions">
          <button className="show-btn is-quiet" onClick={undo} title="Back to Fast Money (Ctrl+Z)">
            <RotateCcw size={18} /> Back to Fast Money
          </button>
        </div>
      </div>
      <Host large />
    </div>
  );
}
