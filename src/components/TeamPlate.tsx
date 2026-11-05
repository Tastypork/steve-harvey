import { personaImage } from '../assets';
import type { Team } from '../game/types';

export type PlateRole = 'up' | 'stealing' | 'target' | 'winner' | null;

interface Props {
  team: Team;
  pile: number | null;
  role: PlateRole;
  banked?: number | null;
  onClick?: () => void;
  clickHint?: string;
}

const ROLE_LABEL: Record<Exclude<PlateRole, null>, string> = {
  up: 'Your answer',
  stealing: 'Steal chance',
  target: 'Defending',
  winner: 'Top family',
};

export function TeamPlate({ team, pile, role, banked, onClick, clickHint }: Props) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      className={`plate ${role ? `is-${role}` : ''}`}
      onClick={onClick}
      title={clickHint}
      aria-label={`${team.name}${role ? `, ${ROLE_LABEL[role]}` : ''}`}
    >
      {role ? <span className="plate-role">{ROLE_LABEL[role]}</span> : null}
      <img className="plate-portrait" src={personaImage(team.personaId)} alt="" draggable={false} />
      <span className="plate-name">{team.name}</span>
      {pile !== null ? (
        <span className="plate-pile" aria-label="Points this round">
          {pile}
        </span>
      ) : null}
      <span className="plate-total">
        Match <b>{team.total}</b>
      </span>
      {banked ? <span className="plate-banked">+{banked}</span> : null}
    </Tag>
  );
}
