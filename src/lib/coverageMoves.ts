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
 */

import { COVERAGE_MOVE_TYPES } from './coverageMoveData';
import type { PokemonTypeData } from './pokedexTypes';

export { COVERAGE_MOVE_TYPES };

/** Minimum base power for a move to count as real coverage. */
export const COVERAGE_MOVE_MIN_POWER = 60;

/** PokeAPI version group the table was generated from. */
export const COVERAGE_MOVE_VERSION_GROUP = 'champions';

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
 * @param varietyName PokeAPI `pokemon` name, for example `garchomp` or `raichu-alola`.
 * @returns Move types with a qualifying move, or an empty list when unknown.
 */
export function getCoverageMoveTypes(varietyName: string | undefined | null): readonly string[] {
  if (!varietyName) return [];
  return COVERAGE_MOVE_TYPES[varietyName] || [];
}

/**
 * Works out which defending types a Pokemon can hit super-effectively using any
 * move it can learn.
 *
 * @param varietyName PokeAPI `pokemon` name.
 * @param chart Attacking-type chart from buildOffensiveTypeChart.
 * @returns Defending type names, sorted. Empty when the Pokemon is absent from the table.
 */
export function getMoveCoverage(varietyName: string | undefined | null, chart: OffensiveTypeChart): string[] {
  const moveTypes = getCoverageMoveTypes(varietyName);
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
