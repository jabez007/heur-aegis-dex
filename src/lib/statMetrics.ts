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
