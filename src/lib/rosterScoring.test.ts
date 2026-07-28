import { describe, expect, it } from 'vitest';
import { BATTLE_FORMATS, combinationsOf } from './battleFormats';
import {
  ROSTER_WEIGHTS,
  VIABLE_LINE_MARGIN,
  countTargetLines,
  evaluateRoster,
  maxSharedMembers,
  scoreBring,
  selectDistinctLines,
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

  it('scores depth over the distinct lines a full roster could offer', () => {
    const evaluation = evaluateRoster(sixRoster, doubles);
    const depth = evaluation.lines.reduce((total, line) => total + line.score, 0) / evaluation.targetLines;

    expect(evaluation.lines.length).toBe(evaluation.targetLines);
    expect(evaluation.score).toBeCloseTo(
      (ROSTER_WEIGHTS.best * evaluation.best!.score) + (ROSTER_WEIGHTS.depth * depth)
    );
  });

  it('reports a depth that reconstructs the score exactly', () => {
    // The workbench shows the score as `best x 0.6 + depth x 0.4`. If this field
    // ever stopped being the number the score was built from, the tooltip would
    // display arithmetic that does not add up to the figure beside it.
    const evaluation = evaluateRoster(sixRoster, doubles);

    expect(evaluation.depth).toBeCloseTo(
      evaluation.lines.reduce((total, line) => total + line.score, 0) / evaluation.targetLines
    );
    expect(
      (ROSTER_WEIGHTS.best * evaluation.best!.score) + (ROSTER_WEIGHTS.depth * evaluation.depth)
    ).toBeCloseTo(evaluation.score);
  });

  it('reports zero depth when no bring is possible', () => {
    expect(evaluateRoster([member('a')], doubles).depth).toBe(0);
  });

  it('opens the line list with the best bring', () => {
    const evaluation = evaluateRoster(sixRoster, doubles);
    expect(evaluation.lines[0]).toBe(evaluation.best);
  });

  it('measures a short roster against a full one, so a sixth member can only help', () => {
    // Every pair of bring-four subsets drawn from five shares three members, so
    // a roster of five offers exactly one line however good it is. Measured
    // against its own shape it would score full depth and beat any roster of
    // six, telling the user to stop registering Pokemon.
    const five = evaluateRoster(sixRoster.slice(0, 5), doubles);
    const six = evaluateRoster(sixRoster, doubles);

    expect(five.lines).toHaveLength(1);
    expect(five.targetLines).toBe(six.targetLines);
    expect(six.score).toBeGreaterThan(five.score);
  });

  it('never scores a roster above its own best bring', () => {
    const evaluation = evaluateRoster(sixRoster, doubles);
    expect(evaluation.score).toBeLessThanOrEqual(evaluation.best!.score + 1e-9);
  });

  it('charges two dead slots far more than a single swap would', () => {
    // The defect this replaced: depth was the mean of the three top-scoring
    // options, and those always differ from the best bring by one member. Two
    // unusable spares never had to appear together in any counted option, so
    // they cost almost nothing. Under distinct lines the third line must field
    // both of them.
    const core = [
      member('w', { types: ['water'], resistances: ['fire', 'steel'], coverages: ['fire', 'ground'] }),
      member('g', { types: ['grass'], resistances: ['water', 'ground'], coverages: ['water', 'rock'] }),
      member('e', { types: ['electric'], resistances: ['flying', 'steel'], coverages: ['flying', 'water'] }),
      member('s', { types: ['steel'], resistances: ['fairy', 'dragon'], coverages: ['fairy', 'ice'] })
    ];
    const spares = [
      member('x', { types: ['ghost'], resistances: ['poison', 'bug'], immunities: ['normal'], coverages: ['psychic', 'ghost'] }),
      member('y', { types: ['dark'], resistances: ['dark', 'ghost'], immunities: ['psychic'], coverages: ['ghost', 'psychic'] })
    ];
    const junk = [
      member('p', { types: ['water'], weaknesses: ['grass', 'electric'], resistances: [], coverages: [] }),
      member('q', { types: ['water'], weaknesses: ['grass', 'electric'], resistances: [], coverages: [] })
    ];

    const deep = evaluateRoster([...core, ...spares], doubles);
    const shallow = evaluateRoster([...core, ...junk], doubles);

    // Stated as a comparison against the peak rather than as "same best four",
    // because the spares are good enough to appear in the best bring themselves.
    // If depth were inert the two scores would differ by exactly the peak gap,
    // since both terms would then be reading the same number.
    const peakGap = deep.best!.score - shallow.best!.score;
    const scoreGap = deep.score - shallow.score;

    expect(peakGap).toBeGreaterThan(0);
    expect(scoreGap).toBeGreaterThan(peakGap * 2);
  });
});

describe('viableLines', () => {
  const sixRoster = ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => member(n));

  it('counts only the lines that hold up against the best', () => {
    const evaluation = evaluateRoster(sixRoster, doubles);
    const expected = evaluation.lines.filter(
      (line) => line.score >= evaluation.best!.score - VIABLE_LINE_MARGIN
    ).length;

    expect(evaluation.viableLines).toBe(expected);
    expect(evaluation.viableLines).toBeGreaterThanOrEqual(1);
    expect(evaluation.viableLines).toBeLessThanOrEqual(evaluation.lines.length);
  });

  it('drops a line the roster cannot really field', () => {
    // Structurally there are always three distinct lines from six Pokemon, so
    // the raw count says nothing about the Pokemon. Two members that ruin any
    // bring they appear in have to show up as a *lower* viable count.
    const core = [
      member('w', { types: ['water'], resistances: ['fire', 'steel'], coverages: ['fire', 'ground'] }),
      member('g', { types: ['grass'], resistances: ['water', 'ground'], coverages: ['water', 'rock'] }),
      member('e', { types: ['electric'], resistances: ['flying', 'steel'], coverages: ['flying', 'water'] }),
      member('s', { types: ['steel'], resistances: ['fairy', 'dragon'], coverages: ['fairy', 'ice'] })
    ];
    const junk = [
      member('p', { types: ['water'], weaknesses: ['grass', 'electric'], resistances: [], coverages: [] }),
      member('q', { types: ['water'], weaknesses: ['grass', 'electric'], resistances: [], coverages: [] })
    ];
    const evaluation = evaluateRoster([...core, ...junk], doubles);

    expect(evaluation.lines).toHaveLength(evaluation.targetLines);
    expect(evaluation.viableLines).toBeLessThan(evaluation.lines.length);
  });

  it('reports nothing viable when no bring is possible', () => {
    expect(evaluateRoster([member('a')], doubles).viableLines).toBe(0);
  });
});

describe('selectDistinctLines', () => {
  const option = (indices: number[], score: number) => ({ indices, names: [], score });

  it('rejects a bring that is one substitution away from a kept line', () => {
    const lines = selectDistinctLines(
      [option([0, 1, 2, 3], 90), option([0, 1, 2, 4], 89), option([0, 1, 4, 5], 88)],
      4
    );

    expect(lines.map((line) => line.indices)).toEqual([[0, 1, 2, 3], [0, 1, 4, 5]]);
  });

  it('keeps the highest scoring option even when a lower one would pack better', () => {
    // Greedy on purpose: the first line has to stay the roster's best bring,
    // because that is the one actually played when the matchup allows it.
    const lines = selectDistinctLines([option([0, 1, 2, 3], 90), option([2, 3, 4, 5], 10)], 4);
    expect(lines[0].score).toBe(90);
  });

  it('requires singles brings to differ by two of three', () => {
    expect(maxSharedMembers(3)).toBe(1);
    const lines = selectDistinctLines([option([0, 1, 2], 90), option([0, 1, 3], 89), option([0, 3, 4], 88)], 3);
    expect(lines.map((line) => line.indices)).toEqual([[0, 1, 2], [0, 3, 4]]);
  });
});

describe('countTargetLines', () => {
  it('derives three lines for doubles and four for singles', () => {
    expect(countTargetLines(6, 4)).toBe(3);
    expect(countTargetLines(6, 3)).toBe(4);
  });

  it('is reachable by the algorithm that scores against it', () => {
    // A target no roster could hit would mark every roster short of it.
    [[6, 4], [6, 3], [5, 4], [4, 4]].forEach(([rosterSize, bringSize]) => {
      const indices = Array.from({ length: rosterSize }, (_, index) => index);
      const shapes = combinationsOf(indices, bringSize).map((subset) => ({ indices: subset, names: [], score: 0 }));

      expect(selectDistinctLines(shapes, bringSize)).toHaveLength(countTargetLines(rosterSize, bringSize));
    });
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
