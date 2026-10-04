import { describe, expect, it } from 'vitest';
import { createAbilityProfile, createRawAbilityProfile, isDamageTakenAbility } from './pokedexAbilities';
import { DEFAULT_BASE_SCORE as BASE, calculateDamageFromScore } from './pokedexScoring';
import type { DamageRelations } from './pokedexTypes';

const relations = (over: Partial<DamageRelations> = {}): DamageRelations => ({
  double_damage_from: [],
  half_damage_from: [],
  no_damage_from: [],
  double_damage_to: [],
  half_damage_to: [],
  no_damage_to: [],
  quadruple_damage_from: [],
  quarter_damage_from: [],
  ...over
});

const named = (...names: string[]) => names.map((name) => ({ name }));
const score = (dr: DamageRelations, ability: string) =>
  createAbilityProfile(dr, ability, BASE).damage_relations.damage_from_score as number;

describe('damage-reduction abilities', () => {
  it('moves a halved weakness down one step rather than removing it', () => {
    // Ice/Ground takes 2x from Fire. Thick Fat makes that neutral — not immune,
    // which is what the old bulk multiplier could not express either way.
    const dr = relations({ double_damage_from: named('fire', 'grass') });
    const profile = createAbilityProfile(dr, 'thick-fat', BASE);

    expect(profile.weaknesses).toEqual(['grass']);
    expect(profile.resistances).not.toContain('fire');
  });

  it('halves a neutral type into a resistance', () => {
    const profile = createAbilityProfile(relations(), 'thick-fat', BASE);
    expect(profile.resistances).toContain('fire');
    expect(profile.resistances).toContain('ice');
  });

  it('deepens an existing resistance instead of stopping at half', () => {
    // Azumarill's case: Water already resists both, so Thick Fat takes them to
    // a quarter. Real, and much smaller than the 1.12 constant used to pay.
    const dr = relations({ half_damage_from: named('fire', 'ice') });
    const profile = createAbilityProfile(dr, 'thick-fat', BASE);

    expect(profile.damage_relations.quarter_damage_from?.map((r) => r.name).sort())
      .toEqual(['fire', 'ice']);
  });

  it('leaves a type it already cannot be hurt by alone', () => {
    const dr = relations({ no_damage_from: named('fire') });
    expect(score(dr, 'thick-fat')).toBe(score(dr, 'heatproof') - 0.5);
  });

  it('scales Thick Fat with the typing rather than paying a flat rate', () => {
    // The whole point of the migration. A Pokemon weak to both gains far more
    // than one already resisting both, and a constant cannot say that.
    const weakToBoth = relations({ double_damage_from: named('fire', 'ice') });
    const resistsBoth = relations({ half_damage_from: named('fire', 'ice') });

    const gain = (dr: DamageRelations) =>
      calculateDamageFromScore(dr, BASE) - score(dr, 'thick-fat');

    expect(gain(weakToBoth)).toBeGreaterThan(gain(resistsBoth) * 3);
  });

  it('reduces super-effective damage between buckets for Solid Rock', () => {
    // 0.75x lands on no bucket, so the weakness must stay a weakness while the
    // score still moves. A bucket-only model would have to round it away.
    const dr = relations({ double_damage_from: named('fire', 'water') });
    const profile = createAbilityProfile(dr, 'solid-rock', BASE);

    expect(profile.weaknesses.sort()).toEqual(['fire', 'water']);
    // Two 2x weaknesses, each reduced to 1.5x: -0.5 apiece.
    expect(profile.damage_relations.damage_from_score)
      .toBeCloseTo(calculateDamageFromScore(dr, BASE) - 1, 10);
  });

  it('pays Solid Rock by how much the typing is actually weak to', () => {
    const oneWeakness = relations({ double_damage_from: named('fire') });
    const fourWeaknesses = relations({ double_damage_from: named('fire', 'water', 'grass', 'bug') });
    const gain = (dr: DamageRelations) =>
      calculateDamageFromScore(dr, BASE) - score(dr, 'solid-rock');

    expect(gain(fourWeaknesses)).toBeCloseTo(gain(oneWeakness) * 4, 10);
  });

  it('weights a 4x weakness twice as heavily as a 2x for Solid Rock', () => {
    const quad = relations({ quadruple_damage_from: named('ice') });
    const double = relations({ double_damage_from: named('ice') });
    const gain = (dr: DamageRelations) =>
      calculateDamageFromScore(dr, BASE) - score(dr, 'solid-rock');

    expect(gain(quad)).toBeCloseTo(gain(double) * 2, 10);
  });

  it('treats Filter exactly as Solid Rock', () => {
    const dr = relations({ double_damage_from: named('fire'), quadruple_damage_from: named('ice') });
    expect(score(dr, 'filter')).toBe(score(dr, 'solid-rock'));
  });

  it('leaves the raw profile free of ability effects', () => {
    // createRawAbilityProfile exists to show the bare typing. A reduction is an
    // ability effect and must be absent there, as immunities already are.
    const dr = relations({ double_damage_from: named('fire') });
    expect(createRawAbilityProfile(dr, 'thick-fat', BASE).damage_relations.damage_from_score)
      .toBe(calculateDamageFromScore(dr, BASE));
  });

  it('changes nothing for an ability it does not model', () => {
    const dr = relations({ double_damage_from: named('fire') });
    expect(score(dr, 'blaze')).toBe(calculateDamageFromScore(dr, BASE));
  });

  it('reports which abilities the type layer prices', () => {
    expect(isDamageTakenAbility('thick-fat')).toBe(true);
    expect(isDamageTakenAbility('filter')).toBe(true);
    expect(isDamageTakenAbility('multiscale')).toBe(false);
    expect(isDamageTakenAbility(undefined)).toBe(false);
  });
});
