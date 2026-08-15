/**
 * Move-based offensive coverage.
 *
 * The type model treats a Pokemon's offensive coverage as identical to its own
 * typing, which is only its STAB. In practice coverage comes from moves: a
 * Ground/Dragon Garchomp threatens Steel and Ice through Iron Head and Fire
 * Fang, and the typing alone cannot see that.
 *
 * ## Why this is a separate field rather than a replacement
 *
 * Movepools are wide. Across the Regulation M-B roster the median Pokemon has
 * qualifying moves of ten different types out of eighteen, so treating "can
 * reach" and "threatens hard" as the same thing would flatten the offensive
 * signal almost to nothing. The two are kept distinct instead:
 *
 * - `coverages` — what a Pokemon threatens off STAB, reliably and at a damage
 *   multiplier. This stays the measure of offensive *quality*.
 * - move coverage — what a Pokemon can *reach* if it spends a moveslot. This is
 *   the right measure for "does the team have an answer to this weakness",
 *   where reachability is exactly the question.
 *
 * This mirrors the immunities/resistances split: a narrower companion to an
 * existing field, not a redefinition of it.
 *
 * ## Damage class
 *
 * "Can reach" is still too generous if it ignores which stat the move fires
 * off. A Pelipper learns Crunch, Iron Head and Poison Jab; at 50 Attack against
 * 95 Special Attack it will never click any of them. Measured across the
 * Regulation M-B roster, 16% of the coverage types credited to a clearly
 * one-sided attacker were reachable only through the wrong stat, and the tail
 * is far worse than the average — Sceptile and Appletun were over half wrong.
 *
 * So coverage is resolved against the Pokemon's attacking bias. Pokemon whose
 * two attacking stats are close keep the union of both classes, because they
 * genuinely can run either.
 */

import { COVERAGE_MOVE_TYPES } from './coverageMoveData';
import type { PokemonStats, PokemonTypeData } from './pokedexTypes';

export { COVERAGE_MOVE_TYPES };
export type { CoverageMoveTypes } from './coverageMoveData';

/** Minimum base power for a move to count as real coverage. */
export const COVERAGE_MOVE_MIN_POWER = 60;

/**
 * Ratio between the higher and lower attacking stat below which a Pokemon is
 * treated as running both damage classes.
 *
 * Reasoned, not validated against usage data: past roughly a 15% gap the weaker
 * side stops being worth one of four moveslots. Widening this admits more
 * coverage a Pokemon would not actually run; narrowing it starts denying
 * genuinely mixed attackers moves they do run.
 */
export const MIXED_ATTACKER_RATIO = 1.15;

export type AttackerBias = 'physical' | 'special' | 'mixed';

/**
 * Classifies which damage class a Pokemon's stats point at.
 *
 * Unknown or absent stats resolve to `mixed` rather than guessing, so a caller
 * with no stat data gets the full "can reach" answer instead of an arbitrary
 * half of it.
 *
 * @param stats Base stats of the form the Pokemon actually fights in.
 * @returns The damage class its coverage should be read against.
 */
export function getAttackerBias(stats?: PokemonStats | null): AttackerBias {
  const physical = Number(stats?.attack) || 0;
  const special = Number(stats?.['special-attack']) || 0;
  if (physical <= 0 || special <= 0) return 'mixed';

  const ratio = Math.max(physical, special) / Math.min(physical, special);
  if (ratio < MIXED_ATTACKER_RATIO) return 'mixed';
  return physical > special ? 'physical' : 'special';
}

/** PokeAPI version group the table was generated from. */
export const COVERAGE_MOVE_VERSION_GROUP = 'champions';

/**
 * PokeAPI Pokedex holding the roster of that version group — the species that
 * exist in the game at all.
 *
 * Paired with the version group above and stated rather than inferred, because
 * the two happen to share a name here and will not always. Everything outside
 * this Pokedex has an empty movepool for the unexciting reason that it is not in
 * the game, so anything reasoning about *opponents* has to filter on it: 208
 * species are in Champions and the catalog carries all 1,025 of the National
 * Dex. `getThreatPool` is the caller that needs this, and the failure it avoids
 * is described there.
 */
export const COVERAGE_MOVE_POKEDEX = 'champions';

/** Attacking type name to the defending types it hits for double damage. */
export type OffensiveTypeChart = Readonly<Record<string, readonly string[]>>;

/**
 * Builds an attacking-type chart from already-fetched base types.
 *
 * @param baseTypes Base elemental types carrying their damage relations.
 * @returns A map from attacking type to the types it hits super-effectively.
 */
export function buildOffensiveTypeChart(baseTypes: PokemonTypeData[]): OffensiveTypeChart {
  const chart: Record<string, string[]> = {};
  baseTypes.forEach((type) => {
    if (type.name.includes('/')) return;
    chart[type.name] = (type.damage_relations?.double_damage_to || []).map((target) => target.name);
  });
  return chart;
}

/**
 * Returns the move types a Pokemon can bring, by PokeAPI variety name.
 *
 * Omitting `stats` returns every type it can reach off either stat, which is
 * the honest answer when the bias is unknown — and also the pre-split reading,
 * so callers that have stats should pass them.
 *
 * @param varietyName PokeAPI `pokemon` name, for example `garchomp` or `raichu-alola`.
 * @param stats Base stats of the form it fights in, used to pick a damage class.
 * @returns Move types with a qualifying move, or an empty list when unknown.
 */
export function getCoverageMoveTypes(
  varietyName: string | undefined | null,
  stats?: PokemonStats | null
): readonly string[] {
  if (!varietyName) return [];
  const entry = COVERAGE_MOVE_TYPES[varietyName];
  if (!entry) return [];

  const bias = getAttackerBias(stats);
  if (bias === 'physical') return entry.physical;
  if (bias === 'special') return entry.special;
  return [...new Set([...entry.physical, ...entry.special])].sort();
}

/**
 * Works out which defending types a Pokemon can hit super-effectively using any
 * move it can learn.
 *
 * @param varietyName PokeAPI `pokemon` name.
 * @param chart Attacking-type chart from buildOffensiveTypeChart.
 * @param stats Base stats of the form it fights in, used to pick a damage class.
 * @returns Defending type names, sorted. Empty when the Pokemon is absent from the table.
 */
export function getMoveCoverage(
  varietyName: string | undefined | null,
  chart: OffensiveTypeChart,
  stats?: PokemonStats | null
): string[] {
  const moveTypes = getCoverageMoveTypes(varietyName, stats);
  if (moveTypes.length === 0) return [];

  const covered = new Set<string>();
  moveTypes.forEach((moveType) => {
    (chart[moveType] || []).forEach((target) => covered.add(target));
  });
  return [...covered].sort();
}

/**
 * Reports whether the table knows about a Pokemon at all.
 *
 * Absence means "no qualifying move recorded", which is also true of a Pokemon
 * outside the generated roster. Callers that need to distinguish "cannot reach
 * anything" from "not in the table" should check this first.
 *
 * @param varietyName PokeAPI `pokemon` name.
 * @returns True when the Pokemon has an entry.
 */
export function hasCoverageMoveData(varietyName: string | undefined | null): boolean {
  return !!varietyName && varietyName in COVERAGE_MOVE_TYPES;
}
