import { describe, expect, it } from 'vitest';
import { BATTLE_FORMATS } from './battleFormats';
import { candidatePriority, generateRosters } from './rosterGeneration';
import type { PokemonEntry } from './pokemonEntry';

const stats = { hp: 80, attack: 100, defense: 90, 'special-attack': 100, 'special-defense': 90, speed: 80 };

const mon = (name: string, overrides: Partial<PokemonEntry> = {}): PokemonEntry => ({
  name,
  speciesName: name,
  typeName: 'normal',
  types: ['normal'],
  sprite: `${name}.png`,
  stats,
  baseStats: stats,
  statsTotal: 540,
  abilities: [],
  abilityName: '',
  abilityProfiles: {},
  weaknesses: [],
  quadrupleWeaknesses: [],
  resistances: [],
  immunities: [],
  coverages: [],
  moveCoverages: [],
  normalizedDamageToScore: 0.5,
  normalizedDamageFromScore: 0.5,
  ...overrides
});

const pool = (count: number) =>
  Array.from({ length: count }, (_, i) => mon(`mon-${i}`, { typeName: `t${i}`, types: [`t${i}`] }));

const doubles = BATTLE_FORMATS.doubles;
const singles = BATTLE_FORMATS.singles;

describe('candidatePriority', () => {
  it('prefers better typing at equal stats', () => {
    const good = mon('good', { normalizedDamageToScore: 0.9, normalizedDamageFromScore: 0.1 });
    const bad = mon('bad', { normalizedDamageToScore: 0.1, normalizedDamageFromScore: 0.9 });

    expect(candidatePriority(good)).toBeGreaterThan(candidatePriority(bad));
  });

  it('punishes a quadruple weakness heavily', () => {
    const clean = mon('clean');
    const fragile = mon('fragile', { weaknesses: ['fire'], quadrupleWeaknesses: ['fire'] });

    expect(candidatePriority(fragile)).toBeLessThan(candidatePriority(clean));
  });

  it('credits a support role', () => {
    // Otherwise the ranking is blind to the reason half these Pokemon get
    // brought at all.
    const supporter = mon('incineroar', { abilityName: 'intimidate' });
    const plain = mon('plain', { abilityName: 'blaze' });

    expect(candidatePriority(supporter)).toBeGreaterThan(candidatePriority(plain));
  });

  it('scores the selected ability, not every ability the Pokemon has', () => {
    // Choosing Blaze over Intimidate should cost the credit; the browser
    // applies the override before ranking so the order follows the choice.
    const chosen = mon('incineroar', {
      abilityName: 'blaze',
      abilities: [{ name: 'blaze', is_hidden: false }, { name: 'intimidate', is_hidden: true }]
    });

    expect(candidatePriority(chosen)).toBe(candidatePriority(mon('plain', { abilityName: 'blaze' })));
  });

  it('ignores doubles-only roles in singles', () => {
    const redirector = mon('togedemaru', { abilityName: 'lightning-rod' });
    const plain = mon('plain', { abilityName: 'blaze' });

    // No ally to pull attacks away from.
    expect(candidatePriority(redirector, { hasAlly: false }))
      .toBe(candidatePriority(plain, { hasAlly: false }));
    expect(candidatePriority(redirector, { hasAlly: true }))
      .toBeGreaterThan(candidatePriority(plain, { hasAlly: true }));
  });

  it('credits Intimidate in both formats', () => {
    // Intimidate drops Attack whether or not a partner is on the field.
    const supporter = mon('incineroar', { abilityName: 'intimidate' });
    const plain = mon('plain', { abilityName: 'blaze' });

    expect(candidatePriority(supporter, { hasAlly: false }))
      .toBeGreaterThan(candidatePriority(plain, { hasAlly: false }));
  });

  it('does not let one role outrank a quadruple weakness', () => {
    // A support role is worth real points, but not enough to promote a Pokemon
    // that folds to a common type.
    const fragileSupporter = mon('fragile', {
      abilityName: 'intimidate', weaknesses: ['fire'], quadrupleWeaknesses: ['fire']
    });

    expect(candidatePriority(fragileSupporter)).toBeLessThan(candidatePriority(mon('clean')));
  });
});

describe('generateRosters', () => {
  it('builds a full roster for the format', () => {
    const rosters = generateRosters({ pokemon: pool(12), format: doubles });

    expect(rosters.length).toBeGreaterThan(0);
    expect(rosters[0].members).toHaveLength(6);
    expect(rosters[0].evaluation.optionCount).toBe(15);
  });

  it('ranks rosters best first', () => {
    const scores = generateRosters({ pokemon: pool(12), format: doubles }).map((r) => r.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it('can field two Pokemon sharing a typing', () => {
    // The old type-based search made this impossible by construction.
    const shared = [
      mon('pelipper', { typeName: 'water/flying', types: ['water', 'flying'] }),
      mon('gyarados', { typeName: 'water/flying', types: ['water', 'flying'] }),
      mon('rotom', { typeName: 'electric/ghost', types: ['electric', 'ghost'] }),
      mon('metagross', { typeName: 'steel/psychic', types: ['steel', 'psychic'] })
    ];
    const rosters = generateRosters({ pokemon: shared, format: doubles, rosterSize: 4 });

    expect(rosters[0].members.map((m) => m.name).sort())
      .toEqual(['gyarados', 'metagross', 'pelipper', 'rotom']);
  });

  it('never repeats a species', () => {
    const forms = [
      mon('charizard', { speciesName: 'charizard' }),
      mon('charizard-mega-x', { speciesName: 'charizard' }),
      mon('charizard-mega-y', { speciesName: 'charizard' }),
      mon('blastoise', { speciesName: 'blastoise' }),
      mon('venusaur', { speciesName: 'venusaur' }),
      mon('pikachu', { speciesName: 'pikachu' })
    ];
    const rosters = generateRosters({ pokemon: forms, format: doubles, rosterSize: 4 });

    rosters.forEach((roster) => {
      const species = roster.members.map((m) => m.speciesName);
      expect(new Set(species).size).toBe(species.length);
    });
  });

  it('allows duplicate species when a format permits it', () => {
    const forms = [
      mon('charizard', { speciesName: 'charizard' }),
      mon('charizard-mega-x', { speciesName: 'charizard' }),
      mon('blastoise', { speciesName: 'blastoise' })
    ];
    const rosters = generateRosters({
      pokemon: forms, format: doubles, rosterSize: 3, allowDuplicateSpecies: true
    });

    expect(rosters[0].members).toHaveLength(3);
  });

  it('keeps every seeded Pokemon', () => {
    const seed = [mon('locked-a', { typeName: 'ta' }), mon('locked-b', { typeName: 'tb' })];
    const rosters = generateRosters({ pokemon: pool(10), format: doubles, seed });

    rosters.forEach((roster) => {
      const names = roster.members.map((m) => m.name);
      expect(names).toContain('locked-a');
      expect(names).toContain('locked-b');
    });
  });

  it('never duplicates a seeded Pokemon already present in the pool', () => {
    const shared = pool(8);
    const rosters = generateRosters({ pokemon: shared, format: doubles, seed: [shared[0]] });

    rosters.forEach((roster) => {
      const names = roster.members.map((m) => m.name);
      expect(new Set(names).size).toBe(names.length);
    });
  });

  it('returns nothing when the pool cannot fill a roster', () => {
    expect(generateRosters({ pokemon: pool(2), format: doubles })).toEqual([]);
    expect(generateRosters({ pokemon: pool(10), format: doubles, rosterSize: 0 })).toEqual([]);
  });

  it('returns nothing when the seed exceeds the roster size', () => {
    const seed = pool(7);
    expect(generateRosters({ pokemon: pool(10), format: doubles, seed, rosterSize: 6 })).toEqual([]);
  });

  it('builds smaller rosters for singles when asked', () => {
    const rosters = generateRosters({ pokemon: pool(12), format: singles, rosterSize: 3 });

    expect(rosters[0].members).toHaveLength(3);
    expect(rosters[0].evaluation.optionCount).toBe(1);
  });

  it('stays tractable on a large pool', () => {
    const started = Date.now();
    const rosters = generateRosters({ pokemon: pool(600), format: doubles });

    expect(rosters.length).toBeGreaterThan(0);
    // Candidate pruning is what keeps this bounded; without it the beam would
    // expand across the whole pool.
    expect(Date.now() - started).toBeLessThan(15000);
  });
});
