import { describe, expect, it } from 'vitest';
import { STAB_POWER, getStabPower, hasStabPowerData } from './stabPower';
import type { PokemonStats } from './pokedexTypes';

const stats = (attack: number, specialAttack: number): PokemonStats => ({
  hp: 100, attack, defense: 100,
  'special-attack': specialAttack, 'special-defense': 100, speed: 100
});

describe('stab power table', () => {
  it('records what a Pokemon actually leads with', () => {
    // Annihilape's best physical Fighting move is Close Combat at 120, not the
    // Explosion an unrestricted maximum over its movepool would have picked.
    expect(STAB_POWER['annihilape'].physical).toBe(120);
    // Dragapult's special side is Draco Meteor, 130 discounted by 90% accuracy.
    expect(STAB_POWER['dragapult'].special).toBe(117);
  });

  it('keys on variety names, so forms with different typings differ', () => {
    // Aggron is Steel/Rock and reaches Head Smash; Mega Aggron is pure Steel and
    // loses that STAB entirely, which is exactly the kind of difference a
    // species-keyed table would erase.
    expect(STAB_POWER['aggron'].physical).toBe(120);
    expect(STAB_POWER['aggron-mega'].physical).toBe(80);
  });

  it('records zero when a Pokemon has no usable STAB of a class', () => {
    // Electric/Water offers Rotom-Wash nothing physical worth clicking.
    expect(STAB_POWER['rotom-wash'].physical).toBe(0);
    expect(STAB_POWER['rotom-wash'].special).toBeGreaterThan(0);
  });

  it('excludes moves whose listed power is not power they can bring on demand', () => {
    // Snorlax learns Self-Destruct at 250 and Giga Impact at 150. Neither is
    // what it hits with turn after turn; Double-Edge at 120 is.
    expect(STAB_POWER['snorlax'].physical).toBe(120);
    // Corviknight's only special Steel move above Brave Bird was Steel Beam,
    // which halves its own HP. PokeAPI reports that as `drain: 0`, so nothing
    // but the hand-maintained list catches it.
    expect(STAB_POWER['corviknight'].special).toBeLessThan(120);
  });

  it('caps at what a sustainable move can reach', () => {
    // Nothing should exceed the strongest repeatable STAB in the game. A value
    // above this means an unsustainable move got back into the table.
    const highest = Math.max(
      ...Object.values(STAB_POWER).map((entry) => Math.max(entry.physical, entry.special))
    );
    expect(highest).toBeLessThanOrEqual(140);
  });
});

describe('getStabPower', () => {
  it('reads the class the Pokemon would actually fire', () => {
    // Corviknight's special number is the larger one and it will never use it.
    expect(getStabPower('corviknight', stats(87, 53))).toBe(STAB_POWER['corviknight'].physical);
    expect(getStabPower('gardevoir', stats(65, 165))).toBe(STAB_POWER['gardevoir'].special);
  });

  it('gives genuinely mixed attackers the better of the two', () => {
    const entry = STAB_POWER['dragapult'];
    expect(getStabPower('dragapult', stats(120, 120)))
      .toBe(Math.max(entry.physical, entry.special));
  });

  it('falls back to the better class when the bias is unknown', () => {
    const entry = STAB_POWER['garchomp'];
    expect(getStabPower('garchomp')).toBe(Math.max(entry.physical, entry.special));
    expect(getStabPower('garchomp', null)).toBe(Math.max(entry.physical, entry.special));
  });

  it('returns null rather than zero for a Pokemon it has never heard of', () => {
    // Zero is a real answer meaning "no usable STAB of that class", so absence
    // has to be distinguishable from it.
    expect(getStabPower('missingno')).toBeNull();
    expect(getStabPower(undefined)).toBeNull();
    expect(getStabPower('ditto')).toBeNull();
    expect(getStabPower('rotom-wash', stats(65, 105))).toBe(90);
  });
});

describe('hasStabPowerData', () => {
  it('separates an absent Pokemon from one with no usable move', () => {
    expect(hasStabPowerData('garchomp')).toBe(true);
    expect(hasStabPowerData('rotom-wash')).toBe(true);
    expect(hasStabPowerData('ditto')).toBe(false);
    expect(hasStabPowerData(null)).toBe(false);
  });

  it('covers the same varieties the coverage table does', async () => {
    // Both tables come out of the same crawl, so a variety in one and not the
    // other means a generator run went wrong halfway through.
    const { COVERAGE_MOVE_TYPES } = await import('./coverageMoveData');
    expect(Object.keys(STAB_POWER).sort()).toEqual(Object.keys(COVERAGE_MOVE_TYPES).sort());
  });
});
