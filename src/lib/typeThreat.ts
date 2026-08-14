/**
 * How much each attacking type actually threatens a given pool.
 *
 * `calculateDamageFromScore` counted weaknesses. Every weakness cost the same
 * whatever the field could do about it, so a Pokemon weak only to Fighting
 * scored identically in a metagame full of Close Combat and in one containing
 * none. This module supplies the missing term: a weight per attacking type,
 * 0 to 1, that the defensive score multiplies each bucket by.
 *
 * The precedent is `statusThreat.ts`, and the argument transfers unchanged: the
 * pool this tool scores is a legitimate stand-in for the opponent, so what the
 * field *can do to you* is measurable without assuming anything about your own
 * moveset. Nothing here reads the scored Pokemon at all — only the pool it faces.
 *
 * ## Availability, not prevalence
 *
 * The obvious measure is how many of the pool *are* each type, and it is wrong.
 * Measured over the 208 legal species of Regulation M-B, the two readings are
 * close to inverted:
 *
 * | type     | is the type | can attack with it |
 * | -------- | ----------- | ------------------ |
 * | normal   | 9.6%        | 99.5%              |
 * | dark     | 10.6%       | 71.6%              |
 * | fighting | 10.1%       | 63.5%              |
 * | water    | 12.5%       | 28.9%              |
 * | fairy    | 8.7%        | 27.4%              |
 *
 * Water is the most common typing in the regulation and one of its rarest
 * attacking types. Fighting is middling as a typing and the third most available
 * attack, because 53% of the pool can click a Fighting move without being
 * Fighting-type at all — Close Combat, Body Press and Brick Break are nearly
 * everywhere. A weight built on typing would price a Fighting weakness near
 * nothing in a cup that happens to exclude Fighting-types, and be badly wrong:
 * the cup still hits it constantly.
 *
 * So the measure is *availability*: can a member of this pool bring a move of
 * this type. STAB and coverage are counted differently, below.
 *
 * ## What a coverage move is worth
 *
 * STAB is near-certain — a Pokemon brings its own types — so own typing counts
 * in full. A learnable coverage move is a maybe, and counting it in full would
 * flatten the whole measure: the median pool member reaches eight types beyond
 * its own, and it cannot run eight.
 *
 * The discount is the moveslot arithmetic rather than a tuned constant. Four
 * moves, minus the STAB slots the Pokemon will spend on its own types, leaves
 * the slots available for coverage; spread over the types it can reach, that is
 * the probability it brings any particular one. A Pokemon reaching fewer types
 * than it has slots for runs all of them, which the clamp handles.
 *
 * ## A coverage move has to buy coverage
 *
 * "Types it can reach" means types worth reaching. A coverage slot is spent to
 * hit something super-effectively, so a move type that hits *nothing* super
 * effectively never competes for one, and counting it as though it did inflates
 * that type by the size of the entire movepool.
 *
 * Exactly one type fails that test, and it is not a corner case. **Normal hits
 * nothing for double damage anywhere on the chart**, while 187 of the 208 legal
 * species of Regulation M-B can click a qualifying Normal move — Body Slam,
 * Facade, Hyper Voice, the filler everything learns. Counting those made Normal
 * the single most threatening attacking type in the game at a weight of 1.000,
 * ahead of Dark and Fighting, which is absurd on its face and was worse than
 * absurd in effect: nothing is weak to Normal, so that weight could only ever be
 * spent on the resistance side, and every Ghost type collected the largest term
 * in the model for an immunity to filler. Under `IMMUNITY_VALUE` it was worth
 * -4.000 on its own, more than Annihilape's four weaknesses combined.
 *
 * Restricting coverage to types that buy coverage drops Normal to 0.266, below
 * every other type, which is what a STAB-only threat carried by a tenth of the
 * pool should look like. Dark takes the maximum. The rule is stated generally
 * rather than as a Normal special case, and it happens to bind on one type
 * today; a chart where some other type stopped hitting anything would bind too.
 *
 * STAB is unaffected. A Normal-type still clicks its Normal moves, so its own
 * typing counts in full as it does for everything else.
 *
 * Two things push the result in opposite directions and are recorded rather than
 * corrected. It biases **up** by ignoring the non-damaging moves that really do
 * take slots — Protect is close to universal in doubles. It biases **down** by
 * treating a Pokemon's coverage types as interchangeable when in practice the
 * strongest one gets picked far more often than the median one. Neither has a
 * measurement behind it, so neither is applied.
 */

import { getCoverageMoveTypes } from './coverageMoves';
import type { PokemonStats } from './pokedexTypes';

/**
 * Attacking type name to its threat weight in 0..1, where the most available
 * attacking type in the pool is exactly 1.
 *
 * A type absent from the map weighs 1, so an empty map is the uniform weighting
 * the model used before this existed and every caller can default to it.
 */
export type TypeThreatWeights = Readonly<Record<string, number>>;

/** The uniform weighting: every type counts the same, as it did before. */
export const UNIFORM_TYPE_THREAT: TypeThreatWeights = Object.freeze({});

/**
 * Moves a Pokemon brings to a battle. STAB is assumed to occupy one slot per
 * own type, and what remains is what coverage competes for.
 */
export const MOVESLOTS = 4;

/** One pool member, reduced to what a threat measurement needs from it. */
export interface ThreatPoolMember {
  /** PokeAPI variety name, the key `coverageMoveData` is indexed by. */
  readonly name: string;
  /** The member's own elemental types. */
  readonly types: readonly string[];
  /** Base stats of the form it fights in, used to resolve its attacking bias. */
  readonly stats?: PokemonStats | null;
}

/**
 * Weight lookup with the uniform default.
 *
 * @param weights Threat weights, possibly empty.
 * @param typeName Attacking type name.
 * @returns The type's weight, or 1 when the map does not price it.
 */
export function typeThreatWeight(weights: TypeThreatWeights, typeName: string): number {
  const weight = weights[typeName];
  return weight === undefined ? 1 : weight;
}

/**
 * Whether a weighting is the uniform one, and so can take the pre-measured
 * bounds and cached scores rather than a fresh derivation.
 *
 * @param weights Threat weights to test.
 * @returns True when no type is priced at anything other than 1.
 */
export function isUniformTypeThreat(weights: TypeThreatWeights): boolean {
  return Object.values(weights).every((weight) => weight === 1);
}

/**
 * Measures the share of a pool that can attack with each type.
 *
 * The result is a probability-like share rather than a weight: it is what the
 * pool can do, before any normalization decides which type reads as 1. Exposed
 * separately from `toTypeThreatWeights` because the shares are the measurement
 * and the weights are a presentation of it — a diagnostic wants both.
 *
 * @param pool Members of the metagame being prepared against.
 * @param typeNames Every attacking type to report, so types no member can bring
 *   appear as 0 rather than going missing.
 * @param coverageTypes Types that hit something super-effectively, and so are
 *   worth a coverage slot. Anything outside this set is counted as a STAB threat
 *   only — see the module comment, where it is Normal and nothing else.
 * @returns Expected share of the pool bringing a move of each type, in 0..1.
 */
export function measureTypeThreat(
  pool: readonly ThreatPoolMember[],
  typeNames: readonly string[],
  coverageTypes: ReadonlySet<string>
): Record<string, number> {
  const totals: Record<string, number> = Object.fromEntries(typeNames.map((name) => [name, 0]));
  if (pool.length === 0) return totals;

  pool.forEach((member) => {
    const own = new Set(member.types);
    const coverage = getCoverageMoveTypes(member.name, member.stats)
      .filter((typeName) => !own.has(typeName) && coverageTypes.has(typeName));

    // Slots left after STAB, shared out over what the Pokemon can reach. A
    // Pokemon reaching nothing new divides by zero, so the empty case exits
    // before the ratio is taken.
    const coverageSlots = Math.max(0, MOVESLOTS - own.size);
    const perCoverageType = coverage.length > 0
      ? Math.min(1, coverageSlots / coverage.length)
      : 0;

    own.forEach((typeName) => {
      if (typeName in totals) totals[typeName] += 1;
    });
    coverage.forEach((typeName) => {
      if (typeName in totals) totals[typeName] += perCoverageType;
    });
  });

  typeNames.forEach((typeName) => {
    totals[typeName] /= pool.length;
  });
  return totals;
}

/**
 * Normalizes measured shares so the most available attacking type weighs 1.
 *
 * Max-normalization rather than the raw shares, because the raw shares would
 * shrink every bucket in `calculateDamageFromScore` at once and move the whole
 * score off the `baseScore` neutral line for reasons that have nothing to do
 * with the typing being scored.
 *
 * Normal used to set the maximum here, and the reasoning that made that look
 * tolerable is worth keeping as a warning. It was recorded as "a scale effect
 * and not a ranking one — a constant factor across all types cannot reorder
 * typings", which is true of the normalizing constant and beside the point: what
 * reorders typings is each type's weight *relative to the others*, and Normal at
 * 1.000 against Fighting at 0.588 is a ratio, not a constant. The module comment
 * has the rest, and the type that buys no coverage no longer competes for a
 * coverage slot. Dark sets the maximum now, and Dark is a type things are weak
 * to, so a weakness can reach a weight of 1.
 *
 * @param shares Output of `measureTypeThreat`.
 * @returns Weights in 0..1 with a maximum of exactly 1, or the uniform
 *   weighting when no type is available at all.
 */
export function toTypeThreatWeights(shares: Record<string, number>): TypeThreatWeights {
  const values = Object.values(shares);
  const max = values.length > 0 ? Math.max(...values) : 0;
  if (max <= 0) return UNIFORM_TYPE_THREAT;

  return Object.freeze(
    Object.fromEntries(Object.entries(shares).map(([typeName, share]) => [typeName, share / max]))
  );
}

/**
 * Measures a pool and normalizes in one step, which is what callers want.
 *
 * @param pool Members of the metagame being prepared against.
 * @param typeNames Every attacking type to price.
 * @param coverageTypes Types worth spending a coverage slot on.
 * @returns Threat weights in 0..1.
 */
export function getTypeThreatWeights(
  pool: readonly ThreatPoolMember[],
  typeNames: readonly string[],
  coverageTypes: ReadonlySet<string>
): TypeThreatWeights {
  return toTypeThreatWeights(measureTypeThreat(pool, typeNames, coverageTypes));
}
