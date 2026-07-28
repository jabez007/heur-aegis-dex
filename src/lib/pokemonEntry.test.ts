import { describe, expect, it } from 'vitest';
import {
  collapseIndistinctVarieties,
  flattenToPokemon,
  getPokemonAbilityProfile,
  groupByTypeName,
  toPokemonEntry,
  withAbility
} from './pokemonEntry';
import type { PokemonListEntry } from './pokedexTypes';

const stats = { hp: 78, attack: 84, defense: 78, 'special-attack': 109, 'special-defense': 85, speed: 100 };

const scanEntry = (name: string, overrides: Partial<PokemonListEntry> = {}): PokemonListEntry => ({
  pokemon: { name },
  species_name: name,
  types: [{ type: { name: 'water' } }, { type: { name: 'flying' } }],
  sprite: `${name}.png`,
  stats,
  abilities: [{ name: 'keen-eye', is_hidden: false }],
  selected_ability_name: 'keen-eye',
  ability_profiles: {
    'keen-eye': {
      weaknesses: ['electric', 'rock'],
      quadruple_weaknesses: ['electric'],
      resistances: ['fighting', 'ground'],
      immunities: ['ground'],
      coverages: ['fire', 'rock'],
      damage_from_score: 20,
      damage_to_score: 20
    }
  },
  effective_move_coverages: ['fire', 'rock', 'grass'],
  ...overrides
});

describe('toPokemonEntry', () => {
  it('lifts the Pokemon out of its type grouping', () => {
    const entry = toPokemonEntry(scanEntry('pelipper'), 'water/flying')!;

    expect(entry.name).toBe('pelipper');
    expect(entry.speciesName).toBe('pelipper');
    expect(entry.typeName).toBe('water/flying');
    expect(entry.types).toEqual(['water', 'flying']);
  });

  it('carries the selected ability profile onto the entry', () => {
    const entry = toPokemonEntry(scanEntry('pelipper'), 'water/flying')!;

    expect(entry.abilityName).toBe('keen-eye');
    expect(entry.weaknesses).toEqual(['electric', 'rock']);
    expect(entry.quadrupleWeaknesses).toEqual(['electric']);
    expect(entry.immunities).toEqual(['ground']);
    expect(entry.moveCoverages).toEqual(['fire', 'rock', 'grass']);
  });

  it('normalizes damage scores onto the 0..1 scale', () => {
    const entry = toPokemonEntry(scanEntry('pelipper'), 'water/flying')!;

    expect(entry.normalizedDamageFromScore).toBeGreaterThanOrEqual(0);
    expect(entry.normalizedDamageFromScore).toBeLessThanOrEqual(1);
    // Anchored to the observed offensive range, 16..27 at baseScore 18.
    expect(entry.normalizedDamageToScore).toBeCloseTo((20 - 16) / (27 - 16));
  });

  it('computes a stats total when the scan did not', () => {
    const entry = toPokemonEntry(scanEntry('pelipper'), 'water/flying')!;
    expect(entry.statsTotal).toBe(78 + 84 + 78 + 109 + 85 + 100);
  });

  it('falls back to the grouping name when the entry has no types', () => {
    const entry = toPokemonEntry(scanEntry('mystery', { types: undefined }), 'ghost/dark')!;
    expect(entry.types).toEqual(['ghost', 'dark']);
  });

  it('rejects entries with no usable data', () => {
    expect(toPokemonEntry({ pokemon: { name: 'x' } } as PokemonListEntry, 'fire')).toBeNull();
    expect(toPokemonEntry({ pokemon: { name: '' }, stats } as PokemonListEntry, 'fire')).toBeNull();
  });
});

describe('flattenToPokemon', () => {
  const types = [
    { name: 'water/flying', pokemon: [scanEntry('pelipper'), scanEntry('gyarados')] },
    { name: 'water', pokemon: [scanEntry('vaporeon')] }
  ];

  it('produces one record per Pokemon across every grouping', () => {
    const flat = flattenToPokemon(types);

    expect(flat.map((entry) => entry.name)).toEqual(['pelipper', 'gyarados', 'vaporeon']);
  });

  it('keeps two Pokemon that share a typing', () => {
    // The whole point of the inversion: a typing groups Pokemon, it does not
    // stand in for one.
    const flat = flattenToPokemon(types);
    const waterFlying = flat.filter((entry) => entry.typeName === 'water/flying');

    expect(waterFlying).toHaveLength(2);
  });

  it('deduplicates a Pokemon appearing under more than one grouping', () => {
    const flat = flattenToPokemon([
      { name: 'water/flying', pokemon: [scanEntry('pelipper')] },
      { name: 'water', pokemon: [scanEntry('pelipper')] }
    ]);

    expect(flat).toHaveLength(1);
    // Type entries arrive ranked, so the first grouping is the better one.
    expect(flat[0].typeName).toBe('water/flying');
  });

  it('optionally collapses forms to one per species', () => {
    const forms = [{
      name: 'fire/flying',
      pokemon: [
        scanEntry('charizard'),
        scanEntry('charizard-mega-x', { species_name: 'charizard' })
      ]
    }];

    expect(flattenToPokemon(forms)).toHaveLength(2);
    expect(flattenToPokemon(forms, { uniqueBySpecies: true })).toHaveLength(1);
  });

  it('tolerates groupings with no Pokemon', () => {
    expect(flattenToPokemon([{ name: 'ice', pokemon: [] }, { name: 'bug' }])).toEqual([]);
  });
});

describe('collapseIndistinctVarieties', () => {
  const variety = (name: string, overrides: Partial<PokemonListEntry> = {}) => ({
    ...scanEntry(name),
    species_name: 'pikachu',
    is_default_variety: false,
    effective_move_coverages: [],
    ...overrides
  });

  it('drops cosmetic varieties that match the default in every modelled field', () => {
    // Pikachu's caps and outfits differ only in appearance, which this tool
    // does not model at all.
    const collapsed = collapseIndistinctVarieties([
      variety('pikachu', { is_default_variety: true, effective_move_coverages: ['fire'] }),
      variety('pikachu-libre'),
      variety('pikachu-world-cap'),
      variety('pikachu-phd')
    ]);

    expect(collapsed.map((entry) => entry.pokemon.name)).toEqual(['pikachu']);
  });

  it('keeps the default variety even when it appears last', () => {
    const collapsed = collapseIndistinctVarieties([
      variety('pikachu-libre'),
      variety('pikachu', { is_default_variety: true })
    ]);

    expect(collapsed[0].pokemon.name).toBe('pikachu');
  });

  it('falls back to the variety with coverage data when none is default', () => {
    // A cosmetic variant has no learnset of its own, so it must not stand in
    // for the entry that does.
    const collapsed = collapseIndistinctVarieties([
      variety('mimikyu-totem-disguised'),
      variety('mimikyu-disguised', { effective_move_coverages: ['ghost', 'fairy'] })
    ]);

    expect(collapsed[0].pokemon.name).toBe('mimikyu-disguised');
  });

  it('keeps varieties whose stats differ', () => {
    // Basculegion's forms are 112 Attack against 92, and 80 Special Attack
    // against 100 — genuinely different picks, not a cosmetic split.
    const male = variety('basculegion-male', {
      species_name: 'basculegion',
      stats: { ...stats, attack: 112, 'special-attack': 80 }
    });
    const female = variety('basculegion-female', {
      species_name: 'basculegion',
      stats: { ...stats, attack: 92, 'special-attack': 100 }
    });

    expect(collapseIndistinctVarieties([male, female])).toHaveLength(2);
  });

  it('keeps varieties whose abilities differ', () => {
    // Meowstic's forms share a stat line but not Prankster against Competitive.
    const male = variety('meowstic-male', {
      species_name: 'meowstic',
      abilities: [{ name: 'prankster', is_hidden: true }]
    });
    const female = variety('meowstic-female', {
      species_name: 'meowstic',
      abilities: [{ name: 'competitive', is_hidden: true }]
    });

    expect(collapseIndistinctVarieties([male, female])).toHaveLength(2);
  });

  it('keeps varieties whose typing differs', () => {
    const wash = variety('rotom-wash', {
      species_name: 'rotom',
      types: [{ type: { name: 'electric' } }, { type: { name: 'water' } }]
    });
    const fan = variety('rotom-fan', {
      species_name: 'rotom',
      types: [{ type: { name: 'electric' } }, { type: { name: 'flying' } }]
    });

    expect(collapseIndistinctVarieties([wash, fan])).toHaveLength(2);
  });

  it('never collapses across species', () => {
    const a = variety('one', { species_name: 'one' });
    const b = variety('two', { species_name: 'two' });

    expect(collapseIndistinctVarieties([a, b])).toHaveLength(2);
  });

  it('preserves input order and tolerates an empty list', () => {
    const kept = collapseIndistinctVarieties([
      variety('first', { species_name: 'first' }),
      variety('second', { species_name: 'second' })
    ]);

    expect(kept.map((entry) => entry.pokemon.name)).toEqual(['first', 'second']);
    expect(collapseIndistinctVarieties([])).toEqual([]);
  });
});

describe('groupByTypeName', () => {
  it('regroups flattened Pokemon under their typing', () => {
    const grouped = groupByTypeName(flattenToPokemon([
      { name: 'water/flying', pokemon: [scanEntry('pelipper'), scanEntry('gyarados')] },
      { name: 'water', pokemon: [scanEntry('vaporeon')] }
    ]));

    expect(grouped.get('water/flying')?.map((p) => p.name)).toEqual(['pelipper', 'gyarados']);
    expect(grouped.get('water')?.map((p) => p.name)).toEqual(['vaporeon']);
  });

  it('returns an empty map for no Pokemon', () => {
    expect(groupByTypeName([]).size).toBe(0);
  });
});

describe('withAbility', () => {
  const base = toPokemonEntry(scanEntry('pelipper', {
    selected_ability_name: 'keen-eye',
    ability_profiles: {
      'keen-eye': {
        weaknesses: ['electric', 'rock'],
        resistances: ['fighting'],
        immunities: [],
        coverages: ['fire'],
        damage_from_score: 20,
        damage_to_score: 20
      },
      'storm-drain': {
        weaknesses: ['electric'],
        resistances: ['fighting', 'water'],
        immunities: ['water'],
        coverages: ['fire'],
        damage_from_score: 17,
        damage_to_score: 20
      }
    }
  }), 'water/flying')!;

  it('re-derives the defensive profile for the chosen ability', () => {
    const withStormDrain = withAbility(base, 'storm-drain');

    expect(withStormDrain.abilityName).toBe('storm-drain');
    expect(withStormDrain.immunities).toEqual(['water']);
    expect(withStormDrain.weaknesses).toEqual(['electric']);
    expect(withStormDrain.normalizedDamageFromScore)
      .toBeLessThan(base.normalizedDamageFromScore);
  });

  it('leaves the entry untouched for the current or an unknown ability', () => {
    expect(withAbility(base, 'keen-eye')).toBe(base);
    expect(withAbility(base, 'not-an-ability')).toBe(base);
    expect(withAbility(base, undefined)).toBe(base);
    expect(withAbility(base, '')).toBe(base);
  });

  it('does not mutate the original entry', () => {
    withAbility(base, 'storm-drain');
    expect(base.abilityName).toBe('keen-eye');
    expect(base.immunities).toEqual([]);
  });
});

describe('getPokemonAbilityProfile', () => {
  const createDamageRelations = (id: string) => ({
    double_damage_from: [{ name: `${id}-from` }],
    half_damage_from: [],
    no_damage_from: [],
    double_damage_to: [{ name: `${id}-to` }],
    half_damage_to: [],
    no_damage_to: []
  });

  const baseTypeData = {
    pokemon: [{
      pokemon: { name: 'charizard' },
      selected_ability_name: 'levitate',
      ability_profiles: {
        blaze: {
          damage_relations: createDamageRelations('blaze-profile'),
          weaknesses: ['water', 'rock', 'ground'],
          quadruple_weaknesses: [],
          resistances: ['fire', 'grass', 'bug'],
          ineffectives: ['water', 'fire', 'rock'],
          coverages: ['grass', 'bug', 'ice'],
          damage_from_score: 19.5,
          damage_to_score: 20
        }
      }
    }]
  };

  it('returns an explicit ability profile when requested', () => {
    const pokemon = baseTypeData.pokemon[0];
    const profile = getPokemonAbilityProfile(pokemon, 'blaze');

    expect(profile).toBe(pokemon.ability_profiles.blaze);
    expect(profile?.weaknesses).toEqual(['water', 'rock', 'ground']);
  });

  it('falls back to effective profile data when no ability profile is available', () => {
    const pokemon = {
      pokemon: { name: 'flareon' },
      selected_ability_name: 'flash-fire',
      effective_damage_relations: createDamageRelations('effective-profile'),
      effective_weaknesses: ['water'],
      effective_quadruple_weaknesses: [],
      effective_resistances: ['fire', 'grass', 'ground'],
      effective_immunities: ['ground'],
      effective_ineffectives: ['rock'],
      effective_coverages: ['grass'],
      effective_damage_from_score: 11,
      effective_damage_to_score: 22
    };

    expect(getPokemonAbilityProfile(pokemon)).toEqual({
      damage_relations: createDamageRelations('effective-profile'),
      weaknesses: ['water'],
      quadruple_weaknesses: [],
      resistances: ['fire', 'grass', 'ground'],
      // Immunities are the strict 0x subset of resistances, carried separately
      // so doubles synergy can tell "takes no damage" from "takes half".
      immunities: ['ground'],
      ineffectives: ['rock'],
      coverages: ['grass'],
      damage_from_score: 11,
      damage_to_score: 22
    });
  });
});
