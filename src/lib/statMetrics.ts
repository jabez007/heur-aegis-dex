import type { PokemonStats } from './pokedexTypes';

/**
 * Approximates average physical and special durability on a base-stat scale.
 * Damage endurance is proportional to HP multiplied by the relevant defense;
 * the square root returns each product to the same scale as ordinary stats.
 *
 * @param stats HP, Defense and Special Defense after unconditional abilities.
 * @returns Mean physical and special effective bulk.
 */
export function hpAdjustedBulk(
  stats: Pick<PokemonStats, 'hp' | 'defense' | 'special-defense'>
): number {
  const physicalBulk = Math.sqrt(stats.hp * stats.defense);
  const specialBulk = Math.sqrt(stats.hp * stats['special-defense']);
  return (physicalBulk + specialBulk) / 2;
}

/**
 * How much the weaker attacking stat counts toward offence.
 *
 * The weaker side is not worthless — it is the angle a Pokemon has left when
 * something walls its primary — but it is not a second attacker either, because
 * moveslots and the stat that powers them are both finite.
 *
 * Reasoned, not validated against usage data, like `MIXED_ATTACKER_RATIO`.
 */
export const SECONDARY_OFFENSE_WEIGHT = 0.3;

/**
 * Offensive stat value a Pokemon can actually bring to bear.
 *
 * `attack + special-attack` was the previous measure and it is blind to whether
 * a Pokemon can use both halves. Azumarill swings the 100 Attack Huge Power
 * built for it and never touches its 60 Special Attack; Blastoise has 83/85,
 * neither of them notable. Summed, Blastoise scored *higher* — 168 against 160.
 *
 * `coverageMoves.ts` already rejected this reasoning at the layer above. Its
 * `getAttackerBias` reads Azumarill's movepool as physical, on the argument that
 * crediting Pelipper with physical coverage it cannot use at 50 Attack describes
 * a Pokemon that does not exist. That argument stopped at the coverage layer and
 * never reached the term that scores the stats themselves.
 *
 * There was a second half to it. A 300 ceiling on the sum is only approachable
 * by a mixed attacker — the highest sum anywhere in the validation fixture is
 * 234 — so a one-sided attacker was capped near its own total no matter how
 * elite its real attacking stat, because half the numerator was a stat it never
 * used.
 *
 * ## Why this is smooth rather than a classification
 *
 * `getAttackerBias` returns a category, and reusing it here would put a cliff at
 * the boundary: two Pokemon either side of `MIXED_ATTACKER_RATIO` would score
 * very differently over a single point of difference. A category is right for
 * "which moves would this Pokemon run", where the answer really is discrete. It
 * is wrong for a magnitude. Discounting the weaker stat gives the same ordering
 * without the discontinuity.
 *
 * The rescaled ceiling is chosen so genuinely mixed attackers land where they
 * already did — Lucario moves 0.750 to 0.759, Simisear 0.653 to 0.653 — and only
 * one-sided attackers move. This is meant to stop under-rating them, not to
 * re-scale everything.
 *
 * @param stats Base stats of the form the Pokemon fights in, ability applied.
 * @returns Primary attacking stat plus the discounted secondary.
 */
export function effectiveOffense(stats: PokemonStats): number {
  const physical = stats.attack;
  const special = stats['special-attack'];
  return Math.max(physical, special) + (SECONDARY_OFFENSE_WEIGHT * Math.min(physical, special));
}
