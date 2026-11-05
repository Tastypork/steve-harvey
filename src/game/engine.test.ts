import { describe, expect, it } from 'vitest';
import { parseFastMoneyCsv, parseRoundsCsv } from './csv';
import { createGame, currentTeamId, multiplierFor, reduce, type Action } from './engine';
import type { Deck, GameState } from './types';

const ROUNDS = `round,question,answer,points
1,Q one,A,40
1,Q one,B,30
1,Q one,C,20
1,Q one,D,10
2,Q two,E,50
2,Q two,F,25
3,Q three,G,60
3,Q three,H,40
4,Q four,I,70
4,Q four,J,30
`;

const FM = `order,question,answer,points
1,F1,x,10
2,F2,y,20
3,F3,z,30
4,F4,w,40
5,F5,v,50
`;

function deck(): Deck {
  return {
    questions: parseRoundsCsv(ROUNDS).items,
    fastMoney: parseFastMoneyCsv(FM).items,
    roundsSource: 'test',
    fastMoneySource: 'test',
  };
}

function setup(n: number) {
  const d = deck();
  const g = createGame(
    Array.from({ length: n }, (_, i) => ({ name: `T${i + 1}`, personaId: 'coffee' })),
    d,
  );
  const run = (game: GameState, ...actions: Action[]) => actions.reduce((s, a) => reduce(s, a, d), game);
  const ans = (game: GameState, text: string) => {
    const q = d.questions.find((x) => x.id === game.round!.questionId)!;
    return q.answers.find((a) => a.text === text)!.id;
  };
  return { d, g, run, ans };
}

describe('csv', () => {
  it('groups answers by round and question and keeps row order', () => {
    const r = parseRoundsCsv(ROUNDS);
    expect(r.items).toHaveLength(4);
    expect(r.items[0].answers.map((a) => a.text)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('handles quotes, commas, CRLF and bad rows', () => {
    const r = parseRoundsCsv(
      'Round,Question,Answer,Points\r\n1,"Name a thing, please","Say ""hi""",12\r\n1,"Name a thing, please",Oops,abc\r\n',
    );
    expect(r.items[0].prompt).toBe('Name a thing, please');
    expect(r.items[0].answers[0].text).toBe('Say "hi"');
    expect(r.warnings.some((w) => w.includes('line 3'))).toBe(true);
  });

  it('reports a missing column', () => {
    const r = parseRoundsCsv('round,question,points\n1,a,2\n');
    expect(r.items).toHaveLength(0);
    expect(r.warnings[0]).toMatch(/answer/);
  });
});

describe('multipliers', () => {
  it('runs 1, 1, 2, 3, 3, 3', () => {
    expect([1, 2, 3, 4, 5, 6].map(multiplierFor)).toEqual([1, 1, 2, 3, 3, 3]);
  });
});

describe('rotating turns', () => {
  it('advances after every guess and credits the guesser', () => {
    const { g, run, ans } = setup(3);
    expect(currentTeamId(g)).toBe('t1');
    const s = run(g, { type: 'correct', answerId: ans(g, 'A') }, { type: 'wrong' }, { type: 'correct', answerId: ans(g, 'C') });
    expect(s.round!.piles).toEqual({ t1: 40, t2: 0, t3: 20 });
    expect(s.round!.strikes).toBe(1);
    expect(currentTeamId(s)).toBe('t1');
    expect(s.teams.every((t) => t.total === 0)).toBe(true);
  });

  it('banks piles times multiplier when the board clears', () => {
    const { g, run, ans } = setup(2);
    const s = run(
      g,
      { type: 'correct', answerId: ans(g, 'A') },
      { type: 'correct', answerId: ans(g, 'B') },
      { type: 'correct', answerId: ans(g, 'C') },
      { type: 'correct', answerId: ans(g, 'D') },
    );
    expect(s.phase).toBe('roundEnd');
    expect(s.round!.outcome).toBe('cleared');
    expect(s.teams.map((t) => t.total)).toEqual([60, 40]);
  });

  it('counts a repeated answer as a strike', () => {
    const { g, run, ans } = setup(2);
    const s = run(g, { type: 'correct', answerId: ans(g, 'A') }, { type: 'correct', answerId: ans(g, 'A') });
    expect(s.round!.strikes).toBe(1);
    expect(s.round!.piles.t2).toBe(0);
  });

  it('rotates the starting team each question', () => {
    const { g, run } = setup(3);
    const s = run(g, { type: 'endRound' }, { type: 'nextQuestion' });
    expect(s.round!.number).toBe(2);
    expect(currentTeamId(s)).toBe('t2');
  });
});

describe('steal', () => {
  it('targets the family that struck out, and the next family takes their pile', () => {
    const { g, run, ans } = setup(3);
    // t1 A(40), t2 B(30), t3 miss, t1 miss, t2 miss -> third strike by t2
    const s = run(
      g,
      { type: 'correct', answerId: ans(g, 'A') },
      { type: 'correct', answerId: ans(g, 'B') },
      { type: 'wrong' },
      { type: 'wrong' },
      { type: 'wrong' },
    );
    expect(s.phase).toBe('steal');
    expect(s.round!.steal!.targetTeamId).toBe('t2');
    expect(s.round!.steal!.struckOutTeamId).toBe('t2');
    expect(s.round!.steal!.queue).toEqual(['t3', 't1']);
    expect(currentTeamId(s)).toBe('t3');
    const done = run(s, { type: 'correct', answerId: ans(s, 'C') });
    expect(done.phase).toBe('roundEnd');
    expect(done.round!.outcome).toBe('stolen');
    expect(done.round!.piles).toEqual({ t1: 40, t2: 0, t3: 50 });
    expect(done.teams.map((t) => t.total)).toEqual([40, 0, 50]);
  });

  it('makes a failed stealer the target for the next family', () => {
    const { g, run, ans } = setup(3);
    // t2 has 30, t3 has 20, t2 strikes out. t3 misses, so t1 steals t3's pile, not t2's.
    let s = run(
      g,
      { type: 'wrong' },
      { type: 'correct', answerId: ans(g, 'B') },
      { type: 'correct', answerId: ans(g, 'C') },
      { type: 'wrong' },
      { type: 'wrong' },
    );
    expect(s.round!.steal!.targetTeamId).toBe('t2');
    expect(currentTeamId(s)).toBe('t3');
    s = run(s, { type: 'wrong' });
    expect(s.phase).toBe('steal');
    expect(s.round!.steal!.targetTeamId).toBe('t3');
    expect(currentTeamId(s)).toBe('t1');
    s = run(s, { type: 'correct', answerId: ans(s, 'A') });
    expect(s.round!.outcome).toBe('stolen');
    expect(s.round!.piles).toEqual({ t1: 60, t2: 30, t3: 0 });
    expect(s.teams.map((t) => t.total)).toEqual([60, 30, 0]);
  });

  it('gives every other family one chance, then each keeps their pile', () => {
    const { g, run, ans } = setup(5);
    let s = run(g, { type: 'correct', answerId: ans(g, 'A') }); // t1 40
    s = run(s, { type: 'wrong' }, { type: 'wrong' }, { type: 'wrong' }); // t2, t3, t4 strike
    expect(s.phase).toBe('steal');
    expect(s.round!.steal!.targetTeamId).toBe('t4');
    expect(s.round!.steal!.queue).toEqual(['t5', 't1', 't2', 't3']);
    expect(s.round!.strikes).toBe(3);
    s = run(s, { type: 'wrong' });
    expect(s.round!.steal!.targetTeamId).toBe('t5');
    expect(currentTeamId(s)).toBe('t1');
    s = run(s, { type: 'wrong' }, { type: 'wrong' }, { type: 'wrong' });
    expect(s.phase).toBe('roundEnd');
    expect(s.round!.outcome).toBe('defended');
    expect(s.round!.steal!.targetTeamId).toBe('t3');
    expect(s.teams[0].total).toBe(40);
  });

  it('lets the host retarget before the first attempt, and the next family steals', () => {
    const { g, run } = setup(3);
    let s = run(g, { type: 'wrong' }, { type: 'wrong' }, { type: 'wrong' }); // t1, t2, t3; t3 struck out
    expect(s.round!.steal!.targetTeamId).toBe('t3');
    expect(s.round!.steal!.queue).toEqual(['t1', 't2']);
    s = run(s, { type: 'setStealTarget', teamId: 't2' });
    expect(s.round!.steal!.targetTeamId).toBe('t2');
    expect(s.round!.steal!.queue).toEqual(['t3', 't1']);
    expect(currentTeamId(s)).toBe('t3');
  });

  it('still opens a steal when every pile is empty', () => {
    const { g, run } = setup(2);
    const s = run(g, { type: 'wrong' }, { type: 'wrong' }, { type: 'wrong' });
    expect(s.phase).toBe('steal');
    expect(s.round!.steal!.targetTeamId).toBe('t1');
    expect(s.round!.steal!.queue).toEqual(['t2']);
    expect(currentTeamId(s)).toBe('t2');
  });

  it('applies the double multiplier on round 3', () => {
    const { g, run, ans } = setup(2);
    let s = run(g, { type: 'endRound' }, { type: 'nextQuestion' }, { type: 'endRound' }, { type: 'nextQuestion' });
    expect(s.round!.multiplier).toBe(2);
    s = run(s, { type: 'correct', answerId: ans(s, 'G') }, { type: 'endRound' });
    expect(s.teams[0].total).toBe(120);
  });
});

describe('fast money', () => {
  it('picks the top two, records, reveals and banks', () => {
    const { g, run, ans } = setup(3);
    let s = run(g, { type: 'setTurn', teamId: 't3' }, { type: 'correct', answerId: ans(g, 'A') });
    s = run(s, { type: 'correct', answerId: ans(g, 'D') }, { type: 'endRound' });
    expect(s.teams.map((t) => t.total)).toEqual([10, 0, 40]);
    s = run(s, { type: 'fmOpen' });
    expect(s.fastMoney!.teamIds).toEqual(['t3', 't1']);
    s = run(s, { type: 'fmPick', teamIds: ['t3', 't1'] }, { type: 'fmTimer', op: 'start', now: 0 });
    s = run(s, { type: 'fmRecord', index: 0, answer: 'Coffee' }, { type: 'fmToReveal', now: 5000 });
    expect(s.fastMoney!.timers[0].remainingMs).toBe(20000);
    s = run(s, { type: 'fmSetPoints', player: 0, index: 0, points: 33 }, { type: 'fmNextFamily' });
    expect(s.fastMoney!.active).toBe(1);
    s = run(s, { type: 'fmToReveal', now: 0 }, { type: 'fmSetPoints', player: 1, index: 0, points: 12 }, { type: 'fmBank' });
    expect(s.phase).toBe('winner');
    expect(s.teams.map((t) => t.total)).toEqual([22, 0, 73]);
    expect(s.winnerTeamIds).toEqual(['t3']);
  });

  it('banks an in-progress round when jumping to Fast Money', () => {
    const { g, run, ans } = setup(2);
    const s = run(g, { type: 'correct', answerId: ans(g, 'A') }, { type: 'fmOpen' });
    expect(s.phase).toBe('fastMoney');
    expect(s.teams[0].total).toBe(40);
  });
});
