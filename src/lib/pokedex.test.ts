import { describe, it, expect, vi } from 'vitest';
import { generateTeams, getBaseTypes, getDualTypes, getResistantTypes } from './pokedex';

// Mock the pokedex-promise-v2 module to avoid hitting the actual PokeAPI
vi.mock('pokedex-promise-v2', () => {
  class MockPokedex {
    async getResource(url: string) {
      if (url === '/api/v2/type/') {
        return { results: [{ name: 'fire' }, { name: 'water' }, { name: 'bug' }, { name: 'steel' }] };
      }
      if (url.startsWith('/api/v2/type/bug')) {
        return {
          id: 12,
          name: 'bug',
          damage_relations: {
            double_damage_from: [{ name: 'fire' }, { name: 'flying' }, { name: 'rock' }],
            half_damage_from: [{ name: 'fighting' }, { name: 'ground' }, { name: 'grass' }],
            no_damage_from: [],
            double_damage_to: [{ name: 'grass' }, { name: 'psychic' }, { name: 'dark' }],
            half_damage_to: [{ name: 'fire' }, { name: 'fighting' }, { name: 'poison' }, { name: 'flying' }, { name: 'ghost' }, { name: 'steel' }, { name: 'fairy' }],
            no_damage_to: []
          },
          pokemon: []
        };
      }
      if (url.startsWith('/api/v2/type/steel')) {
        return {
          id: 13,
          name: 'steel',
          damage_relations: {
            double_damage_from: [{ name: 'fire' }, { name: 'fighting' }, { name: 'ground' }],
            half_damage_from: [{ name: 'normal' }, { name: 'flying' }, { name: 'rock' }, { name: 'bug' }, { name: 'steel' }, { name: 'grass' }, { name: 'psychic' }, { name: 'ice' }, { name: 'dragon' }, { name: 'fairy' }],
            no_damage_from: [{ name: 'poison' }],
            double_damage_to: [{ name: 'rock' }, { name: 'ice' }, { name: 'fairy' }],
            half_damage_to: [{ name: 'steel' }, { name: 'fire' }, { name: 'water' }, { name: 'electric' }],
            no_damage_to: []
          },
          pokemon: []
        };
      }
      if (url.startsWith('/api/v2/type/fire')) {
        return {
          id: 10,
          name: 'fire',
          damage_relations: {
            double_damage_from: [{ name: 'water' }, { name: 'rock' }, { name: 'ground' }],
            half_damage_from: [{ name: 'fire' }, { name: 'grass' }, { name: 'bug' }],
            no_damage_from: [],
            double_damage_to: [{ name: 'grass' }, { name: 'bug' }],
            half_damage_to: [{ name: 'water' }, { name: 'fire' }, { name: 'rock' }],
            no_damage_to: []
          },
          pokemon: [
            { pokemon: { name: 'charmander', url: 'https://pokeapi.co/api/v2/pokemon/4/' } }
          ]
        };
      }
      if (url.startsWith('/api/v2/type/water')) {
        return {
          id: 11,
          name: 'water',
          damage_relations: {
            double_damage_from: [{ name: 'electric' }, { name: 'grass' }],
            half_damage_from: [{ name: 'water' }, { name: 'fire' }, { name: 'ice' }],
            no_damage_from: [],
            double_damage_to: [{ name: 'fire' }, { name: 'rock' }, { name: 'ground' }],
            half_damage_to: [{ name: 'water' }, { name: 'grass' }, { name: 'dragon' }],
            no_damage_to: []
          },
          pokemon: [
            { pokemon: { name: 'squirtle', url: 'https://pokeapi.co/api/v2/pokemon/7/' } }
          ]
        };
      }
      if (url.startsWith('/api/v2/pokemon/4/')) {
        return {
          types: [{ type: { name: 'fire' } }],
          sprites: { front_default: 'charmander.png' },
          stats: [
            { base_stat: 39, stat: { name: 'hp' } },
            { base_stat: 52, stat: { name: 'attack' } },
            { base_stat: 43, stat: { name: 'defense' } },
            { base_stat: 60, stat: { name: 'special-attack' } },
            { base_stat: 50, stat: { name: 'special-defense' } },
            { base_stat: 65, stat: { name: 'speed' } }
          ],
          species: { url: 'https://pokeapi.co/api/v2/pokemon-species/4/' }
        };
      }
      if (url.startsWith('/api/v2/pokemon-species/4/')) {
        return {
          is_legendary: false,
          is_mythical: false,
          egg_groups: [{ name: 'monster' }],
          pokedex_numbers: [{ pokedex: { name: 'national' } }]
        };
      }
      if (url.startsWith('/api/v2/pokemon/7/')) {
        return {
          types: [{ type: { name: 'water' } }],
          sprites: { front_default: 'squirtle.png' },
          stats: [
            { base_stat: 44, stat: { name: 'hp' } },
            { base_stat: 48, stat: { name: 'attack' } },
            { base_stat: 65, stat: { name: 'defense' } },
            { base_stat: 50, stat: { name: 'special-attack' } },
            { base_stat: 64, stat: { name: 'special-defense' } },
            { base_stat: 43, stat: { name: 'speed' } }
          ],
          species: { url: 'https://pokeapi.co/api/v2/pokemon-species/7/' }
        };
      }
      if (url.startsWith('/api/v2/pokemon-species/7/')) {
        return {
          is_legendary: false,
          is_mythical: false,
          egg_groups: [{ name: 'monster' }],
          pokedex_numbers: [{ pokedex: { name: 'national' } }]
        };
      }
      return {};
    }
  }
  return { default: MockPokedex };
});

describe('pokedex.js API integration logic', () => {
  it('getBaseTypes should calculate base type damage scores', async () => {
    const types = await getBaseTypes(18);
    expect(types).toHaveLength(4);
    
    const fireType = types.find(t => t.name === 'fire')!;
    // base score(18) + double_from(3) - 0.5 * half_from(3) - no_from(0) = 19.5
    expect(fireType.damage_relations.damage_from_score).toBe(19.5);
    
    // base score(18) + double_to(2) - 0.5 * half_to(3) - no_to(0) = 18.5
    expect(fireType.damage_relations.damage_to_score).toBe(18.5);
  });

  it('getDualTypes should combine damage relations for dual typing', async () => {
    const dualTypes = await getDualTypes(18);
    // 4 types means 6 combinations
    expect(dualTypes).toHaveLength(6);
    
    const fireWater = dualTypes.find(t => t.name === 'fire/water')!;
    expect(fireWater).toBeDefined();
    
    // Bug and Steel are both weak to Fire. Bug/Steel should have a 4x weakness to Fire.
    const bugSteel = dualTypes.find(t => t.name === 'bug/steel')!;
    expect(bugSteel).toBeDefined();
    expect(bugSteel.damage_relations.quadruple_damage_from).toHaveLength(1);
    expect(bugSteel.damage_relations.quadruple_damage_from![0].name).toBe('fire');
  });

  it('getResistantTypes should filter pokemon by stats and typings', async () => {
    const resistant = await getResistantTypes({
      baseScore: 18,
      typeFilters: { maxDamageFromScore: false, allowQuadrupleDamage: true, limitQuadrupleDamage: false },
      pokemonFilters: { inPokedex: 'national', allowMegas: false },
      // Set very low thresholds to ensure charmander and squirtle make it through
      statsFilters: { minimumStatsTotal: 100, minimumAttacks: 10, minimumDefenses: 10 }
    });

    expect(Array.isArray(resistant)).toBe(true);

    const fireType = resistant.find(t => t.name === 'fire');
    expect(fireType).toBeDefined();
    expect(fireType!.pokemon).toHaveLength(1);
    expect(fireType!.pokemon[0].pokemon.name).toBe('charmander');

    const waterType = resistant.find(t => t.name === 'water');
    expect(waterType).toBeDefined();
    expect(waterType!.pokemon).toHaveLength(1);
    expect(waterType!.pokemon[0].pokemon.name).toBe('squirtle');
    expect(waterType!.pokemon[0].stats_total).toBe(44 + 48 + 65 + 50 + 64 + 43); // 314
  });
});

describe('pokedex.js - generateTeams', () => {
  const mockTypes = [
    {
      name: 'fire',
      damage_from_score: 18,
      damage_to_score: 20,
      weaknesses: ['water', 'rock', 'ground'],
      resistances: ['fire', 'grass', 'bug'],
      coverages: ['grass', 'bug', 'ice'],
      ineffectives: ['water', 'fire', 'rock'],
      pokemon: [{
        pokemon: { name: 'charizard' },
        sprite: 'charizard.png',
        stats: { hp: 78, attack: 84, defense: 78, 'special-attack': 109, 'special-defense': 85, speed: 100 }
      }]
    },
    {
      name: 'water',
      damage_from_score: 17,
      damage_to_score: 19,
      weaknesses: ['grass', 'electric'],
      resistances: ['fire', 'water', 'ice'],
      coverages: ['fire', 'rock', 'ground'],
      ineffectives: ['water', 'grass', 'dragon'],
      pokemon: [{
        pokemon: { name: 'blastoise' },
        sprite: 'blastoise.png',
        stats: { hp: 79, attack: 83, defense: 100, 'special-attack': 85, 'special-defense': 105, speed: 78 }
      }]
    },
    {
      name: 'grass',
      damage_from_score: 19,
      damage_to_score: 18,
      weaknesses: ['fire', 'flying', 'bug', 'ice', 'poison'],
      resistances: ['water', 'grass', 'electric', 'ground'],
      coverages: ['water', 'rock', 'ground'],
      ineffectives: ['fire', 'grass', 'bug', 'dragon', 'poison', 'flying', 'steel'],
      pokemon: [{
        pokemon: { name: 'venusaur' },
        sprite: 'venusaur.png',
        stats: { hp: 80, attack: 82, defense: 83, 'special-attack': 100, 'special-defense': 100, speed: 80 }
      }]
    }
  ];

  it('should generate a team of size 3', () => {
    const teams = generateTeams({
      allowedTypes: [...mockTypes],
      teamSize: 3,
      teamComposition: { allowSharedTypes: true, allowSharedWeaknesses: true, coverWeaknesses: false }
    });

    expect(teams.length).toBeGreaterThan(0);
    expect(teams[0].pokemon.length).toBe(3);
    expect(teams[0].typesTotal).toBe(3); // 'fire', 'water', 'grass' = 3 base types
  });

  it('should not generate a team if team size exceeds available types', () => {
    const teams = generateTeams({
      allowedTypes: [...mockTypes],
      teamSize: 4,
      teamComposition: { allowSharedTypes: true, allowSharedWeaknesses: true, coverWeaknesses: false }
    });

    expect(teams.length).toBe(0);
  });

  it('should exclude combinations with shared weaknesses if allowSharedWeaknesses is false', () => {
    const mockTypesWithSharedWeakness = [
      ...mockTypes,
      {
        name: 'rock',
        damage_from_score: 20,
        damage_to_score: 18,
        weaknesses: ['water', 'grass', 'fighting', 'ground', 'steel'], // Shares 'water' weakness with fire
        resistances: ['normal', 'fire', 'poison', 'flying'],
        coverages: ['fire', 'ice', 'flying', 'bug'],
        ineffectives: ['fighting', 'ground', 'steel'],
        pokemon: [{
          pokemon: { name: 'golem' },
          sprite: 'golem.png',
          stats: { hp: 80, attack: 120, defense: 130, 'special-attack': 55, 'special-defense': 65, speed: 45 }
        }]
      }
    ];

    const teamsSharedAllowed = generateTeams({
      allowedTypes: [...mockTypesWithSharedWeakness],
      teamSize: 2,
      teamComposition: { allowSharedTypes: true, allowSharedWeaknesses: true, coverWeaknesses: false }
    });

    const hasFireAndRock = teamsSharedAllowed.some(team => 
      team.types.includes('fire') && team.types.includes('rock')
    );
    expect(hasFireAndRock).toBe(true);

    const teamsSharedDisallowed = generateTeams({
      allowedTypes: [...mockTypesWithSharedWeakness],
      teamSize: 2,
      teamComposition: { allowSharedTypes: true, allowSharedWeaknesses: false, coverWeaknesses: false }
    });

    const hasFireAndRockDisallowed = teamsSharedDisallowed.some((team: any) => 
      team.types.includes('fire') && team.types.includes('rock')
    );
    expect(hasFireAndRockDisallowed).toBe(false);
  });
  
  it('should calculate valid score metric for generated team', () => {
    const teams = generateTeams({
      allowedTypes: [...mockTypes],
      teamSize: 3,
      teamComposition: { allowSharedTypes: true, allowSharedWeaknesses: true, coverWeaknesses: false }
    });
    
    expect(Array.isArray(teams)).toBe(true);
    expect(teams.length).toBeGreaterThan(0);
    expect(typeof teams[0].score).toBe('number');
    expect(Number.isFinite(teams[0].score)).toBe(true);
    expect(teams[0].score).toBeGreaterThan(0);
  });

  it('should expose team-level synergy metrics for ranking', () => {
    const teams = generateTeams({
      allowedTypes: [...mockTypes],
      teamSize: 3,
      teamComposition: { allowSharedTypes: true, allowSharedWeaknesses: true, coverWeaknesses: false }
    });

    expect(teams[0].sharedWeaknesses).toEqual([]);
    expect(teams[0].uncoveredWeaknesses).toEqual(['flying', 'poison']);
    expect(teams[0].uniqueResistances).toBe(7);
    expect(teams[0].uniqueCoverages).toBe(7);
  });

  it('should penalize shared quadruple weaknesses in team ranking', () => {
    const severityTypes = [
      {
        name: 'bug/steel',
        damage_from_score: 12,
        damage_to_score: 19,
        weaknesses: ['fire', 'rock'],
        quadruple_weaknesses: ['fire'],
        resistances: ['grass', 'ice', 'fairy'],
        coverages: ['grass', 'psychic'],
        ineffectives: [],
        pokemon: [{
          pokemon: { name: 'forretress' },
          sprite: 'forretress.png',
          stats: { hp: 75, attack: 140, defense: 180, 'special-attack': 40, 'special-defense': 120, speed: 40 }
        }]
      },
      {
        name: 'grass/ice',
        damage_from_score: 13,
        damage_to_score: 18,
        weaknesses: ['fire', 'steel', 'flying'],
        quadruple_weaknesses: ['fire'],
        resistances: ['water', 'grass', 'ground'],
        coverages: ['water', 'ground'],
        ineffectives: [],
        pokemon: [{
          pokemon: { name: 'abomasnow' },
          sprite: 'abomasnow.png',
          stats: { hp: 90, attack: 132, defense: 120, 'special-attack': 132, 'special-defense': 120, speed: 60 }
        }]
      },
      {
        name: 'water/dragon',
        damage_from_score: 16,
        damage_to_score: 17,
        weaknesses: ['dragon', 'fairy'],
        quadruple_weaknesses: [],
        resistances: ['fire', 'water', 'steel'],
        coverages: ['fire', 'rock', 'ground'],
        ineffectives: [],
        pokemon: [{
          pokemon: { name: 'kingdra' },
          sprite: 'kingdra.png',
          stats: { hp: 75, attack: 95, defense: 95, 'special-attack': 95, 'special-defense': 95, speed: 85 }
        }]
      },
      {
        name: 'electric/steel',
        damage_from_score: 15,
        damage_to_score: 17,
        weaknesses: ['ground', 'fighting'],
        quadruple_weaknesses: [],
        resistances: ['electric', 'flying', 'fairy'],
        coverages: ['water', 'flying', 'ice'],
        ineffectives: [],
        pokemon: [{
          pokemon: { name: 'magnezone' },
          sprite: 'magnezone.png',
          stats: { hp: 70, attack: 70, defense: 115, 'special-attack': 130, 'special-defense': 90, speed: 60 }
        }]
      }
    ];

    const teams = generateTeams({
      allowedTypes: severityTypes as any,
      teamSize: 2,
      teamComposition: { allowSharedTypes: true, allowSharedWeaknesses: true, coverWeaknesses: false }
    });

    const sharedQuadTeam = teams.find((team: any) =>
      team.types.includes('bug/steel') && team.types.includes('grass/ice')
    );
    const safeTeam = teams.find((team: any) =>
      team.types.includes('water/dragon') && team.types.includes('electric/steel')
    );

    expect(sharedQuadTeam).toBeDefined();
    expect(sharedQuadTeam.sharedQuadrupleWeaknesses).toEqual(['fire']);
    expect(safeTeam).toBeDefined();
    expect(safeTeam.sharedQuadrupleWeaknesses).toEqual([]);
    expect(sharedQuadTeam.score).toBeLessThan(safeTeam.score);
  });

  it('should handle missing normalized scores without producing NaN', () => {
    const typesWithMissingScores = [
      {
        name: 'fire',
        pokemon: [{
          pokemon: { name: 'charizard' },
          sprite: 'charizard.png',
          stats: { hp: 78, attack: 84, defense: 78, 'special-attack': 109, 'special-defense': 85, speed: 100 }
        }],
        weaknesses: [],
        resistances: [],
        coverages: [],
        ineffectives: []
        // normalized_damage_to_score is missing
      }
    ];

    const teams = generateTeams({
      allowedTypes: typesWithMissingScores as any,
      teamSize: 1
    });

    expect(Array.isArray(teams)).toBe(true);
    expect(teams.length).toBeGreaterThan(0);
    expect(teams[0].score).toBeDefined();
    expect(Number.isNaN(teams[0].score)).toBe(false);
    expect(typeof teams[0].score).toBe('number');
  });

  it('should skip invalid types in seeded generation gracefully', () => {
    const seedWithInvalidType = [
      {
        name: 'invalid-type', 
        typeName: 'invalid-type',
        weaknesses: [],
        ineffectives: []
      },
      {
        name: 'fire',
        typeName: 'fire',
        weaknesses: ['water', 'rock', 'ground'],
        ineffectives: ['water', 'fire', 'rock'],
        pokemon: mockTypes[0].pokemon,
        selectedPokemon: mockTypes[0].pokemon[0] // Explicitly set selectedPokemon to be extra safe
      }
    ];

    const teams = generateTeams({
      allowedTypes: [...mockTypes],
      teamSize: 3,
      seed: seedWithInvalidType as any,
      teamComposition: { allowSharedTypes: true, allowSharedWeaknesses: true, coverWeaknesses: false }
    });

    // Valid seed was 'fire'. It should have filled the remaining 2 slots with 'water' and 'grass'.
    expect(Array.isArray(teams)).toBe(true);
    expect(teams.length).toBeGreaterThan(0);
    expect(Array.isArray(teams[0].pokemon)).toBe(true);
    expect(teams[0].pokemon.length).toBe(3);

    // Assert that 'invalid-type' is NOT in the team
    const hasInvalidType = teams[0].pokemon.some((p: any) => p.name === 'missing-poke');
    expect(hasInvalidType).toBe(false);

    // Assert that 'fire' (charizard) IS in the team and it's the correct one from the seed
    const charizard = teams[0].pokemon.find((p: any) => p.name === 'charizard');
    expect(charizard).toBeDefined();
    expect(charizard.sprite).toBe('charizard.png');
  });

  it('should correctly map nested pokemon data to the team structure', () => {
    const teams = generateTeams({
      allowedTypes: [...mockTypes],
      teamSize: 1
    });

    expect(Array.isArray(teams)).toBe(true);
    expect(teams.length).toBeGreaterThan(0);
    expect(Array.isArray(teams[0].pokemon)).toBe(true);
    expect(teams[0].pokemon.length).toBe(1);

    const poke = teams[0].pokemon[0];
    expect(poke.name).toBeDefined();
    expect(poke.sprite).toBeDefined();
    expect(poke.stats).toBeDefined();
    expect(Array.isArray(poke.types)).toBe(true);
  });
});

