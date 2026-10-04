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
import { STATUS_MOVE_AILMENTS } from './statusMoveData';
import type { AbilityRole } from './abilityRoles';

export { UTILITY_MOVE_ROLES };

/**
 * Ailments that count as disrupting an opponent rather than chipping at it.
 *
 * The bar is the one the weather work used: the status has to change what the
 * opponent *does* this turn. Burn halves its physical attack for the rest of the
 * battle; sleep takes its turns away outright.
 *
 * **Paralysis is excluded, and it is the close call.** It is a speed effect, and
 * `speed-control` already exists as a role — folding Thunder Wave in there would
 * take that role from 92% of real tournament teams to nearly all of them and
 * stop it discriminating, which is the Protect lesson. Counting it here instead
 * would price the same function under two names.
 *
 * **Poison is excluded** because it deals damage over time without changing what
 * the opponent does on the turn it is applied, and **freeze** because no legal
 * Pokemon can inflict it reliably — 0 of 146 in a default scan.
 *
 * Measured over that scan: burn 25.3%, sleep 17.1%, and the pair together 35.6%.
 * Every ailment at once would be 56.8%, too common to tell anything apart.
 */
const DISRUPTIVE_AILMENTS: readonly string[] = ['burn', 'sleep'];

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
 * Support roles a Pokemon can fill with a *status* move.
 *
 * Reads `statusMoveData.ts`, which the generator has emitted since the status
 * work and which nothing scored until now: it was used only to price the
 * abilities that resist status, never to credit the Pokemon inflicting it. That
 * asymmetry cost Rotom-Wash and Grimmsnarl — 38th and 18th in the format,
 * ranked 118th and 56th — most of what they are brought for.
 *
 * @param varietyName PokeAPI `pokemon` name.
 * @returns `['disruption']` when it can reliably burn or sleep, else empty.
 */
export function getStatusRoles(varietyName: string | undefined | null): readonly AbilityRole[] {
  if (!varietyName) return [];
  const ailments = STATUS_MOVE_AILMENTS[varietyName] ?? [];
  return ailments.some((ailment) => DISRUPTIVE_AILMENTS.includes(ailment))
    ? ['disruption']
    : [];
}

/**
 * Every role a Pokemon can reach through a move, from either table.
 *
 * @param varietyName PokeAPI `pokemon` name.
 * @returns Roles it can fill with a move, sorted and deduplicated.
 */
export function getMoveSourcedRoles(varietyName: string | undefined | null): readonly AbilityRole[] {
  return [...new Set([...getUtilityRoles(varietyName), ...getStatusRoles(varietyName)])].sort();
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
