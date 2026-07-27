import { describe, expect, it } from 'vitest';
import { BATTLE_FORMATS } from './battleFormats';
import {
  ROSTER_DEPTH_OPTIONS,
  ROSTER_WEIGHTS,
  evaluateRoster,
  scoreBring,
  type RosterMember
} from './rosterScoring';

const member = (name: string, overrides: Partial<RosterMember> = {}): RosterMember => ({
  name,
  types: ['normal'],
  weaknesses: [],
  resistances: [],
  immunities: [],
  coverages: [],
  moveCoverages: [],
  stats: { hp: 80, attack: 100, defense: 90, 'special-attack': 100, 'special-defense': 90, speed: 80 },
  normalizedDamageToScore: 0.5,
  normalizedDamageFromScore: 0.5,
  ...overrides
});

const doubles = { format: BATTLE_FORMATS.doubles };
const singles = { format: BATTLE_FORMATS.singles };

describe('roster weights', () => {
  it('splits the roster score entirely between peak and depth', () => {
    expect(ROSTER_WEIGHTS.best + ROSTER_WEIGHTS.depth).toBeCloseTo(1);
  });
});

describe('evaluateRoster', () => {
  const sixRoster = ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => member(n));

  it('enumerates every bring-4 option for doubles', () => {
    const evaluation = evaluateRoster(sixRoster, doubles);

    expect(evaluation.optionCount).toBe(15);
    evaluation.bringOptions.forEach((option) => expect(option.indices).toHaveLength(4));
  });

  it('enumerates every bring-3 option for singles', () => {
    expect(evaluateRoster(sixRoster, singles).optionCount).toBe(20);
  });

  it('ranks options best first', () => {
    const scores = evaluateRoster(sixRoster, doubles).bringOptions.map((option) => option.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(evaluateRoster(sixRoster, doubles).best?.score).toBe(scores[0]);
  });

  it('names the members of each option', () => {
    const best = evaluateRoster(sixRoster, doubles).best!;
    expect(best.names).toHaveLength(4);
    expect(best.names.every((name) => 'abcdef'.includes(name))).toBe(true);
  });

  it('returns nothing when the roster cannot fill a bring', () => {
    const evaluation = evaluateRoster([member('a'), member('b')], doubles);

    expect(evaluation.bringOptions).toEqual([]);
    expect(evaluation.best).toBeNull();
    expect(evaluation.score).toBe(0);
  });

  it('handles a roster that exactly fills the bring', () => {
    const evaluation = evaluateRoster(['a', 'b', 'c', 'd'].map((n) => member(n)), doubles);

    expect(evaluation.optionCount).toBe(1);
    expect(evaluation.best?.indices).toEqual([0, 1, 2, 3]);
  });

  it('rewards depth, not just a single strong line', () => {
    // Both rosters contain the same best four. The deep one has interchangeable
    // spares, the shallow one has two members that drag every alternative down.
    const strongFour = [
      member('w', { types: ['water'], resistances: ['fire'], coverages: ['fire'] }),
      member('g', { types: ['grass'], resistances: ['water'], coverages: ['water'] }),
      member('e', { types: ['electric'], resistances: ['flying'], coverages: ['flying'] }),
      member('s', { types: ['steel'], resistances: ['fairy'], coverages: ['fairy'] })
    ];
    const deep = evaluateRoster([
      ...strongFour,
      member('x', { types: ['ghost'], resistances: ['normal'], coverages: ['psychic'] }),
      member('y', { types: ['dark'], resistances: ['psychic'], coverages: ['ghost'] })
    ], doubles);
    const shallow = evaluateRoster([
      ...strongFour,
      member('p', { types: ['water'], weaknesses: ['grass'], resistances: [], coverages: [] }),
      member('q', { types: ['water'], weaknesses: ['grass'], resistances: [], coverages: [] })
    ], doubles);

    expect(deep.best!.score).toBeCloseTo(shallow.best!.score);
    expect(deep.score).toBeGreaterThan(shallow.score);
  });

  it('averages depth over at most the configured number of options', () => {
    const evaluation = evaluateRoster(sixRoster, doubles);
    const topScores = evaluation.bringOptions.slice(0, ROSTER_DEPTH_OPTIONS).map((o) => o.score);
    const depth = topScores.reduce((a, b) => a + b, 0) / topScores.length;

    expect(evaluation.score).toBeCloseTo(
      (ROSTER_WEIGHTS.best * evaluation.best!.score) + (ROSTER_WEIGHTS.depth * depth)
    );
  });
});

describe('scoreBring', () => {
  it('produces a 0..100 score', () => {
    const score = scoreBring(['a', 'b', 'c', 'd'].map((n) => member(n)), doubles);

    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('returns zero for an empty bring', () => {
    expect(scoreBring([], doubles)).toBe(0);
  });

  it('ignores ally-damage immunity in singles', () => {
    // Telepathy protects against an ally's moves. With no ally it is inert, so
    // it must not change a singles score.
    const withTelepathy = [
      member('a', { types: ['ground'] }),
      member('b', { types: ['psychic'], weaknesses: ['ground'], abilityName: 'telepathy' }),
      member('c')
    ];
    const withoutTelepathy = [
      member('a', { types: ['ground'] }),
      member('b', { types: ['psychic'], weaknesses: ['ground'], abilityName: 'blaze' }),
      member('c')
    ];

    expect(scoreBring(withTelepathy, singles)).toBeCloseTo(scoreBring(withoutTelepathy, singles));
  });

  it('tolerates members without stats', () => {
    const score = scoreBring([member('a', { stats: undefined }), member('b')], doubles);
    expect(Number.isFinite(score)).toBe(true);
  });
});
