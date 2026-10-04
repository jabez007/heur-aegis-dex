import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BASE_SCORE,
  IMMUNITY_VALUE,
  calculateDamageFromResidual,
  calculateDamageFromScore
} from './pokedexScoring';
import { UNIFORM_TYPE_THREAT } from './typeThreat';
import type { DamageRelations } from './pokedexTypes';

const relations = (overrides: Partial<DamageRelations> = {}): DamageRelations => ({
  double_damage_from: [],
  half_damage_from: [],
  no_damage_from: [],
  double_damage_to: [],
  half_damage_to: [],
  no_damage_to: [],
  ...overrides
});

/** Normal: one weakness to Fighting against one immunity to Ghost. */
const NORMAL = relations({
  double_damage_from: [{ name: 'fighting' }],
  no_damage_from: [{ name: 'ghost' }]
});

describe('threat-weighted defensive score', () => {
  it('reproduces the flat count under the uniform weighting', () => {
    const dr = relations({
      quadruple_damage_from: [{ name: 'ice' }],
      double_damage_from: [{ name: 'fairy' }],
      half_damage_from: [{ name: 'fire' }],
      quarter_damage_from: [{ name: 'water' }],
      no_damage_from: [{ name: 'ground' }]
    });
    const expected = DEFAULT_BASE_SCORE + 3 + 1 - 0.5 - 0.75 + IMMUNITY_VALUE;

    expect(calculateDamageFromScore(dr, DEFAULT_BASE_SCORE)).toBe(expected);
    expect(calculateDamageFromScore(dr, DEFAULT_BASE_SCORE, UNIFORM_TYPE_THREAT)).toBe(expected);
  });

  it('keeps the neutral line for a typing with nothing in any bucket', () => {
    // `baseScore` still means "takes neutral damage from everything", which is
    // what makes `maxDamageFromScore` a line rather than a tuned threshold. That
    // holds at any weighting, because every term is zero.
    [UNIFORM_TYPE_THREAT, { fighting: 0.3, ghost: 0.9 }].forEach((weights) => {
      expect(calculateDamageFromScore(relations(), DEFAULT_BASE_SCORE, weights))
        .toBe(DEFAULT_BASE_SCORE);
    });
  });

  it('no longer cancels a weakness against an immunity', () => {
    // Normal used to land exactly on the line: +1 for Fighting against -1 for
    // Ghost. That tidiness was the symptom IMMUNITY_VALUE exists to fix — it
    // priced a threshold as a quantity of damage. An immunity now outweighs a
    // weakness fourfold, so Normal comes out well ahead of neutral.
    expect(calculateDamageFromScore(NORMAL, DEFAULT_BASE_SCORE))
      .toBe(DEFAULT_BASE_SCORE + 1 + IMMUNITY_VALUE);
    expect(calculateDamageFromScore(NORMAL, DEFAULT_BASE_SCORE))
      .toBeLessThan(DEFAULT_BASE_SCORE);
  });

  it('still weights both sides, so an immunity nobody tests is worth nothing', () => {
    // The larger IMMUNITY_VALUE makes this matter more, not less: an unweighted
    // immunity term would collect a full -4 against a type the metagame cannot
    // bring, which is the bug threat weighting exists to remove.
    expect(calculateDamageFromScore(NORMAL, DEFAULT_BASE_SCORE, { fighting: 0, ghost: 0 }))
      .toBe(DEFAULT_BASE_SCORE);
    expect(calculateDamageFromScore(NORMAL, DEFAULT_BASE_SCORE, { fighting: 0.5, ghost: 0.5 }))
      .toBeCloseTo(DEFAULT_BASE_SCORE + 0.5 + (0.5 * IMMUNITY_VALUE), 10);
  });

  it('costs nothing for a weakness the pool cannot exploit', () => {
    const dr = relations({ double_damage_from: [{ name: 'fighting' }] });

    expect(calculateDamageFromScore(dr, DEFAULT_BASE_SCORE, { fighting: 0 }))
      .toBe(DEFAULT_BASE_SCORE);
    expect(calculateDamageFromScore(dr, DEFAULT_BASE_SCORE, { fighting: 1 }))
      .toBe(DEFAULT_BASE_SCORE + 1);
  });

  it('scales a 4x weakness at three times a 2x one, as the buckets always did', () => {
    const quadruple = relations({ quadruple_damage_from: [{ name: 'ice' }] });
    const double = relations({ double_damage_from: [{ name: 'ice' }] });
    const weights = { ice: 0.4 };

    expect(calculateDamageFromScore(quadruple, DEFAULT_BASE_SCORE, weights) - DEFAULT_BASE_SCORE)
      .toBeCloseTo(3 * (calculateDamageFromScore(double, DEFAULT_BASE_SCORE, weights) - DEFAULT_BASE_SCORE), 10);
  });

  it('weights the between-bucket residual a reduction ability leaves', () => {
    // Solid Rock's 0.75x has no bucket, so it rides alongside as a residual. It
    // is worth what the matchup is worth, like everything else.
    const dr = relations({
      double_damage_from: [{ name: 'grass' }],
      damage_from_residuals: [{ name: 'grass', delta: -0.5 }]
    });

    expect(calculateDamageFromResidual(dr)).toBe(-0.5);
    expect(calculateDamageFromResidual(dr, { grass: 0.5 })).toBe(-0.25);
    expect(calculateDamageFromResidual(relations())).toBe(0);
  });
});
