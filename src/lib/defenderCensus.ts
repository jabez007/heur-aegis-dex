/**
 * Who you are attacking, and how much of the field each of them is.
 *
 * `typeThreat.ts` made the *defensive* score answer to the metagame: a weakness
 * costs what the pool can actually exploit. The offensive score kept counting
 * chart entries, so a typing was rewarded for hitting types that may not be in
 * the format at all. This is the other half.
 *
 * ## The old formula was already weighted
 *
 * It read `baseScore + double_damage_to.length - 0.5 * half_damage_to.length -
 * no_damage_to.length`, which looks like a plain count and is not. Counting one
 * unit per chart entry is exactly the score you get against a field holding
 * **one pure-typed Pokemon of each of the eighteen types** — a census, and a
 * false one. No metagame looks like that. Regulation M-B holds 208 species over
 * about a hundred distinct typings, most of them dual.
 *
 * So the change is not "add weights to an unweighted formula". It is replacing
 * one census with a measured one, and `chartCensus` keeps the old assumption
 * available and named, which is what the live path uses when it has no pool to
 * measure.
 *
 * ## Why this measure is prevalence, and the defensive one is not
 *
 * `typeThreat.ts` opens by rejecting typing prevalence and choosing move
 * *availability*, because what hits you comes out of a movepool: Fighting is a
 * constant threat in a format with few Fighting-types, since half the field can
 * click Close Combat. That argument does not transfer, and its mirror image is
 * true here. What you attack is not a move, it is a Pokemon standing in front of
 * you, and what is standing in front of you is a typing. So the offensive census
 * counts typings and the defensive weighting counts move access, and the two
 * being different measures over the same pool is the point rather than an
 * inconsistency.
 *
 * ## Why typings rather than types
 *
 * A census keyed by single defending type cannot see that Ground hits Steel for
 * double and Steel/Flying for nothing. Measured across all 171 typings against
 * Regulation M-B, weighting the existing per-type buckets by prevalence agrees
 * with a direct measurement over real typings at a Spearman of only 0.941 —
 * against 0.915 for the chart count it would replace. Two and a half points of
 * correlation is not worth a rewrite; the direct measure is, and costs the same
 * plumbing.
 *
 * Ground/Steel is the case that shows it. Eight M-B species resist it, and seven
 * are Flying types immune to its Ground half — Corviknight, Skarmory, Talonflame,
 * Charizard, Gyarados, Pelipper, Emolga. A per-type census sees "Ground hits
 * Steel and Rock and Fire" and credits it for opponents it cannot touch.
 */

import { typeMultiplier, type ThreatTypeChart } from './typeThreat';
import type { DamageRelations } from './pokedexTypes';

/** One defending typing and how much of the field it accounts for. */
export interface CensusEntry {
  /** The defender's own types, one or two. */
  readonly types: readonly string[];
  /** Share of the field, on a scale where the whole field totals the type count. */
  readonly weight: number;
}

/** A field to score an attacking typing against. */
export interface DefenderCensus {
  readonly entries: readonly CensusEntry[];
  /** Damage relations by defending type name, to resolve multipliers. */
  readonly chart: ThreatTypeChart;
  /**
   * Whether this is the chart census rather than a measured one. Lets callers
   * take the published `OBSERVED_DAMAGE_TO` bounds instead of re-deriving a
   * number that already has a date and a script behind it.
   */
  readonly isChart: boolean;
}

/**
 * Builds a chart from already-fetched base types.
 *
 * The scan and the live path both hold their types in PokeAPI's shape, and the
 * multiplier lookup wants names. Converting here keeps that translation in one
 * place rather than at each of the two call sites.
 *
 * @param types Single elemental types carrying their damage relations.
 * @returns Damage relations by defending type name.
 */
export function chartFromTypeData(
  types: readonly { readonly name: string; readonly damage_relations: DamageRelations }[]
): ThreatTypeChart {
  const names = (bucket: { name: string }[] | undefined) => (bucket || []).map(({ name }) => name);
  return Object.fromEntries(types
    .filter((type) => !type.name.includes('/'))
    .map((type) => [type.name, {
      doubleDamageFrom: names(type.damage_relations.double_damage_from),
      halfDamageFrom: names(type.damage_relations.half_damage_from),
      noDamageFrom: names(type.damage_relations.no_damage_from)
    }]));
}

/**
 * The field the old formula assumed: one pure-typed Pokemon of each type.
 *
 * Kept because the live path cannot measure a pool before fetching one, and
 * because naming the assumption is the only way to see it is an assumption.
 *
 * @param chart Damage relations by defending type name.
 * @returns A census of one unit per elemental type.
 */
export function chartCensus(chart: ThreatTypeChart): DefenderCensus {
  return {
    entries: Object.keys(chart).map((name) => ({ types: [name], weight: 1 })),
    chart,
    isChart: true
  };
}

/**
 * Measures the typings a metagame actually fields.
 *
 * Grouped by typing rather than kept per member, because two Water/Flying
 * Pokemon are one matchup asked twice and the score only needs to ask once.
 *
 * Total mass is normalized to `typeCount`, which is the mass `chartCensus`
 * carries. That keeps `damage_to_score` on the scale every downstream constant
 * was measured against, and keeps `baseScore` meaning what it means everywhere
 * else: the score of a typing that is neutral to the entire field.
 *
 * @param pool Members of the metagame, carrying their own types.
 * @param chart Damage relations by defending type name.
 * @param typeCount Number of types in play, which the census mass is scaled to.
 * @returns A census over the pool's distinct typings.
 */
export function measureDefenderCensus(
  pool: readonly { readonly types: readonly string[] }[],
  chart: ThreatTypeChart,
  typeCount: number
): DefenderCensus {
  if (pool.length === 0) return chartCensus(chart);

  const counts = new Map<string, { types: readonly string[]; count: number }>();
  pool.forEach((member) => {
    const key = [...member.types].sort().join('/');
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else counts.set(key, { types: member.types, count: 1 });
  });

  const scale = typeCount / pool.length;
  return {
    entries: [...counts.values()].map(({ types, count }) => ({ types, weight: count * scale })),
    chart,
    isChart: false
  };
}

/**
 * What one matchup is worth to the attacker.
 *
 * `multiplier - 1`, the same identity the defensive buckets use and the same one
 * the old offensive formula already followed at its three multipliers: double is
 * +1, half is -0.5, nothing is -1. Stating it as the identity extends it to the
 * two that only a real dual-typed defender produces, 4x at +3 and 0.25x at
 * -0.75, which the chart census never reaches.
 *
 * **Immunity is priced at -1 here and `IMMUNITY_VALUE` prices it at -2
 * defensively.** That asymmetry is deliberate. A defensive immunity is a
 * threshold — the attack cannot be made to work, whatever it is. An offensive
 * one is a move you do not click: your Ground move cannot touch Corviknight and
 * you have three other moves. Being unable to hit something is a smaller problem
 * than being unable to survive it.
 *
 * @param multiplier Best damage multiplier the attacker can get on the defender.
 * @returns The matchup's contribution, before the census weight.
 */
export const damageToCoefficient = (multiplier: number): number => multiplier - 1;

/**
 * Best multiplier an attacking typing can reach against a defending one.
 *
 * The best rather than the sum, because an attacker clicks one move: a
 * Ground/Ice Pokemon facing a Steel type uses the Ground move.
 *
 * @param chart Damage relations by defending type name.
 * @param attackTypes The attacker's own types.
 * @param defendTypes The defender's own types.
 * @returns The largest multiplier available, 0 through 4.
 */
export function bestMultiplier(
  chart: ThreatTypeChart,
  attackTypes: readonly string[],
  defendTypes: readonly string[]
): number {
  return attackTypes.reduce(
    (best, attackType) => Math.max(best, typeMultiplier(chart, attackType, defendTypes)),
    0
  );
}

/**
 * Scores an attacking typing against a field.
 *
 * @param attackTypes The attacker's own types, which are its STAB.
 * @param census Field to score against.
 * @param baseScore Baseline, which is also the number of types in play.
 * @returns The offensive score, which is `baseScore` for a typing that is
 *   neutral to everything the census holds.
 */
export function calculateDamageToScore(
  attackTypes: readonly string[],
  census: DefenderCensus,
  baseScore: number
): number {
  return census.entries.reduce(
    (score, { types, weight }) =>
      score + (damageToCoefficient(bestMultiplier(census.chart, attackTypes, types)) * weight),
    baseScore
  );
}

/** Every typing on a chart: each type alone, then every unordered pair. */
export function censusTypings(chart: ThreatTypeChart): readonly (readonly string[])[] {
  const names = Object.keys(chart);
  const typings: string[][] = names.map((name) => [name]);
  names.forEach((first, index) => {
    names.slice(index + 1).forEach((second) => typings.push([first, second]));
  });
  return typings;
}
