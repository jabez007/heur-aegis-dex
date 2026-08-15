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
 * the slots available for coverage. A Pokemon reaching fewer types than it has
 * slots for runs all of them, which the clamp handles.
 *
 * ## Can learn is not would run
 *
 * What remains is how those slots get shared out, and sharing them evenly is
 * wrong in a way that shows up plainly in the result. Measured over Regulation
 * M-B, an even split ranked **Psychic third** among attacking types while
 * Psychic hits 14.9% of the pool super-effectively, and ranked **Ice and Flying
 * fourteenth and fifteenth** while both hit 23.6%. Psychic and Grass are on
 * everything's TM list; nobody spends a slot on them, because there is nothing
 * to point them at. The even split cannot see that, so it prices a Psychic
 * weakness above a Ground weakness.
 *
 * The fix is that a coverage slot is spent to hit something, so the share a type
 * gets is proportional to how much it hits — specifically, to the fraction of
 * the pool it catches super-effectively that this Pokemon's own STAB does not
 * already catch. Marginal, because coverage exists to fill the gaps STAB leaves:
 * a Dragon/Ground Garchomp gets little from Ice, since Ground already answers
 * most of what Ice would.
 *
 * This is a generalization of the even split, not a replacement for it. When
 * every reachable type is worth the same, proportional allocation *is* the even
 * split; the two only diverge where the movepool contains types the Pokemon
 * would never click.
 *
 * ## Normal, which used to need a rule of its own
 *
 * The old even split needed an exception, and it is worth recording because the
 * new rule absorbs it. **Normal hits nothing for double damage anywhere on the
 * chart**, while 187 of the 208 legal species of Regulation M-B can click a
 * qualifying Normal move — Body Slam, Facade, Hyper Voice, the filler everything
 * learns. Counted as coverage, that made Normal the single most threatening
 * attacking type in the game at a weight of 1.000, ahead of Dark and Fighting.
 * That was worse than absurd in effect: nothing is weak to Normal, so the weight
 * could only ever be spent on the resistance side, and every Ghost type
 * collected the largest term in the model for an immunity to filler.
 *
 * The fix then was to filter coverage down to types something is weak to. Under
 * proportional allocation no filter is needed: a type that hits nothing has no
 * marginal value, so it takes no share of the slots. Normal comes out at 0.266
 * either way — verified identical across all 18 types — which is what a
 * STAB-only threat carried by a tenth of the pool should look like. The filter
 * is gone and the guarantee is a test, since a special case that has become a
 * consequence is exactly the kind of thing a later refactor reintroduces.
 *
 * STAB is unaffected throughout. A Normal-type still clicks its Normal moves, so
 * its own typing counts in full as it does for everything else.
 *
 * ## What is still not modelled
 *
 * It biases **up** by ignoring the non-damaging moves that really do take slots
 * — Protect is close to universal in doubles. It biases **down** by spreading
 * slots proportionally rather than assuming best play: a Pokemon that plainly
 * runs one particular coverage move still contributes a fraction to each of its
 * alternatives. Assuming best play was measured — allocate every slot to the
 * highest-value types and nothing to the rest — and rejected: it ranks the types
 * at a Spearman of only 0.63 against the proportional reading, and puts Electric
 * at 0.165 and Dragon at 0.157, which says a Thunderbolt weakness is worth about
 * a sixth of a Close Combat one. Argmax collapses the fact that different builds
 * make different choices from the same movepool.
 *
 * Neither bias has a measurement behind it, so neither is applied.
 */

import { getCoverageMoveTypes } from './coverageMoves';
import type { PokemonStats } from './pokedexTypes';

/** What a defending type takes from each attacking type, as the catalog holds it. */
export interface TypeDefenseRelations {
  readonly doubleDamageFrom: readonly string[];
  readonly halfDamageFrom: readonly string[];
  readonly noDamageFrom: readonly string[];
}

/** Defending type name to its damage relations. */
export type ThreatTypeChart = Readonly<Record<string, TypeDefenseRelations>>;

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
 * Damage an attacking type deals to a defending typing, as a multiplier.
 *
 * @param chart Damage relations by defending type name.
 * @param attackType Attacking type.
 * @param defendTypes The defender's own types.
 * @returns The product of the per-type multipliers, so 0 through 4.
 */
export function typeMultiplier(
  chart: ThreatTypeChart,
  attackType: string,
  defendTypes: readonly string[]
): number {
  return defendTypes.reduce((product, defendType) => {
    const relations = chart[defendType];
    if (!relations) return product;
    if (relations.noDamageFrom.includes(attackType)) return 0;
    if (relations.doubleDamageFrom.includes(attackType)) return product * 2;
    if (relations.halfDamageFrom.includes(attackType)) return product * 0.5;
    return product;
  }, 1);
}

/**
 * Which pool members each attacking type catches super-effectively.
 *
 * Computed once per measurement and read many times: the allocation below asks
 * this question for every attacker against every type it can reach, which is
 * quadratic in the pool if the chart is walked each time.
 *
 * @param pool Members of the metagame.
 * @param typeNames Attacking types to profile.
 * @param chart Damage relations by defending type name.
 * @returns Attacking type to a mask over `pool`, true where it hits for 2x or more.
 */
function superEffectiveMasks(
  pool: readonly ThreatPoolMember[],
  typeNames: readonly string[],
  chart: ThreatTypeChart
): Record<string, boolean[]> {
  return Object.fromEntries(typeNames.map((typeName) => [
    typeName,
    pool.map((member) => typeMultiplier(chart, typeName, member.types) >= 2)
  ]));
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
 * @param chart Damage relations by defending type name, used to work out what a
 *   coverage move would actually buy its user — see the module comment.
 * @returns Expected share of the pool bringing a move of each type, in 0..1.
 */
export function measureTypeThreat(
  pool: readonly ThreatPoolMember[],
  typeNames: readonly string[],
  chart: ThreatTypeChart
): Record<string, number> {
  const totals: Record<string, number> = Object.fromEntries(typeNames.map((name) => [name, 0]));
  if (pool.length === 0) return totals;

  const hits = superEffectiveMasks(pool, typeNames, chart);

  pool.forEach((member) => {
    const own = new Set(member.types);
    own.forEach((typeName) => {
      if (typeName in totals) totals[typeName] += 1;
    });

    const coverage = getCoverageMoveTypes(member.name, member.stats)
      .filter((typeName) => !own.has(typeName) && typeName in totals);
    const coverageSlots = Math.max(0, MOVESLOTS - own.size);
    if (coverage.length === 0 || coverageSlots === 0) return;

    // What this attacker already answers off STAB. Coverage is priced against
    // the gap that leaves, not against the field as a whole.
    const answered = pool.map((_, index) => [...own].some((typeName) => hits[typeName]?.[index]));
    const value = coverage.map((typeName) =>
      hits[typeName].reduce((count, hit, index) => count + (hit && !answered[index] ? 1 : 0), 0));

    // A movepool that buys nothing new gets no slots — the Normal case, and the
    // handful of attackers whose STAB already covers everything they can reach.
    // Exiting here also keeps the ratio below from dividing by zero.
    const totalValue = value.reduce((sum, entry) => sum + entry, 0);
    if (totalValue === 0) return;

    coverage.forEach((typeName, index) => {
      // Clamped because a slot cannot be spent twice on the same move. The lost
      // share is real and not redistributed: a Pelipper with two free slots and
      // one type worth reaching runs Ice Beam once, not twice.
      totals[typeName] += Math.min(1, coverageSlots * value[index] / totalValue);
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
 * has the rest, and a type that buys no coverage now takes no coverage slot.
 * Fighting sets the maximum, which is a type things are weak to, so a weakness
 * can reach a weight of 1.
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
 * @param chart Damage relations by defending type name.
 * @returns Threat weights in 0..1.
 */
export function getTypeThreatWeights(
  pool: readonly ThreatPoolMember[],
  typeNames: readonly string[],
  chart: ThreatTypeChart
): TypeThreatWeights {
  return toTypeThreatWeights(measureTypeThreat(pool, typeNames, chart));
}
