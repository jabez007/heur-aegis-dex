/**
 * How hard a Pokemon hits with the types it already has.
 *
 * Every offensive number in the model is built from base stats and type charts.
 * Nothing in it knows the difference between a 60-power move and a 120-power
 * one, so two Pokemon with the same Attack and the same typing score identically
 * even when one of them leads with Close Combat and the other has nothing above
 * Brick Break. This is the missing factor.
 *
 * ## Read against the attacking bias, for the same reason coverage is
 *
 * The table stores both damage classes because the answer differs sharply by
 * class and the wrong one is often the larger. Corviknight's best special STAB
 * is Steel Beam at 133 and its best physical is Brave Bird at 120, but at 87
 * Attack against 53 Special Attack it will never fire the Steel Beam. Reading
 * `max` off the table would credit a third of this roster with a number it
 * cannot reach, and the inflation is concentrated exactly where it does most
 * damage: Steel-types, because Steel Beam is special and Steel-types are
 * overwhelmingly physical.
 *
 * So the class is resolved through `getAttackerBias`, the same rule the coverage
 * table already uses, and genuinely mixed attackers take the better of the two
 * because they really can run either.
 *
 * ## Zero is an answer, not missing data
 *
 * A Pokemon can have no usable STAB move of a class at all — Rotom-Wash reads
 * `physical: 0`, because Electric and Water offer it nothing physical worth
 * clicking. That is different from being absent from the table, which means the
 * variety has no learnset in this version group. Callers that need to tell the
 * two apart should use `hasStabPowerData`; callers that do not can treat both as
 * "no information" and fall back, which is what `getStabPower` returns null for.
 *
 * ## Not yet wired into scoring, and the measurement says why
 *
 * Nothing reads this into a score today. `npm run measure:stab-power` asked the
 * two questions that decide whether it should, over the 208-species M-B pool.
 *
 * **Is it independent?** Yes. Rank correlation against everything the model
 * already scores is at most 0.151, and against offensive typing — the specific
 * double-counting worry, since Fighting and Fire carry the heaviest STAB and are
 * also rated highly on offence — it is 0.120. Splitting the variance says the
 * same thing with the mechanism attached: typing explains 40.4% of firepower, so
 * **59.6% is per-Pokemon** and genuinely new. This is not the situation
 * `candidatePriority` records for defensive typing, which was being paid for
 * three times over.
 *
 * **Does it discriminate?** Barely, and this is the finding that matters. The
 * usable range is 77..120 at a spread of 1.56x, across 13 distinct values, and a
 * third of the pool sits at exactly 120 — p75 and the maximum are the same
 * number. It cannot separate the top of the roster at all. What it separates is
 * the *bottom*: Beartic at 77, and Pinsir, Scizor, Orthworm and Lycanroc at 80,
 * against everyone with a real 120-power STAB.
 *
 * The discrimination collapsed when the exclusion list was corrected, and that
 * is the honest reading rather than a disappointment. Before Steel Beam and
 * Gigaton Hammer were excluded the spread was 2.08x — but those values were
 * unsustainable moves, and half of them were *special* numbers on physical
 * Steel-types that would never fire them. The apparent resolution was the error.
 *
 * ## What that implies, and the risk it carries
 *
 * A term that only speaks at the bottom of the range is a penalty, not a rating,
 * and it should enter as one — at a shallow depth. At 0.2 it moves the median
 * Pokemon 9 places and rank-correlates 0.982 with today's order.
 *
 * The risk is concentrated in exactly the Pokemon it would penalize. Scizor
 * reads 80 because X-Scissor and Iron Head are the best its typing offers, which
 * is true and yet gets Scizor badly wrong: it is a strong Pokemon *because* of
 * Technician and priority, neither of which this model prices. Penalizing weak
 * STAB therefore hits hardest where the model is already blindest. Before this
 * is wired in, the ability multipliers owe an answer for Technician, and the
 * usage-correlation check owes a number for whether any of this points the right
 * way.
 *
 * Folding it in also has to be done as a modulation with a stated share, and
 * that requires re-measuring OBSERVED_STAT_TERMS, COMPOSITE_BOUNDS and
 * ROSTER_ALTERNATIVE_SCORE_MARGIN, plus a scan cache bump.
 */

import { getAttackerBias } from './coverageMoves';
import { STAB_POWER } from './stabPowerData';
import type { PokemonStats } from './pokedexTypes';

export { STAB_POWER };
export type { StabPower } from './stabPowerData';

/**
 * Returns the expected power of the best STAB move a Pokemon would actually run.
 *
 * Omitting `stats` returns the better of the two classes, which is the honest
 * answer when the bias is unknown, so callers that have stats should pass them.
 *
 * @param varietyName PokeAPI `pokemon` name, for example `garchomp` or `rotom-wash`.
 * @param stats Base stats of the form it fights in, used to pick a damage class.
 * @returns Expected power, or null when the variety has no entry.
 */
export function getStabPower(
  varietyName: string | undefined | null,
  stats?: PokemonStats | null
): number | null {
  if (!varietyName) return null;
  const entry = STAB_POWER[varietyName];
  if (!entry) return null;

  const bias = getAttackerBias(stats);
  if (bias === 'physical') return entry.physical;
  if (bias === 'special') return entry.special;
  return Math.max(entry.physical, entry.special);
}

/**
 * Reports whether the table knows about a Pokemon at all.
 *
 * @param varietyName PokeAPI `pokemon` name.
 * @returns True when the Pokemon has an entry.
 */
export function hasStabPowerData(varietyName: string | undefined | null): boolean {
  return !!varietyName && varietyName in STAB_POWER;
}
