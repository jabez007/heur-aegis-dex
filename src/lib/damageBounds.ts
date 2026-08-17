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
import { damageFromScoreBounds, damageToScoreBounds } from './pokedexScoring';
import { buildDualTypes } from './resistantTypeScan';
import { isUniformTypeThreat } from './typeThreat';
import { calculateDamageToScore, censusTypings } from './defenderCensus';
import type { DamageScoreBounds } from './pokedexScoring';
import type { DefenderCensus } from './defenderCensus';
import type { PokemonTypeData } from './pokedexTypes';
import type { TypeThreatWeights } from './typeThreat';

/**
 * '' is the no-ability case: `createAbilityProfile` matches no rule and returns
 * the bare typing, which is what a Pokemon with an unmodelled ability scores.
 */
const ABILITY_CASES: readonly string[] = ['', ...TYPING_ABILITIES];

/** Sorted, so a typing is one key whichever slot order it arrives in. */
const typingKey = (types: readonly string[]): string => [...types].sort().join('/');

/** What the pool-relative bounds need to know about a candidate. */
export interface BoundedPoolMember {
  readonly types: readonly string[];
  readonly abilities: readonly { readonly name: string }[];
}

/**
 * Indexes every typing the lattice can produce, by sorted type name.
 *
 * Built once per call rather than cached, because the two callers below each
 * make one pass and the memoization that matters is a level up, on the selection.
 */
const typingIndex = (
  baseTypes: readonly PokemonTypeData[],
  baseScore: number,
  weights: TypeThreatWeights
): Map<string, PokemonTypeData> => new Map(
  [...baseTypes, ...buildDualTypes(baseTypes, baseScore, weights)]
    .map((typing) => [typingKey(typing.name.split('/')), typing])
);

/**
 * Extremes of the defensive score across the Pokemon a metagame can field.
 *
 * ## Why this exists beside `measureDamageFromBounds`
 *
 * That function bounds the *lattice*: all 171 typings crossed with all seventeen
 * damage-relation abilities, 3,078 profiles, on the argument that a superset of
 * any roster is the property a bound needs. The argument is sound and the bound
 * was still wrong for what it is used for, because a bound is not only a
 * guarantee — it is the denominator a score is normalized against, and a
 * denominator wider than the numerator ever reaches is the compression defect
 * this repo has now recorded five times.
 *
 * Measured over Regulation M-B, `normalizedDamageFromScore` occupied **40% of
 * its nominal 0..1 range** (p05 0.268, p95 0.665). `TYPE_MODULATION`'s docblock
 * claims the defensive-typing swing is 10.7 points of final ranking; the
 * realized swing was **3.83**, against 12.61 for Speed. Defensive typing — the
 * property this project was started to rank — was the fifth of eight inputs
 * deciding its own Browser's order, and it got there without any weight being
 * wrong. The stat terms are rescaled against the pool they are measured in
 * (`OBSERVED_STAT_TERMS`) and the typing terms were rescaled against every
 * profile the game can express. Two normalization policies in one score, and
 * only one of them was ever chosen.
 *
 * So this bounds the same score over the profiles the metagame actually
 * presents: each candidate's own typing, crossed with its *own* abilities.
 *
 * ## The determinism the lattice bound was protecting is kept
 *
 * `damageFromScoreBounds` argues that bounds must not come from "the types
 * present in a scan", so that an entry normalizes identically however it was
 * reached. That still holds. The pool here is a pure function of catalog,
 * regulation and cup — the same three inputs `getThreatWeights` has always
 * depended on — and not of the scan's filters, its stat floors or which Pokemon
 * happened to be listed alongside. A given selection produces one pool, one
 * weighting and one pair of bounds, which is what makes a cached scan safe to
 * re-score.
 *
 * What changes is what the number means, and the card copy has to say so: a
 * defensive score is now read against the format being played rather than
 * against every typing the game can express. For a tool whose premise is finding
 * strong defensive typings *for a format*, that is the more useful reading as
 * well as the better-scaled one.
 *
 * ## The no-ability case is always included
 *
 * Even for a Pokemon whose every ability alters its damage relations, because
 * `includeAbilityImmunities` is a user-facing toggle: with it off, every entry
 * is scored on its bare typing through `createRawAbilityProfile`. The union of
 * both scan modes is the honest reachable set, and leaving it out would let a
 * Rotom form fall outside the bounds the moment the checkbox is cleared.
 *
 * @param pool Candidates the metagame can field, with their own abilities.
 * @param baseTypes Single elemental types carrying their damage relations.
 * @param baseScore Baseline the scores are calculated with.
 * @param weights Threat weight per attacking type.
 * @returns The extremes reachable in this metagame, falling back to the lattice
 *   bound for an empty pool.
 */
export function measurePoolDamageFromBounds(
  pool: readonly BoundedPoolMember[],
  baseTypes: readonly PokemonTypeData[],
  baseScore: number,
  weights: TypeThreatWeights
): DamageScoreBounds {
  if (pool.length === 0) return measureDamageFromBounds(baseTypes, baseScore, weights);

  const typings = typingIndex(baseTypes, baseScore, weights);
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  pool.forEach((member) => {
    const typing = typings.get(typingKey(member.types));
    if (!typing) return;

    const abilityCases = ['', ...member.abilities
      .map((ability) => ability.name)
      .filter((name) => TYPING_ABILITIES.includes(name))];

    abilityCases.forEach((abilityName) => {
      const { damage_relations: dr } = createAbilityProfile(
        typing.damage_relations, abilityName, baseScore, weights
      );
      const score = dr.damage_from_score;
      if (score === undefined) return;
      if (score < min) min = score;
      if (score > max) max = score;
    });
  });

  return min < max ? { min, max } : measureDamageFromBounds(baseTypes, baseScore, weights);
}

/**
 * As above, for the offensive side: the extremes across the typings a metagame
 * can field rather than across all 171 the chart can express.
 *
 * `measureDamageToBounds` enumerates `censusTypings`, which is every pairing of
 * every type in the chart regardless of whether anything has it. The census it
 * scores against was already pool-derived, so only the range was universal —
 * which is the same half-migration the defensive side had.
 *
 * No ability cross product, for the reason `measureDamageToBounds` gives: every
 * ability the model prices changes what a Pokemon takes, none what it deals.
 *
 * @param pool Candidates the metagame can field.
 * @param census Field the scores are measured against.
 * @param baseScore Baseline the scores are calculated with.
 * @returns The extremes reachable in this metagame, falling back to the whole
 *   chart for an empty pool.
 */
export function measurePoolDamageToBounds(
  pool: readonly BoundedPoolMember[],
  census: DefenderCensus,
  baseScore: number
): DamageScoreBounds {
  if (pool.length === 0) return measureDamageToBounds(census, baseScore);

  const seen = new Set<string>();
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  pool.forEach((member) => {
    const key = typingKey(member.types);
    if (seen.has(key)) return;
    seen.add(key);

    const score = calculateDamageToScore(member.types, census, baseScore);
    if (score < min) min = score;
    if (score > max) max = score;
  });

  return min < max ? { min, max } : measureDamageToBounds(census, baseScore);
}

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

/** As above, for the offensive side. Keyed on census identity for the same reason. */
const toCache = new WeakMap<DefenderCensus, Map<number, DamageScoreBounds>>();

/**
 * Derives the extremes of `calculateDamageToScore` under a census.
 *
 * No ability cross product here, unlike the defensive bounds. Every ability the
 * model prices changes what a Pokemon *takes*; none changes what it deals, so
 * `pokedexAbilities` recomputing the offensive score after applying one always
 * lands on the number it started with. The 171 typings are the whole space.
 *
 * @param census Field the scores are measured against.
 * @param baseScore Baseline the scores are calculated with.
 * @returns The minimum and maximum offensive score a typing reaches, which for
 *   the chart census is `damageToScoreBounds(baseScore)`.
 */
export function measureDamageToBounds(
  census: DefenderCensus,
  baseScore: number
): DamageScoreBounds {
  // Same argument as above: the chart census has a published measurement with a
  // date on it, and recomputing it here would give one number two sources.
  if (census.isChart) return damageToScoreBounds(baseScore);

  const byBaseScore = toCache.get(census) ?? new Map<number, DamageScoreBounds>();
  const cached = byBaseScore.get(baseScore);
  if (cached) return cached;

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  censusTypings(census.chart).forEach((typing) => {
    const score = calculateDamageToScore(typing, census, baseScore);
    if (score < min) min = score;
    if (score > max) max = score;
  });

  const bounds: DamageScoreBounds = min <= max ? { min, max } : damageToScoreBounds(baseScore);
  byBaseScore.set(baseScore, bounds);
  toCache.set(census, byBaseScore);
  return bounds;
}
