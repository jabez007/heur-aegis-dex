import type { DamageRelations, NamedResource } from './pokedexTypes';

/**
 * Baseline used to normalize damage scores. It doubles as the number of
 * elemental types in play: getBaseTypes keeps types whose id is <= baseScore,
 * so with the default of 18 every standard type is included.
 */
export const DEFAULT_BASE_SCORE = 18;

export const calculateDamageFromScore = (dr: DamageRelations, baseScore: number): number => {
  let score = baseScore;
  if (dr.quadruple_damage_from) score += (3 * dr.quadruple_damage_from.length);
  score += dr.double_damage_from.length;
  score -= (0.5 * dr.half_damage_from.length);
  if (dr.quarter_damage_from) score -= (0.75 * dr.quarter_damage_from.length);
  score -= dr.no_damage_from.length;
  return score;
};

export const calculateDamageToScore = (dr: DamageRelations, baseScore: number): number => {
  return baseScore
    + dr.double_damage_to.length
    - (0.5 * dr.half_damage_to.length)
    - dr.no_damage_to.length;
};

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * Absolute bounds of calculateDamageFromScore for a given baseline.
 *
 * Every attacking type lands in exactly one bucket, so the worst case is all
 * types dealing quadruple damage (+3 each) and the best is all types being
 * fully resisted (-1 each). Bounds come from the formula rather than from the
 * types present in a scan, so an entry always normalizes to the same value.
 *
 * @param baseScore Baseline score, which is also the number of types in play.
 * @returns The minimum and maximum achievable defensive score.
 */
export const damageFromScoreBounds = (baseScore: number) => ({
  min: baseScore - baseScore,
  max: baseScore + (3 * baseScore)
});

/**
 * Absolute bounds of calculateDamageToScore for a given baseline.
 *
 * @param baseScore Baseline score, which is also the number of types in play.
 * @returns The minimum and maximum achievable offensive score.
 */
export const damageToScoreBounds = (baseScore: number) => ({
  min: baseScore - baseScore,
  max: baseScore + baseScore
});

/**
 * Normalizes a defensive score to 0..1 where 0 is the best possible defensive
 * profile and 1 the worst. Undefined scores fall back to the midpoint.
 *
 * @param score Raw defensive score, or undefined when unavailable.
 * @param baseScore Baseline the score was calculated with.
 * @returns A value in 0..1, or 0.5 when the score is unknown.
 */
export const normalizeDamageFromScore = (score: number | undefined, baseScore: number): number => {
  if (score === undefined) return 0.5;
  const { min, max } = damageFromScoreBounds(baseScore);
  return max === min ? 0.5 : clamp01((score - min) / (max - min));
};

/**
 * Normalizes an offensive score to 0..1 where 1 is the broadest possible
 * offensive profile. Undefined scores fall back to the midpoint.
 *
 * @param score Raw offensive score, or undefined when unavailable.
 * @param baseScore Baseline the score was calculated with.
 * @returns A value in 0..1, or 0.5 when the score is unknown.
 */
export const normalizeDamageToScore = (score: number | undefined, baseScore: number): number => {
  if (score === undefined) return 0.5;
  const { min, max } = damageToScoreBounds(baseScore);
  return max === min ? 0.5 : clamp01((score - min) / (max - min));
};

export const filterUniqueBy = (arr: NamedResource[]): NamedResource[] => {
  return arr.filter(function(this: Set<string>, { name }: NamedResource) {
    return !this.has(name) && this.add(name);
  }, new Set<string>());
};

export const cloneDamageRelations = (dr: DamageRelations): DamageRelations => ({
  double_damage_from: [...dr.double_damage_from],
  half_damage_from: [...dr.half_damage_from],
  no_damage_from: [...dr.no_damage_from],
  double_damage_to: [...dr.double_damage_to],
  half_damage_to: [...dr.half_damage_to],
  no_damage_to: [...dr.no_damage_to],
  quadruple_damage_from: [...(dr.quadruple_damage_from || [])],
  quarter_damage_from: [...(dr.quarter_damage_from || [])],
  damage_from_score: dr.damage_from_score,
  damage_to_score: dr.damage_to_score
});

export const createTypeSummary = (dr: DamageRelations) => ({
  weaknesses: ((dr.quadruple_damage_from || []).concat(dr.double_damage_from)).map(w => w.name),
  quadruple_weaknesses: (dr.quadruple_damage_from || []).map(w => w.name),
  resistances: dr.no_damage_from
    .concat(dr.quarter_damage_from || [])
    .concat(dr.half_damage_from)
    .map(r => r.name),
  ineffectives: dr.no_damage_to
    .concat(dr.half_damage_to)
    .map(i => i.name),
  coverages: dr.double_damage_to.map(c => c.name),
  damage_from_score: dr.damage_from_score,
  damage_to_score: dr.damage_to_score
});
