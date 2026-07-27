import { beforeEach, describe, expect, it } from 'vitest';
import { useTeamBuilder } from './useTeamBuilder';

const abilityProfiles = {
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
};

const stats = { hp: 78, attack: 84, defense: 78, 'special-attack': 109, 'special-defense': 85, speed: 100 };

/** Builds a type card whose single Pokemon carries both ability profiles. */
const typeCard = (typeName: string, pokemonName: string) => {
  const pokemon = {
    pokemon: { name: pokemonName },
    types: [{ type: { name: typeName } }],
    sprite: `${pokemonName}.png`,
    stats,
    selected_ability_name: 'levitate',
    ability_profiles: abilityProfiles,
    effective_weaknesses: ['water', 'rock'],
    effective_resistances: ['fire', 'grass', 'bug', 'ground'],
    effective_coverages: ['grass', 'bug', 'ice']
  };

  return {
    name: typeName,
    weaknesses: ['water', 'rock', 'ground'],
    resistances: ['fire', 'grass', 'bug'],
    coverages: ['grass', 'bug', 'ice'],
    ineffectives: ['water', 'fire', 'rock'],
    selected_pokemon_index: 0,
    selected_ability_name: 'levitate',
    pokemon: [pokemon],
    selectedPokemon: { ...pokemon, selected_ability_name: 'blaze' }
  };
};

describe('useTeamBuilder', () => {
  const builder = useTeamBuilder();
  const { addToParty, clearParty, roster, setFormat, teamWeaknessSummary } = builder;

  beforeEach(() => {
    clearParty();
    setFormat('doubles');
  });

  it('uses the currently selected ability profile when adding a pokemon', () => {
    addToParty(typeCard('fire', 'charizard') as never, 0, 'blaze');

    expect(roster.value).toHaveLength(1);
    expect(roster.value[0].abilityName).toBe('blaze');
    expect(roster.value[0].weaknesses).toEqual(['water', 'rock', 'ground']);
    expect(roster.value[0].resistances).toEqual(['fire', 'grass', 'bug']);
  });

  it('reports no battle analysis until a full bring is selected', () => {
    // Doubles brings four. One registered Pokemon cannot field a team, so there
    // is nothing to analyse yet.
    addToParty(typeCard('fire', 'charizard') as never, 0, 'blaze');

    expect(builder.bringIndices.value).toEqual([]);
    expect(teamWeaknessSummary.value).toEqual({});
  });

  it('analyses the brought team once the roster can field one', () => {
    ['fire', 'water', 'grass', 'electric'].forEach((type, index) => {
      addToParty(typeCard(type, `mon-${index}`) as never, 0, 'blaze');
    });

    expect(builder.bringIndices.value).toHaveLength(4);
    // Every member shares the blaze profile, so nothing resists their weaknesses.
    expect(teamWeaknessSummary.value).toEqual({ water: 4, rock: 4, ground: 4 });
  });

  it('registers up to six and brings only four in doubles', () => {
    ['fire', 'water', 'grass', 'electric', 'ice', 'rock'].forEach((type, index) => {
      addToParty(typeCard(type, `mon-${index}`) as never, 0, 'blaze');
    });

    expect(roster.value).toHaveLength(6);
    expect(builder.bringIndices.value).toHaveLength(4);
    expect(builder.rosterEvaluation.value.optionCount).toBe(15);
  });

  it('refuses a seventh roster entry', () => {
    ['fire', 'water', 'grass', 'electric', 'ice', 'rock', 'dark'].forEach((type, index) => {
      addToParty(typeCard(type, `mon-${index}`) as never, 0, 'blaze');
    });

    expect(roster.value).toHaveLength(6);
  });

  it('brings three in singles from the same roster', () => {
    ['fire', 'water', 'grass', 'electric', 'ice', 'rock'].forEach((type, index) => {
      addToParty(typeCard(type, `mon-${index}`) as never, 0, 'blaze');
    });
    setFormat('singles');

    expect(roster.value).toHaveLength(6);
    expect(builder.bringIndices.value).toHaveLength(3);
    expect(builder.rosterEvaluation.value.optionCount).toBe(20);
  });

  it('lets the user override the suggested bring', () => {
    ['fire', 'water', 'grass', 'electric', 'ice'].forEach((type, index) => {
      addToParty(typeCard(type, `mon-${index}`) as never, 0, 'blaze');
    });

    expect(builder.isSuggestedBring.value).toBe(true);
    builder.toggleBring(0);
    builder.toggleBring(1);

    expect(builder.isSuggestedBring.value).toBe(false);
    builder.useSuggestedBring();
    expect(builder.isSuggestedBring.value).toBe(true);
  });

  it('refuses to bring more than the format allows', () => {
    ['fire', 'water', 'grass', 'electric', 'ice'].forEach((type, index) => {
      addToParty(typeCard(type, `mon-${index}`) as never, 0, 'blaze');
    });

    // Start from an explicit selection of four, then try to add a fifth.
    builder.useSuggestedBring();
    const suggested = [...builder.bringIndices.value];
    const benched = [0, 1, 2, 3, 4].find((index) => !suggested.includes(index))!;
    builder.toggleBring(benched);

    expect(builder.bringIndices.value).toHaveLength(4);
    expect(builder.bringIndices.value).not.toContain(benched);
  });

  it('drops a manual bring when the format changes', () => {
    ['fire', 'water', 'grass', 'electric', 'ice'].forEach((type, index) => {
      addToParty(typeCard(type, `mon-${index}`) as never, 0, 'blaze');
    });
    builder.toggleBring(0);
    expect(builder.isSuggestedBring.value).toBe(false);

    setFormat('singles');

    // A bring sized for doubles says nothing about which three to bring.
    expect(builder.isSuggestedBring.value).toBe(true);
    expect(builder.bringIndices.value).toHaveLength(3);
  });
});
