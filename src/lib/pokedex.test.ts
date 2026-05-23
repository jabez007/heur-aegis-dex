import { beforeEach, describe, it, expect, vi } from 'vitest';
import { __resetPokedexResourceCaches, generateTeams, getBaseTypes, getDualTypes, getResistantTypes } from './pokedex';

const mockState = vi.hoisted(() => ({
  duplicateCharmanderAcrossTypes: false,
  expandFireRoster: false,
  failPokemon4Once: false,
  detailDelayMs: 0,
  requestCounts: new Map<string, number>(),
  activeDetailRequests: 0,
  maxActiveDetailRequests: 0
}));

const trackRequest = async <T>(url: string, factory: () => T | Promise<T>) => {
  mockState.requestCounts.set(url, (mockState.requestCounts.get(url) || 0) + 1);

  const isDetailRequest = url.startsWith('/api/v2/pokemon/') || url.startsWith('/api/v2/pokemon-species/');
  if (!isDetailRequest) {
    return await factory();
  }

  mockState.activeDetailRequests += 1;
  mockState.maxActiveDetailRequests = Math.max(mockState.maxActiveDetailRequests, mockState.activeDetailRequests);

  try {
    if (mockState.detailDelayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, mockState.detailDelayMs));
    }
    return await factory();
  } finally {
    mockState.activeDetailRequests -= 1;
  }
};

// Mock the pokedex-promise-v2 module to avoid hitting the actual PokeAPI
vi.mock('pokedex-promise-v2', () => {
  class MockPokedex {
    async getResource(url: string) {
      return trackRequest(url, async () => {
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
          const extraPokemon = mockState.expandFireRoster
            ? Array.from({ length: 18 }, (_, index) => {
                const id = 100 + index;
                return { pokemon: { name: `firemon-${id}`, url: `https://pokeapi.co/api/v2/pokemon/${id}/` } };
              })
            : [];
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
            { pokemon: { name: 'charmander', url: 'https://pokeapi.co/api/v2/pokemon/4/' } },
            ...extraPokemon
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
            { pokemon: { name: 'squirtle', url: 'https://pokeapi.co/api/v2/pokemon/7/' } },
            ...(mockState.duplicateCharmanderAcrossTypes
              ? [{ pokemon: { name: 'charmander', url: 'https://pokeapi.co/api/v2/pokemon/4/' } }]
              : [])
          ]
          };
        }
        if (url.startsWith('/api/v2/pokemon/4/')) {
          if (mockState.failPokemon4Once) {
            mockState.failPokemon4Once = false;
            throw new Error('temporary pokemon fetch failure');
          }
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
          abilities: [{ ability: { name: 'blaze' }, is_hidden: false }, { ability: { name: 'levitate' }, is_hidden: true }],
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
          abilities: [{ ability: { name: 'torrent' }, is_hidden: false }],
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

        const pokemonMatch = url.match(/^\/api\/v2\/pokemon\/(\d+)\/$/);
        if (pokemonMatch) {
          const id = Number(pokemonMatch[1]);
          return {
            types: [{ type: { name: 'fire' } }],
            sprites: { front_default: `firemon-${id}.png` },
            stats: [
              { base_stat: 80, stat: { name: 'hp' } },
              { base_stat: 85, stat: { name: 'attack' } },
              { base_stat: 75, stat: { name: 'defense' } },
              { base_stat: 95, stat: { name: 'special-attack' } },
              { base_stat: 80, stat: { name: 'special-defense' } },
              { base_stat: 70, stat: { name: 'speed' } }
            ],
            abilities: [{ ability: { name: 'blaze' }, is_hidden: false }],
            species: { url: `https://pokeapi.co/api/v2/pokemon-species/${id}/` }
          };
        }

        const speciesMatch = url.match(/^\/api\/v2\/pokemon-species\/(\d+)\/$/);
        if (speciesMatch) {
          return {
            is_legendary: false,
            is_mythical: false,
            egg_groups: [{ name: 'monster' }],
            pokedex_numbers: [{ pokedex: { name: 'national' } }]
          };
        }

        return {};
      });
    }
  }
  return { default: MockPokedex };
});

beforeEach(() => {
  __resetPokedexResourceCaches();
  mockState.duplicateCharmanderAcrossTypes = false;
  mockState.expandFireRoster = false;
  mockState.failPokemon4Once = false;
  mockState.detailDelayMs = 0;
  mockState.requestCounts.clear();
  mockState.activeDetailRequests = 0;
  mockState.maxActiveDetailRequests = 0;
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

  it('getResistantTypes should apply ability immunities by default', async () => {
    const resistant = await getResistantTypes({
      baseScore: 18,
      typeFilters: { maxDamageFromScore: false, allowQuadrupleDamage: true, limitQuadrupleDamage: false },
      pokemonFilters: { inPokedex: 'national', allowMegas: false, includeAbilityImmunities: true },
      statsFilters: { minimumStatsTotal: 100, minimumAttacks: 10, minimumDefenses: 10 }
    });

    const fireType = resistant.find(t => t.name === 'fire');
    expect(fireType).toBeDefined();
    expect(fireType!.pokemon[0].selected_ability_name).toBe('levitate');
    expect(fireType!.pokemon[0].ability_profiles!.blaze.weaknesses).toContain('ground');
    expect(fireType!.pokemon[0].ability_profiles!.levitate.weaknesses).toEqual(['water', 'rock']);
    expect(fireType!.pokemon[0].effective_weaknesses).toEqual(['water', 'rock']);
    expect(fireType!.pokemon[0].effective_resistances).toContain('ground');
    expect(fireType!.damage_from_score).toBe(17.5);
  });

  it('getResistantTypes should allow disabling ability immunities', async () => {
    const resistant = await getResistantTypes({
      baseScore: 18,
      typeFilters: { maxDamageFromScore: false, allowQuadrupleDamage: true, limitQuadrupleDamage: false },
      pokemonFilters: { inPokedex: 'national', allowMegas: false, includeAbilityImmunities: false },
      statsFilters: { minimumStatsTotal: 100, minimumAttacks: 10, minimumDefenses: 10 }
    });

    const fireType = resistant.find(t => t.name === 'fire');
    expect(fireType).toBeDefined();
    expect(fireType!.pokemon[0].selected_ability_name).toBe('blaze');
    expect(fireType!.pokemon[0].effective_weaknesses).toContain('ground');
    expect(fireType!.pokemon[0].effective_resistances).not.toContain('ground');
    expect(fireType!.damage_from_score).toBe(19.5);
  });

  it('getResistantTypes should dedupe repeated pokemon and species detail fetches', async () => {
    mockState.duplicateCharmanderAcrossTypes = true;

    await getResistantTypes({
      baseScore: 18,
      typeFilters: { maxDamageFromScore: false, allowQuadrupleDamage: true, limitQuadrupleDamage: false },
      pokemonFilters: { inPokedex: 'national', allowMegas: false, includeAbilityImmunities: true },
      statsFilters: { minimumStatsTotal: 100, minimumAttacks: 10, minimumDefenses: 10 }
    });

    expect(mockState.requestCounts.get('/api/v2/pokemon/4/')).toBe(1);
    expect(mockState.requestCounts.get('/api/v2/pokemon-species/4/')).toBe(1);
  });

  it('getResistantTypes should cap concurrent detail fetches', async () => {
    mockState.expandFireRoster = true;
    mockState.detailDelayMs = 5;

    await getResistantTypes({
      baseScore: 18,
      typeFilters: { maxDamageFromScore: false, allowQuadrupleDamage: true, limitQuadrupleDamage: false },
      pokemonFilters: { inPokedex: 'national', allowMegas: false, includeAbilityImmunities: true },
      statsFilters: { minimumStatsTotal: 100, minimumAttacks: 10, minimumDefenses: 10 }
    });

    expect(mockState.maxActiveDetailRequests).toBeLessThanOrEqual(12);
  });

  it('getResistantTypes should evict failed detail fetches from cache so retries can succeed', async () => {
    mockState.failPokemon4Once = true;

    await expect(getResistantTypes({
      baseScore: 18,
      typeFilters: { maxDamageFromScore: false, allowQuadrupleDamage: true, limitQuadrupleDamage: false },
      pokemonFilters: { inPokedex: 'national', allowMegas: false, includeAbilityImmunities: true },
      statsFilters: { minimumStatsTotal: 100, minimumAttacks: 10, minimumDefenses: 10 }
    })).rejects.toThrow('temporary pokemon fetch failure');

    const resistant = await getResistantTypes({
      baseScore: 18,
      typeFilters: { maxDamageFromScore: false, allowQuadrupleDamage: true, limitQuadrupleDamage: false },
      pokemonFilters: { inPokedex: 'national', allowMegas: false, includeAbilityImmunities: true },
      statsFilters: { minimumStatsTotal: 100, minimumAttacks: 10, minimumDefenses: 10 }
    });

    expect(resistant.find((type) => type.name === 'fire')?.pokemon[0].pokemon.name).toBe('charmander');
    expect(mockState.requestCounts.get('/api/v2/pokemon/4/')).toBe(2);
  });

  it('generateTeams should respect a selected pokemon ability profile', () => {
    const abilityTypes = [{
      name: 'fire',
      damage_from_score: 19.5,
      damage_to_score: 20,
      weaknesses: ['water', 'rock', 'ground'],
      resistances: ['fire', 'grass', 'bug'],
      coverages: ['grass', 'bug', 'ice'],
      ineffectives: ['water', 'fire', 'rock'],
      pokemon: [{
        pokemon: { name: 'charizard' },
        sprite: 'charizard.png',
        stats: { hp: 78, attack: 84, defense: 78, 'special-attack': 109, 'special-defense': 85, speed: 100 },
        selected_ability_name: 'levitate',
        ability_profiles: {
          blaze: { weaknesses: ['water', 'rock', 'ground'], quadruple_weaknesses: [], resistances: ['fire', 'grass', 'bug'], ineffectives: ['water', 'fire', 'rock'], coverages: ['grass', 'bug', 'ice'], damage_from_score: 19.5, damage_to_score: 20 },
          levitate: { weaknesses: ['water', 'rock'], quadruple_weaknesses: [], resistances: ['fire', 'grass', 'bug', 'ground'], ineffectives: ['water', 'fire', 'rock'], coverages: ['grass', 'bug', 'ice'], damage_from_score: 17.5, damage_to_score: 20 }
        },
        effective_weaknesses: ['water', 'rock'],
        effective_quadruple_weaknesses: [],
        effective_resistances: ['fire', 'grass', 'bug', 'ground'],
        effective_ineffectives: ['water', 'fire', 'rock'],
        effective_coverages: ['grass', 'bug', 'ice'],
        effective_damage_from_score: 17.5,
        effective_damage_to_score: 20
      }]
    }];

    const teams = generateTeams({
      allowedTypes: abilityTypes as any,
      teamSize: 1
    });

    expect(teams[0].pokemon[0].selected_ability_name).toBe('levitate');
    expect(teams[0].pokemon[0].effective_weaknesses).toEqual(['water', 'rock']);
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
    expect(sharedQuadTeam!.sharedQuadrupleWeaknesses).toEqual(['fire']);
    expect(safeTeam).toBeDefined();
    expect(safeTeam!.sharedQuadrupleWeaknesses).toEqual([]);
    expect(sharedQuadTeam!.score).toBeLessThan(safeTeam!.score);
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

  it('should allow candidates when one side has no weaknesses to cover', () => {
    const teams = generateTeams({
      allowedTypes: [
        {
          name: 'steel',
          damage_from_score: 15,
          damage_to_score: 16,
          weaknesses: [],
          resistances: ['grass', 'electric'],
          coverages: ['rock'],
          ineffectives: [],
          pokemon: [{
            pokemon: { name: 'steelix' },
            sprite: 'steelix.png',
            stats: { hp: 75, attack: 85, defense: 200, 'special-attack': 55, 'special-defense': 65, speed: 30 }
          }]
        },
        {
          name: 'water',
          damage_from_score: 17,
          damage_to_score: 19,
          weaknesses: ['electric'],
          resistances: ['fire'],
          coverages: ['electric'],
          ineffectives: [],
          pokemon: [{
            pokemon: { name: 'blastoise' },
            sprite: 'blastoise.png',
            stats: { hp: 79, attack: 83, defense: 100, 'special-attack': 85, 'special-defense': 105, speed: 78 }
          }]
        }
      ] as any,
      teamSize: 2,
      teamComposition: { allowSharedTypes: true, allowSharedWeaknesses: true, coverWeaknesses: true }
    });

    expect(teams.some((team) => team.types.includes('steel') && team.types.includes('water'))).toBe(true);
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
    expect(charizard!.sprite).toBe('charizard.png');
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
