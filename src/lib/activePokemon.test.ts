import { describe, expect, it } from 'vitest';
import {
  buildActiveTypeData,
  getEffectiveTypeProfile,
  getPokemonAbilityProfile,
  resolveSelectedPokemon
} from './activePokemon';

describe('activePokemon helpers', () => {
  const baseTypeData = {
    name: 'fire',
    weaknesses: ['water', 'rock', 'ground'],
    quadruple_weaknesses: [],
    resistances: ['fire', 'grass', 'bug'],
    ineffectives: ['water', 'fire', 'rock'],
    coverages: ['grass', 'bug', 'ice'],
    damage_from_score: 19.5,
    damage_to_score: 20,
    pokemon: [{
      pokemon: { name: 'charizard' },
      types: [{ type: { name: 'fire' } }, { type: { name: 'flying' } }],
      sprite: 'charizard.png',
      stats: { hp: 78, attack: 84, defense: 78, 'special-attack': 109, 'special-defense': 85, speed: 100 },
      selected_ability_name: 'levitate',
      ability_profiles: {
        blaze: {
          damage_relations: { id: 'blaze-profile' },
          weaknesses: ['water', 'rock', 'ground'],
          quadruple_weaknesses: [],
          resistances: ['fire', 'grass', 'bug'],
          ineffectives: ['water', 'fire', 'rock'],
          coverages: ['grass', 'bug', 'ice'],
          damage_from_score: 19.5,
          damage_to_score: 20
        },
        levitate: {
          damage_relations: { id: 'levitate-profile' },
          weaknesses: ['water', 'rock'],
          quadruple_weaknesses: [],
          resistances: ['fire', 'grass', 'bug', 'ground'],
          ineffectives: ['water', 'fire', 'rock'],
          coverages: ['grass', 'bug', 'ice'],
          damage_from_score: 17.5,
          damage_to_score: 20
        }
      },
      effective_damage_relations: { id: 'levitate-profile' },
      effective_weaknesses: ['water', 'rock'],
      effective_quadruple_weaknesses: [],
      effective_resistances: ['fire', 'grass', 'bug', 'ground'],
      effective_ineffectives: ['water', 'fire', 'rock'],
      effective_coverages: ['grass', 'bug', 'ice'],
      effective_damage_from_score: 17.5,
      effective_damage_to_score: 20
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
      selected_ability_name: 'flash-fire',
      effective_damage_relations: { id: 'effective-profile' },
      effective_weaknesses: ['water'],
      effective_quadruple_weaknesses: [],
      effective_resistances: ['fire', 'grass'],
      effective_ineffectives: ['rock'],
      effective_coverages: ['grass'],
      effective_damage_from_score: 11,
      effective_damage_to_score: 22
    };

    expect(getPokemonAbilityProfile(pokemon)).toEqual({
      damage_relations: { id: 'effective-profile' },
      weaknesses: ['water'],
      quadruple_weaknesses: [],
      resistances: ['fire', 'grass'],
      ineffectives: ['rock'],
      coverages: ['grass'],
      damage_from_score: 11,
      damage_to_score: 22
    });
  });

  it('resolves the selected pokemon using the chosen ability instead of the default effective profile', () => {
    const typeData = {
      ...baseTypeData,
      selectedPokemon: {
        ...baseTypeData.pokemon[0],
        selected_ability_name: 'blaze',
        effective_damage_relations: { id: 'blaze-profile' },
        effective_weaknesses: ['water', 'rock', 'ground'],
        effective_resistances: ['fire', 'grass', 'bug'],
        effective_ineffectives: ['water', 'fire', 'rock'],
        effective_coverages: ['grass', 'bug', 'ice'],
        effective_damage_from_score: 19.5,
        effective_damage_to_score: 20
      }
    };

    const resolvedPokemon = resolveSelectedPokemon(typeData, 0, 'blaze');

    expect(resolvedPokemon?.selected_ability_name).toBe('blaze');
    expect(resolvedPokemon?.effective_damage_relations).toEqual({ id: 'blaze-profile' });
    expect(resolvedPokemon?.effective_weaknesses).toEqual(['water', 'rock', 'ground']);
    expect(resolvedPokemon?.effective_resistances).toEqual(['fire', 'grass', 'bug']);
  });

  it('builds active type data from the resolved pokemon profile', () => {
    const activeTypeData = buildActiveTypeData(baseTypeData, 0, 'levitate');

    expect(activeTypeData.selected_pokemon_index).toBe(0);
    expect(activeTypeData.selected_ability_name).toBe('levitate');
    expect(activeTypeData.weaknesses).toEqual(['water', 'rock']);
    expect(activeTypeData.resistances).toEqual(['fire', 'grass', 'bug', 'ground']);
    expect(activeTypeData.damage_from_score).toBe(17.5);
  });

  it('falls back to type-level data when no active pokemon is available', () => {
    const typeProfile = getEffectiveTypeProfile({
      name: 'ghost',
      weaknesses: ['ghost', 'dark'],
      quadruple_weaknesses: [],
      resistances: ['bug', 'poison'],
      ineffectives: ['normal'],
      coverages: ['ghost', 'psychic'],
      damage_from_score: 16,
      damage_to_score: 18
    });

    expect(typeProfile.weaknesses).toEqual(['ghost', 'dark']);
    expect(typeProfile.resistances).toEqual(['bug', 'poison']);
    expect(typeProfile.damage_from_score).toBe(16);
  });
});
