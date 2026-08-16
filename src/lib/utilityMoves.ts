/**
 * Support roles a Pokemon can fill with a move.
 *
 * The companion to `abilityRoles.ts`, which reads every modelled role off an
 * ability and therefore cannot see the Pokemon whose support is something it
 * learns. Corviknight is ranked on its attacking stat while the format plays it
 * for Tailwind; Pelipper's Wide Guard is invisible; and speed control — the most
 * decided-by capability in doubles — had no representation at all, because no
 * ability on this roster supplies it.
 *
 * This is the same split `coverageMoves.ts` makes between what a typing
 * threatens and what a moveslot can reach, applied to support instead of damage,
 * and it carries the same warning. Reachability is a weaker claim than
 * possession: a Pokemon that *can* learn Tailwind has not necessarily brought
 * it, and `analyzeTeamRoles` keeps move-sourced roles in a separate list so the
 * scorer can charge for the moveslot rather than pretending an ability and a
 * move are the same thing.
 *
 * @see UTILITY_MOVE_ROLES in scripts/gen-coverage-moves.mjs for what is selected
 *   and why Protect — on 100% of the roster — is not.
 */

import { UTILITY_MOVE_ROLES } from './utilityMoveData';
import type { AbilityRole } from './abilityRoles';

export { UTILITY_MOVE_ROLES };

/**
 * Support roles a Pokemon could bring with a move.
 *
 * @param varietyName PokeAPI `pokemon` name, for example `pelipper`.
 * @returns Roles it can fill, sorted. Empty when it has none or is unknown.
 */
export function getUtilityRoles(varietyName: string | undefined | null): readonly AbilityRole[] {
  if (!varietyName) return [];
  return UTILITY_MOVE_ROLES[varietyName] ?? [];
}

/**
 * Reports whether the table knows about a Pokemon at all.
 *
 * Absence means "fills no modelled role by move", which is the common case —
 * 229 of 359 varieties — rather than missing data.
 *
 * @param varietyName PokeAPI `pokemon` name.
 * @returns True when the Pokemon has an entry.
 */
export function hasUtilityMoveData(varietyName: string | undefined | null): boolean {
  return !!varietyName && varietyName in UTILITY_MOVE_ROLES;
}
