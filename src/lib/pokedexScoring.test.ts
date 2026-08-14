import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BASE_SCORE,
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
    const expected = DEFAULT_BASE_SCORE + 3 + 1 - 0.5 - 0.75 - 1;

    expect(calculateDamageFromScore(dr, DEFAULT_BASE_SCORE)).toBe(expected);
    expect(calculateDamageFromScore(dr, DEFAULT_BASE_SCORE, UNIFORM_TYPE_THREAT)).toBe(expected);
  });

  it('holds the neutral line for a typing whose terms cancel', () => {
    // This is the load-bearing invariant. `baseScore` means "takes neutral damage
    // from everything", and Normal lands on it by cancellation rather than by
    // having empty buckets. Weighting only the weaknesses would break that: the
    // Fighting term would shrink while the Ghost immunity kept its full credit,
    // and Normal would score *better* than neutral for no reason. Weighting both
    // sides keeps the cancellation exact at any weight.
    expect(calculateDamageFromScore(NORMAL, DEFAULT_BASE_SCORE)).toBe(DEFAULT_BASE_SCORE);

    [0, 0.05, 0.371, 0.6, 1].forEach((weight) => {
      expect(calculateDamageFromScore(NORMAL, DEFAULT_BASE_SCORE, { fighting: weight, ghost: weight }))
        .toBeCloseTo(DEFAULT_BASE_SCORE, 10);
    });
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
