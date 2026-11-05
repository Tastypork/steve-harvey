export interface Persona {
  id: string;
  name: string;
  image: string;
  color: string;
}

export const PERSONAS: Persona[] = [
  { id: 'overachievers', name: 'The Overachievers', image: '/personas/overachievers.svg', color: '#f5b81c' },
  { id: 'spreadsheet', name: 'The Spreadsheet Squad', image: '/personas/spreadsheet.svg', color: '#2fb36b' },
  { id: 'coffee', name: 'The Coffee Crew', image: '/personas/coffee.svg', color: '#b8743f' },
  { id: 'stagecoach', name: 'The Stagecoach Gang', image: '/personas/stagecoach.svg', color: '#d7263d' },
  { id: 'goldrush', name: 'The Gold Rushers', image: '/personas/goldrush.svg', color: '#ffcf33' },
  { id: 'nightowls', name: 'The Night Owls', image: '/personas/nightowls.svg', color: '#7a5cff' },
  { id: 'rocket', name: 'The Rocket Squad', image: '/personas/rocket.svg', color: '#ff6b35' },
  { id: 'piggybank', name: 'The Piggy Bankers', image: '/personas/piggybank.svg', color: '#ff8fb1' },
  { id: 'pennies', name: 'The Lucky Pennies', image: '/personas/pennies.svg', color: '#c8743a' },
  { id: 'brainstorm', name: 'The Brainstormers', image: '/personas/brainstorm.svg', color: '#29b6f6' },
];

export function persona(id: string | undefined): Persona {
  return PERSONAS.find((p) => p.id === id) ?? PERSONAS[0];
}

export function randomUnusedPersonas(count: number, taken: string[] = []): Persona[] {
  const pool = PERSONAS.filter((p) => !taken.includes(p.id));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}
