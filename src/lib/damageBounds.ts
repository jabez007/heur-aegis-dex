/**
 * Reachable extremes of the weighted defensive score.
 *
 * `pokedexScoring.ts` records `OBSERVED_DAMAGE_FROM` as measured constants, and
 * the argument for measuring rather than deriving them is written there at
 * length. Read it first. This module exists because those constants describe one
 * particular weighting — the uniform one — and threat weighting produces a
 * different score with different extremes every time the pool changes.
 *
 * Normalizing a weighted score against the unweighted bounds would recreate
 * precisely the compression bug that comment documents. Weights are at most 1 and
 * mostly well below it, so every bucket shrinks, the reachable range closes in
 * around `baseScore`, and a defensive term normalized against the old wide range
 * would occupy a fraction of 0..1 and stop deciding anything. That failure is
 * this repo's most expensive recorded mistake; it is not being repeated for the
 * sake of avoiding a runtime pass.
 *
 * ## Why this can be computed rather than measured
 *
 * The measurement script `measure-damage-bounds.mjs` crosses all 171 type
 * combinations with every ability that alters damage relations. That is a
 * superset of any roster, which is the property a bound needs — a real Pokemon
 * cannot fall outside it. Nothing about that cross product depends on the
 * weighting: the same 3,078 profiles are scored, only the coefficients change.
 * So the same method runs here against whatever weights are in force.
 *
 * The determinism the constants were protecting is preserved. The bound depends
 * on the type lattice and the ability tables, both fixed, plus the weight vector
 * — never on which Pokemon happened to be scanned. The same cup always produces
 * the same weights and therefore the same bounds, so an entry normalizes
 * identically however it was reached.
 *
 * The script stays the authority for the uniform case. `damageBounds.test.ts`
 * asserts this module reproduces its published numbers exactly, which is what
 * makes the two readings one measurement rather than two that might drift.
 */

import { createAbilityProfile, TYPING_ABILITIES } from './pokedexAbilities';
import { damageFromScoreBounds } from './pokedexScoring';
import { buildDualTypes } from './resistantTypeScan';
import { isUniformTypeThreat } from './typeThreat';
import type { DamageScoreBounds } from './pokedexScoring';
import type { PokemonTypeData } from './pokedexTypes';
import type { TypeThreatWeights } from './typeThreat';

/**
 * '' is the no-ability case: `createAbilityProfile` matches no rule and returns
 * the bare typing, which is what a Pokemon with an unmodelled ability scores.
 */
const ABILITY_CASES: readonly string[] = ['', ...TYPING_ABILITIES];

/** Bounds are pure in their inputs, and the cross product is not free. */
const cache = new WeakMap<TypeThreatWeights, Map<number, DamageScoreBounds>>();

/**
 * Derives the extremes of `calculateDamageFromScore` under a weighting.
 *
 * Memoized per weight vector, so a scan or a cup pays for the cross product once
 * however many entries it normalizes. The weights must be a stable object for
 * that to bite — `getTypeThreatWeights` freezes and returns one per pool, which
 * is the intended usage.
 *
 * @param baseTypes Single elemental types carrying their damage relations. The
 *   dual combinations are built from these.
 * @param baseScore Baseline the scores are calculated with.
 * @param weights Threat weight per attacking type.
 * @returns The minimum and maximum weighted defensive score a real Pokemon
 *   reaches, which for uniform weights is `damageFromScoreBounds(baseScore)`.
 */
export function measureDamageFromBounds(
  baseTypes: readonly PokemonTypeData[],
  baseScore: number,
  weights: TypeThreatWeights
): DamageScoreBounds {
  // The uniform case has a published measurement with a date on it and a script
  // that produced it. Recomputing it here would be a second source for one
  // number, and the two would eventually disagree.
  if (isUniformTypeThreat(weights)) return damageFromScoreBounds(baseScore);

  const byBaseScore = cache.get(weights) ?? new Map<number, DamageScoreBounds>();
  const cached = byBaseScore.get(baseScore);
  if (cached) return cached;

  const combinations = [...baseTypes, ...buildDualTypes(baseTypes, baseScore, weights)];
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  combinations.forEach((combination) => {
    ABILITY_CASES.forEach((abilityName) => {
      const { damage_relations: dr } = createAbilityProfile(
        combination.damage_relations, abilityName, baseScore, weights
      );
      const score = dr.damage_from_score;
      if (score === undefined) return;
      if (score < min) min = score;
      if (score > max) max = score;
    });
  });

  // An empty or single-type chart can leave the extremes unset. Falling back to
  // the unweighted bounds keeps `normalizeDamageFromScore` on a real range
  // rather than handing it an infinity to divide by.
  const bounds: DamageScoreBounds = min <= max
    ? { min, max }
    : damageFromScoreBounds(baseScore);

  byBaseScore.set(baseScore, bounds);
  cache.set(weights, byBaseScore);
  return bounds;
}
