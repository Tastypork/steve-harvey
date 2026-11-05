import { useSaved } from '../game/store';
import { Board } from './Board';
import { FastMoney } from './FastMoney';
import { Host } from './Host';
import { HostBar } from './HostBar';
import { Title } from './Title';
import { Winner } from './Winner';

export function Stage({ onExit }: { onExit: () => void }) {
  const { session } = useSaved();
  if (!session) return null;
  const { game } = session;

  return (
    <div className={`stage phase-${game.phase} teams-${game.teams.length}`}>
      <Title compact />
      <main className="set">
        <section className="show">{game.phase === 'fastMoney' ? <FastMoney /> : <Board />}</section>
        <Host />
      </main>
      <HostBar onExit={onExit} />
      {game.phase === 'winner' ? <Winner /> : null}
    </div>
  );
}
