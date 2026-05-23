import { beforeEach, describe, expect, it } from 'vitest';
import { useTeamBuilder } from './useTeamBuilder';

describe('useTeamBuilder', () => {
  const { addToParty, clearParty, currentParty, teamWeaknessSummary } = useTeamBuilder();

  beforeEach(() => {
    clearParty();
  });

  it('uses the currently selected ability profile when adding a pokemon to the party', () => {
    const typeData = {
      name: 'fire',
      weaknesses: ['water', 'rock', 'ground'],
      resistances: ['fire', 'grass', 'bug'],
      coverages: ['grass', 'bug', 'ice'],
      pokemon: [{
        pokemon: { name: 'charizard' },
        types: [{ type: { name: 'fire' } }],
        sprite: 'charizard.png',
        stats: { hp: 78, attack: 84, defense: 78, 'special-attack': 109, 'special-defense': 85, speed: 100 },
        selected_ability_name: 'levitate',
        ability_profiles: {
          blaze: {
            weaknesses: ['water', 'rock', 'ground'],
            resistances: ['fire', 'grass', 'bug'],
            coverages: ['grass', 'bug', 'ice']
          },
          levitate: {
            weaknesses: ['water', 'rock'],
            resistances: ['fire', 'grass', 'bug', 'ground'],
            coverages: ['grass', 'bug', 'ice']
          }
        },
        effective_weaknesses: ['water', 'rock'],
        effective_resistances: ['fire', 'grass', 'bug', 'ground'],
        effective_coverages: ['grass', 'bug', 'ice']
      }],
      selectedPokemon: {
        pokemon: { name: 'charizard' },
        types: [{ type: { name: 'fire' } }],
        sprite: 'charizard.png',
        stats: { hp: 78, attack: 84, defense: 78, 'special-attack': 109, 'special-defense': 85, speed: 100 },
        selected_ability_name: 'blaze',
        ability_profiles: {
          blaze: {
            weaknesses: ['water', 'rock', 'ground'],
            resistances: ['fire', 'grass', 'bug'],
            coverages: ['grass', 'bug', 'ice']
          },
          levitate: {
            weaknesses: ['water', 'rock'],
            resistances: ['fire', 'grass', 'bug', 'ground'],
            coverages: ['grass', 'bug', 'ice']
          }
        },
        effective_weaknesses: ['water', 'rock', 'ground'],
        effective_resistances: ['fire', 'grass', 'bug'],
        effective_coverages: ['grass', 'bug', 'ice']
      }
    };

    addToParty(typeData, 0, 'blaze');

    expect(currentParty.value).toHaveLength(1);
    expect(currentParty.value[0].abilityName).toBe('blaze');
    expect(currentParty.value[0].weaknesses).toEqual(['water', 'rock', 'ground']);
    expect(currentParty.value[0].resistances).toEqual(['fire', 'grass', 'bug']);
    expect(teamWeaknessSummary.value).toEqual({ water: 1, rock: 1, ground: 1 });
  });
});
