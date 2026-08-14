import { beforeEach, describe, it, expect, vi } from 'vitest';
import {
  DEFAULT_STATS_FILTERS,
  __resetPokedexResourceCaches,
  getBaseTypes,
  getDualTypes,
  getResistantTypes,
  hpAdjustedBulk
} from './pokedexLive';
import {
  catalogTypeToPokemonType,
  enrichCatalogVariety,
  getCatalogResistantTypes
} from './pokemonCatalogScan';
import { damageFromScoreBounds } from './pokedexScoring';
import { isResistantTypeResultList } from './pokedexTypes';
import { UNIFORM_TYPE_THREAT } from './typeThreat';
import type { PokemonCatalogV1 } from './pokemonCatalog';

const mockState = vi.hoisted(() => ({
  duplicateCharmanderAcrossTypes: false,
  expandFireRoster: false,
  failPokemon4Once: false,
  /** Report species names that appear on the Regulation M-B roster. */
  useRegulationLegalSpecies: false,
  regulationSpeciesName: null as string | null,
  /** Report every species as legendary, exercising the breedable-only filter. */
  treatSpeciesAsLegendary: false,
  /** Name the fire-type entry after a Pokemon present in the coverage-move table. */
  useCoverageTableName: false,
  /** Add a Gigantamax, a Mega and a permanent regional form to the fire roster. */
  includeAlternateForms: false,
  /** Add a cosmetic variety indistinguishable from the base Pokemon. */
  includeCosmeticVarieties: false,
  /** Add a variety recorded as unbreedable, on a species that breeds normally. */
  includeUnbreedableVariety: false,
  /** Present the fire-type entry as Palafin, which registers as one form and fights as another. */
  usePalafin: false,
  /** Give the registered Palafin an ability that cannot reach its battle form. */
  breakPalafinTrigger: false,
  /** Give the fire-type entry Azumarill's ability pair: Huge Power plus a defensive immunity. */
  useHugePower: false,
  /** Give the entry mutually exclusive attack and defense stat abilities. */
  useSplitStatAbilities: false,
  /** Give the fire-type entry a support ability alongside a filler and a type immunity. */
  useSupportAbility: false,
  /** Give the fire-type entry Skeledirge's pair: a filler first, a quality ability hidden. */
  useQualityAbility: false,
  detailDelayMs: 0,
  requestCounts: new Map<string, number>(),
  /** Every request in the order it was issued, for checking which phase made it. */
  requestOrder: [] as string[],
  activeDetailRequests: 0,
  maxActiveDetailRequests: 0
}));

const trackRequest = async <T>(url: string, factory: () => T | Promise<T>) => {
  mockState.requestCounts.set(url, (mockState.requestCounts.get(url) || 0) + 1);
  mockState.requestOrder.push(url);

  const isDetailRequest = url.startsWith('/api/v2/pokemon/')
    || url.startsWith('/api/v2/pokemon-species/')
    || url.startsWith('/api/v2/pokemon-form/');
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
            { pokemon: { name: mockState.useCoverageTableName ? 'garchomp' : 'charmander', url: 'https://pokeapi.co/api/v2/pokemon/4/' } },
            ...(mockState.includeAlternateForms
              ? [
                { pokemon: { name: 'charmander-gmax', url: 'https://pokeapi.co/api/v2/pokemon/10001/' } },
                { pokemon: { name: 'charmander-mega', url: 'https://pokeapi.co/api/v2/pokemon/10002/' } },
                { pokemon: { name: 'charmander-alola', url: 'https://pokeapi.co/api/v2/pokemon/10003/' } }
              ]
              : []),
            ...(mockState.includeCosmeticVarieties
              // Same species, same stats, same typing, same abilities — a cap.
              ? [{ pokemon: { name: 'charmander-world-cap', url: 'https://pokeapi.co/api/v2/pokemon/10500/' } }]
              : []),
            ...(mockState.includeUnbreedableVariety
              // Floette-Eternal's shape: a permanent, non-Mega variety whose
              // species breeds normally and whose stats are its own, so nothing
              // upstream of the variety-level check has grounds to drop it.
              ? [{ pokemon: { name: 'floette-eternal', url: 'https://pokeapi.co/api/v2/pokemon/10600/' } }]
              : []),
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
        // A cosmetic variety: identical to /pokemon/4/ in everything modelled,
        // differing only in that it is not the default.
        if (url.startsWith('/api/v2/pokemon/10500/')) {
          return {
          is_default: false,
          forms: [{ url: 'https://pokeapi.co/api/v2/pokemon-form/10500/' }],
          types: [{ type: { name: 'fire' } }],
          sprites: { front_default: 'charmander-world-cap.png' },
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
        if (url.startsWith('/api/v2/pokemon/4/')) {
          if (mockState.failPokemon4Once) {
            mockState.failPokemon4Once = false;
            throw new Error('temporary pokemon fetch failure');
          }
          return {
          is_default: true,
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
          abilities: mockState.usePalafin
            ? [{ ability: { name: mockState.breakPalafinTrigger ? 'torrent' : 'zero-to-hero' }, is_hidden: false }]
            : mockState.useQualityAbility
              // Skeledirge's real pair. Unaware sits in the hidden slot, so any
              // rule that falls back to "first ability" never reaches it.
              ? [
                { ability: { name: 'blaze' }, is_hidden: false },
                { ability: { name: 'unaware' }, is_hidden: true }
              ]
              : mockState.useSupportAbility
              // Ninetales' real trio: a filler, the weather ability it is
              // brought for, and a type immunity that wins on defence alone.
              ? [
                { ability: { name: 'white-smoke' }, is_hidden: false },
                { ability: { name: 'drought' }, is_hidden: false },
                { ability: { name: 'flash-fire' }, is_hidden: true }
              ]
              : mockState.useSplitStatAbilities
                ? [
                  { ability: { name: 'huge-power' }, is_hidden: false },
                  { ability: { name: 'fur-coat' }, is_hidden: true }
                ]
              : mockState.useHugePower
              // Azumarill's real pair: the stat ability, and a type immunity that
              // wins on defensive merit alone.
              ? [{ ability: { name: 'huge-power' }, is_hidden: false }, { ability: { name: 'sap-sipper' }, is_hidden: true }]
              : [{ ability: { name: 'blaze' }, is_hidden: false }, { ability: { name: 'levitate' }, is_hidden: true }],
          species: { url: 'https://pokeapi.co/api/v2/pokemon-species/4/' }
          };
        }
        // The battle form Palafin actually fights in. Same typing as the mocked
        // registered form, and a far larger stat line.
        if (url.startsWith('/api/v2/pokemon/9000/')) {
          return {
          is_default: false,
          types: [{ type: { name: 'fire' } }],
          sprites: { front_default: 'palafin-hero.png' },
          stats: [
            { base_stat: 100, stat: { name: 'hp' } },
            { base_stat: 160, stat: { name: 'attack' } },
            { base_stat: 97, stat: { name: 'defense' } },
            { base_stat: 106, stat: { name: 'special-attack' } },
            { base_stat: 87, stat: { name: 'special-defense' } },
            { base_stat: 100, stat: { name: 'speed' } }
          ],
          abilities: [{ ability: { name: 'zero-to-hero' }, is_hidden: false }],
          species: { url: 'https://pokeapi.co/api/v2/pokemon-species/4/' }
          };
        }
        if (url.startsWith('/api/v2/pokemon-species/4/')) {
          return {
          name: mockState.usePalafin
            ? 'palafin'
            : (mockState.regulationSpeciesName ?? (mockState.useRegulationLegalSpecies ? 'charizard' : 'charmander')),
          is_legendary: mockState.treatSpeciesAsLegendary,
          is_mythical: false,
          egg_groups: [{ name: 'monster' }],
          pokedex_numbers: [{ pokedex: { name: 'national' } }],
          varieties: mockState.usePalafin
            ? [
              { is_default: true, pokemon: { name: 'palafin-zero', url: 'https://pokeapi.co/api/v2/pokemon/4/' } },
              { is_default: false, pokemon: { name: 'palafin-hero', url: 'https://pokeapi.co/api/v2/pokemon/9000/' } }
            ]
            : []
          };
        }
        if (url.startsWith('/api/v2/pokemon/7/')) {
          return {
          is_default: true,
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
          name: mockState.useRegulationLegalSpecies ? 'blastoise' : 'squirtle',
          is_legendary: mockState.treatSpeciesAsLegendary,
          is_mythical: false,
          egg_groups: [{ name: 'monster' }],
          pokedex_numbers: [{ pokedex: { name: 'national' } }]
          };
        }

        // PokeAPI numbers alternate varieties from 10000 up, so the mock uses the
        // same convention: anything above that is a non-default form with its own
        // /pokemon-form resource.
        const formMatch = url.match(/^\/api\/v2\/pokemon-form\/(\d+)\/$/);
        if (formMatch) {
          const id = Number(formMatch[1]);
          return {
            is_battle_only: id === 10001 || id === 10002,
            is_mega: id === 10002
          };
        }

        const pokemonMatch = url.match(/^\/api\/v2\/pokemon\/(\d+)\/$/);
        if (pokemonMatch) {
          const id = Number(pokemonMatch[1]);
          const isAlternateForm = id >= 10000;
          return {
            is_default: !isAlternateForm,
            forms: isAlternateForm ? [{ url: `https://pokeapi.co/api/v2/pokemon-form/${id}/` }] : undefined,
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
            species: {
              url: `https://pokeapi.co/api/v2/pokemon-species/${id >= 10001 && id <= 10003 ? 4 : id}/`
            }
          };
        }

        const speciesMatch = url.match(/^\/api\/v2\/pokemon-species\/(\d+)\/$/);
        if (speciesMatch) {
          return {
            name: `species-${speciesMatch[1]}`,
            is_legendary: mockState.treatSpeciesAsLegendary,
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
  mockState.useRegulationLegalSpecies = false;
  mockState.regulationSpeciesName = null;
  mockState.treatSpeciesAsLegendary = false;
  mockState.useCoverageTableName = false;
  mockState.includeAlternateForms = false;
  mockState.includeCosmeticVarieties = false;
  mockState.includeUnbreedableVariety = false;
  mockState.usePalafin = false;
  mockState.breakPalafinTrigger = false;
  mockState.useHugePower = false;
  mockState.useSplitStatAbilities = false;
  mockState.useSupportAbility = false;
  mockState.useQualityAbility = false;
  mockState.detailDelayMs = 0;
  mockState.requestCounts.clear();
  mockState.requestOrder = [];
  mockState.activeDetailRequests = 0;
  mockState.maxActiveDetailRequests = 0;
});

const parityCatalog = () => ({
  types: [
    {
      id: 10,
      name: 'fire',
      damageRelations: {
        doubleDamageFrom: ['water', 'rock', 'ground'],
        halfDamageFrom: ['fire', 'grass', 'bug'],
        noDamageFrom: [],
        doubleDamageTo: ['grass', 'bug'],
        halfDamageTo: ['water', 'fire', 'rock'],
        noDamageTo: []
      }
    },
    {
      id: 11,
      name: 'water',
      damageRelations: {
        doubleDamageFrom: ['electric', 'grass'],
        halfDamageFrom: ['water', 'fire', 'ice'],
        noDamageFrom: [],
        doubleDamageTo: ['fire', 'rock', 'ground'],
        halfDamageTo: ['water', 'grass', 'dragon'],
        noDamageTo: []
      }
    },
    {
      id: 12,
      name: 'bug',
      damageRelations: {
        doubleDamageFrom: ['fire', 'flying', 'rock'],
        halfDamageFrom: ['fighting', 'ground', 'grass'],
        noDamageFrom: [],
        doubleDamageTo: ['grass', 'psychic', 'dark'],
        halfDamageTo: ['fire', 'fighting', 'poison', 'flying', 'ghost', 'steel', 'fairy'],
        noDamageTo: []
      }
    },
    {
      id: 13,
      name: 'steel',
      damageRelations: {
        doubleDamageFrom: ['fire', 'fighting', 'ground'],
        halfDamageFrom: [
          'normal', 'flying', 'rock', 'bug', 'steel', 'grass', 'psychic', 'ice', 'dragon', 'fairy'
        ],
        noDamageFrom: ['poison'],
        doubleDamageTo: ['rock', 'ice', 'fairy'],
        halfDamageTo: ['steel', 'fire', 'water', 'electric'],
        noDamageTo: []
      }
    }
  ],
  species: [
    {
      id: 4,
      name: 'charmander',
      isLegendary: false,
      isMythical: false,
      eggGroups: ['monster'],
      pokedexes: ['national'],
      varietyNames: ['charmander']
    },
    {
      id: 7,
      name: 'squirtle',
      isLegendary: false,
      isMythical: false,
      eggGroups: ['monster'],
      pokedexes: ['national'],
      varietyNames: ['squirtle']
    }
  ],
  varieties: [
    {
      id: 4,
      name: 'charmander',
      speciesName: 'charmander',
      isDefault: true,
      types: ['fire'],
      abilityStatus: 'known',
      abilities: [
        { slot: 1, name: 'blaze', isHidden: false },
        { slot: 3, name: 'levitate', isHidden: true }
      ],
      stats: {
        hp: 39,
        attack: 52,
        defense: 43,
        'special-attack': 60,
        'special-defense': 50,
        speed: 65
      },
      sprite: 'charmander.png',
      form: { isMega: false, isBattleOnly: false }
    },
    {
      id: 7,
      name: 'squirtle',
      speciesName: 'squirtle',
      isDefault: true,
      types: ['water'],
      abilityStatus: 'known',
      abilities: [{ slot: 1, name: 'torrent', isHidden: false }],
      stats: {
        hp: 44,
        attack: 48,
        defense: 65,
        'special-attack': 50,
        'special-defense': 64,
        speed: 43
      },
      sprite: 'squirtle.png',
      form: { isMega: false, isBattleOnly: false }
    }
  ]
}) as unknown as PokemonCatalogV1;

const parityOptions = {
  baseScore: 18,
  typeFilters: {
    maxDamageFromScore: false,
    allowQuadrupleDamage: true,
    limitQuadrupleDamage: false
  },
  pokemonFilters: {
    inPokedex: 'national',
    allowMegas: false,
    includeAbilityImmunities: true,
    includeMoveCoverage: true,
    // Parity is asserted on the scoring both paths can express. The live path
    // scores flat because it cannot measure a threat pool before it has fetched
    // one — the reasoning is at the top of `getResistantTypes` in pokedexLive.ts
    // — so comparing under weighting would compare a measurement against its
    // absence and tell us nothing about acquisition.
    weightByThreat: false
  },
  statsFilters: { minimumAttacks: 10, minimumBulk: 10 }
} as const;

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
    expect(isResistantTypeResultList(resistant)).toBe(true);

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

  it('produces the same canonical entry from equivalent live and catalog facts', async () => {
    const live = await getResistantTypes(parityOptions);
    const liveEntry = live.find((type) => type.name === 'fire')!.pokemon[0];
    const catalog = parityCatalog();
    const catalogType = catalogTypeToPokemonType(catalog.types[0], catalog, 18);
    const catalogEntry = enrichCatalogVariety(
      catalog,
      catalog.varieties[0],
      catalogType,
      {},
      {
        baseScore: 18,
        // A parity check between the live and catalog paths, so it wants the
        // weighting both paths default to rather than a measured one.
        threatWeights: UNIFORM_TYPE_THREAT,
        damageFromBounds: damageFromScoreBounds(18),
        inPokedex: 'national',
        allowMegas: false,
        includeAbilityImmunities: true,
        includeMoveCoverage: true,
        minimumAttacks: 10,
        minimumBulk: 10
      }
    );

    expect(catalogEntry).toEqual(liveEntry);
  });

  it('produces identical complete results from equivalent live and catalog facts', async () => {
    const live = await getResistantTypes(parityOptions);
    const fromCatalog = await getCatalogResistantTypes(parityCatalog(), parityOptions);

    expect(fromCatalog).toEqual(live);
  });

  it('keeps live and catalog full scans aligned under every shared default', async () => {
    // Every default except threat weighting, which the live path cannot measure.
    const unweighted = { pokemonFilters: { weightByThreat: false } } as const;

    expect(await getCatalogResistantTypes(parityCatalog(), unweighted))
      .toEqual(await getResistantTypes(unweighted));
  });

  it('scores the catalog path against the metagame and the live path flat', async () => {
    // The paths diverge by design, and the divergence is the feature: a catalog
    // scan knows which species are legal and what they can attack with, so it
    // prices a weakness by how exploitable it actually is. Asserting the gap
    // exists stops the weighting being switched off by accident.
    const [weighted, flat] = await Promise.all([
      getCatalogResistantTypes(parityCatalog()),
      getResistantTypes()
    ]);

    expect(weighted).not.toEqual(flat);
    expect(weighted.map((type) => type.name).sort())
      .toEqual(flat.map((type) => type.name).sort());
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

    // The type row describes the typing, not its highest-stat member, so
    // Charmander's Levitate must not remove ground from the fire type summary.
    expect(fireType!.damage_from_score).toBe(19.5);
    expect(fireType!.weaknesses).toContain('ground');
    expect(fireType!.resistances).not.toContain('ground');

    // Levitate grants a true 0x immunity, so ground lands in both the strict
    // immunity set and the broader resistance set for that Pokemon.
    expect(fireType!.pokemon[0].effective_immunities).toEqual(['ground']);
    expect(fireType!.pokemon[0].effective_resistances).toContain('ground');
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

  it('getResistantTypes should exclude species outside the selected regulation', async () => {
    // charmander and squirtle are not on the Regulation M-B roster.
    const resistant = await getResistantTypes({
      baseScore: 18,
      typeFilters: { maxDamageFromScore: false, allowQuadrupleDamage: true, limitQuadrupleDamage: false },
      pokemonFilters: { inPokedex: 'national', allowMegas: false, includeAbilityImmunities: true, regulation: 'M-B' },
      statsFilters: { minimumStatsTotal: 100, minimumAttacks: 10, minimumDefenses: 10 }
    });

    expect(resistant.every(t => t.pokemon.length === 0)).toBe(true);
  });

  it('getResistantTypes should keep species on the selected regulation roster', async () => {
    mockState.useRegulationLegalSpecies = true;

    const resistant = await getResistantTypes({
      baseScore: 18,
      typeFilters: { maxDamageFromScore: false, allowQuadrupleDamage: true, limitQuadrupleDamage: false },
      pokemonFilters: { inPokedex: 'national', allowMegas: false, includeAbilityImmunities: true, regulation: 'M-B' },
      statsFilters: { minimumStatsTotal: 100, minimumAttacks: 10, minimumDefenses: 10 }
    });

    expect(resistant.find(t => t.name === 'fire')!.pokemon).toHaveLength(1);
    expect(resistant.find(t => t.name === 'water')!.pokemon).toHaveLength(1);
  });

  it('getResistantTypes should reject an unknown regulation instead of scanning unfiltered', async () => {
    await expect(getResistantTypes({
      pokemonFilters: { regulation: 'M-Z' }
    })).rejects.toThrow('Unknown regulation: M-Z');
  });

  it('getResistantTypes should apply the regulation on top of the breedable filter', async () => {
    // charizard is legal in M-B, but the species is reported as legendary here,
    // so the breedable-only preference must still exclude it. Legality and
    // breedability are independent filters and neither overrides the other.
    mockState.useRegulationLegalSpecies = true;
    mockState.treatSpeciesAsLegendary = true;

    const resistant = await getResistantTypes({
      baseScore: 18,
      typeFilters: { maxDamageFromScore: false, allowQuadrupleDamage: true, limitQuadrupleDamage: false },
      pokemonFilters: { inPokedex: 'national', allowMegas: false, includeAbilityImmunities: true, regulation: 'M-B' },
      statsFilters: { minimumStatsTotal: 100, minimumAttacks: 10, minimumDefenses: 10 }
    });

    expect(resistant.every(t => t.pokemon.length === 0)).toBe(true);
  });

  it('getResistantTypes should resolve move coverage beyond STAB', async () => {
    mockState.useCoverageTableName = true;
    const resistant = await getResistantTypes({
      baseScore: 18,
      typeFilters: { maxDamageFromScore: false, allowQuadrupleDamage: true, limitQuadrupleDamage: false },
      pokemonFilters: { inPokedex: 'national', allowMegas: false, includeAbilityImmunities: true, includeMoveCoverage: true },
      statsFilters: { minimumStatsTotal: 100, minimumAttacks: 10, minimumDefenses: 10 }
    });

    // Garchomp's Champions movepool includes fire, water and steel moves, none
    // of which its Ground/Dragon typing can see.
    const coverage = resistant.find(t => t.name === 'fire')!.pokemon[0].effective_move_coverages!;
    expect(coverage.length).toBeGreaterThan(0);
    expect(coverage).toContain('rock');
  });

  it('getResistantTypes should skip move coverage when disabled', async () => {
    mockState.useCoverageTableName = true;
    const resistant = await getResistantTypes({
      baseScore: 18,
      typeFilters: { maxDamageFromScore: false, allowQuadrupleDamage: true, limitQuadrupleDamage: false },
      pokemonFilters: { inPokedex: 'national', allowMegas: false, includeAbilityImmunities: true, includeMoveCoverage: false },
      statsFilters: { minimumStatsTotal: 100, minimumAttacks: 10, minimumDefenses: 10 }
    });

    expect(resistant.find(t => t.name === 'fire')!.pokemon[0].effective_move_coverages).toEqual([]);
  });

  const scanWithAlternateForms = (allowMegas: boolean, regulation?: string) => {
    mockState.includeAlternateForms = true;
    return getResistantTypes({
      baseScore: 18,
      typeFilters: { maxDamageFromScore: false, allowQuadrupleDamage: true, limitQuadrupleDamage: false },
      pokemonFilters: { inPokedex: 'national', allowMegas, includeAbilityImmunities: true, regulation },
      statsFilters: { minimumStatsTotal: 100, minimumAttacks: 10, minimumDefenses: 10 }
    });
  };

  it('getResistantTypes should collapse cosmetic varieties into the base Pokemon', async () => {
    mockState.includeCosmeticVarieties = true;
    const resistant = await getResistantTypes({
      baseScore: 18,
      typeFilters: { maxDamageFromScore: false, allowQuadrupleDamage: true, limitQuadrupleDamage: false },
      pokemonFilters: { inPokedex: 'national', allowMegas: false, includeAbilityImmunities: true },
      statsFilters: { minimumStatsTotal: 100, minimumAttacks: 10, minimumDefenses: 10 }
    });

    const names = resistant.find(t => t.name === 'fire')!.pokemon.map(p => p.pokemon.name);
    // A cap changes nothing this tool models, so it is not a second Pokemon.
    expect(names).toEqual(['charmander']);
  });

  it('getResistantTypes should drop varieties recorded as unbreedable', async () => {
    mockState.includeUnbreedableVariety = true;
    const resistant = await getResistantTypes({
      baseScore: 18,
      typeFilters: { maxDamageFromScore: false, allowQuadrupleDamage: true, limitQuadrupleDamage: false },
      pokemonFilters: { inPokedex: 'national', allowMegas: false, includeAbilityImmunities: true },
      statsFilters: { minimumStatsTotal: 100, minimumAttacks: 10, minimumDefenses: 10 }
    });

    const names = resistant.find(t => t.name === 'fire')!.pokemon.map(p => p.pokemon.name);
    // Every species-level check passes here — the egg group is ordinary and the
    // form is neither battle-only nor Mega — so only the variety-level rule can
    // reject it. This is the case the species-keyed filter could never catch.
    expect(names).not.toContain('floette-eternal');
    expect(names).toContain('charmander');
  });

  it('getResistantTypes should drop battle-only forms but keep permanent ones', async () => {
    const resistant = await scanWithAlternateForms(false);

    const names = resistant.find(t => t.name === 'fire')!.pokemon.map(p => p.pokemon.name);
    // Gigantamax is a state a Pokemon enters mid-battle, not a team slot.
    expect(names).not.toContain('charmander-gmax');
    // A regional form is a Pokemon you can actually bring, so it stays.
    expect(names).toContain('charmander-alola');
    expect(names).toContain('charmander');
  });

  it('getResistantTypes should gate Megas on allowMegas rather than on the name', async () => {
    const withoutMegas = await scanWithAlternateForms(false);
    expect(withoutMegas.find(t => t.name === 'fire')!.pokemon.map(p => p.pokemon.name))
      .not.toContain('charmander-mega');

    __resetPokedexResourceCaches();
    const withMegas = await scanWithAlternateForms(true);
    const names = withMegas.find(t => t.name === 'fire')!.pokemon.map(p => p.pokemon.name);
    // Megas are battle-only by the same flag, but they are a pre-battle choice.
    expect(names).toContain('charmander-mega');
    expect(names).not.toContain('charmander-gmax');
  });

  it('getResistantTypes should enforce a regulation verified Mega roster', async () => {
    mockState.includeAlternateForms = true;
    mockState.regulationSpeciesName = 'arcanine';

    const resistant = await getResistantTypes({
      baseScore: 18,
      typeFilters: { maxDamageFromScore: false, allowQuadrupleDamage: true, limitQuadrupleDamage: false },
      pokemonFilters: {
        inPokedex: 'national',
        allowMegas: true,
        includeAbilityImmunities: true,
        regulation: 'M-B'
      },
      statsFilters: { minimumStatsTotal: 100, minimumAttacks: 10, minimumDefenses: 10 }
    });

    const names = resistant.find(t => t.name === 'fire')!.pokemon.map(p => p.pokemon.name);
    expect(names).toContain('charmander');
    expect(names).not.toContain('charmander-mega');
  });

  it('getResistantTypes should keep Megas present in a verified regulation roster', async () => {
    mockState.useRegulationLegalSpecies = true;

    const resistant = await scanWithAlternateForms(true, 'M-B');
    const names = resistant.find(t => t.name === 'fire')!.pokemon.map(p => p.pokemon.name);

    expect(names).toContain('charmander-mega');
  });

  it('getResistantTypes should not treat an incomplete Mega roster as empty', async () => {
    mockState.useRegulationLegalSpecies = true;

    const resistant = await scanWithAlternateForms(true, 'M-A');
    const names = resistant.find(t => t.name === 'fire')!.pokemon.map(p => p.pokemon.name);

    expect(names).toContain('charmander-mega');
  });

  it('getResistantTypes should not request a form for default varieties', async () => {
    await scanWithAlternateForms(false);

    // The extra request is confined to alternate forms; the base Pokemon is
    // known to be registerable without asking.
    expect(mockState.requestCounts.get('/api/v2/pokemon-form/4/')).toBeUndefined();
    expect(mockState.requestCounts.get('/api/v2/pokemon-form/10001/')).toBe(1);
  });

  const scanPalafin = (statsFilters = { minimumStatsTotal: 100, minimumAttacks: 10, minimumDefenses: 10 }) => {
    mockState.usePalafin = true;
    return getResistantTypes({
      baseScore: 18,
      typeFilters: { maxDamageFromScore: false, allowQuadrupleDamage: true, limitQuadrupleDamage: false },
      pokemonFilters: { inPokedex: 'national', allowMegas: false, includeAbilityImmunities: true },
      statsFilters
    });
  };

  it('getResistantTypes should rate a Pokemon on the form it fights in', async () => {
    const entry = (await scanPalafin()).find(t => t.name === 'fire')!.pokemon[0];

    // Identity stays with the registered form; only the numbers move.
    expect(entry.pokemon.name).toBe('charmander');
    expect(entry.species_name).toBe('palafin');
    expect(entry.battle_form_name).toBe('palafin-hero');
    expect(entry.stats!.attack).toBe(160);
    expect(entry.stats_total).toBe(650);
  });

  it('getResistantTypes should apply stat floors to the fighting form', async () => {
    // The registered Palafin-Zero form would fail this floor. Rating it there
    // would drop from the scan a Pokemon that battles at 650.
    const resistant = await scanPalafin({ minimumStatsTotal: 600, minimumAttacks: 150, minimumDefenses: 80 });

    expect(resistant.find(t => t.name === 'fire')!.pokemon).toHaveLength(1);
  });

  it('getResistantTypes should rate as registered when the trigger ability is absent', async () => {
    mockState.breakPalafinTrigger = true;
    const entry = (await scanPalafin()).find(t => t.name === 'fire')!.pokemon[0];

    // Without Zero to Hero the battle form is unreachable, so the registered
    // form's own stats stand.
    expect(entry.battle_form_name).toBeUndefined();
    expect(entry.stats!.attack).toBe(52);
  });

  it('getResistantTypes should leave ordinary Pokemon unmarked', async () => {
    const resistant = await getResistantTypes({
      baseScore: 18,
      typeFilters: { maxDamageFromScore: false, allowQuadrupleDamage: true, limitQuadrupleDamage: false },
      pokemonFilters: { inPokedex: 'national', allowMegas: false, includeAbilityImmunities: true },
      statsFilters: { minimumStatsTotal: 100, minimumAttacks: 10, minimumDefenses: 10 }
    });

    expect(resistant.find(t => t.name === 'fire')!.pokemon[0].battle_form_name).toBeUndefined();
  });

  // The mocked Charmander is 39/52/43/60/50/65: best attack 60 and HP-adjusted
  // effective bulk 42.6. Squirtle is 44/48/65/50/64/43: attack 50, bulk 53.3.
  const scanWithFloors = (minimumAttacks: number, minimumBulk: number) => getResistantTypes({
    baseScore: 18,
    typeFilters: { maxDamageFromScore: false, allowQuadrupleDamage: true, limitQuadrupleDamage: false },
    pokemonFilters: { inPokedex: 'national', allowMegas: false, includeAbilityImmunities: true },
    statsFilters: { minimumAttacks, minimumBulk }
  });
  const firePokemon = (result: Awaited<ReturnType<typeof getResistantTypes>>) =>
    result.find(t => t.name === 'fire')!.pokemon;

  describe('stat floors', () => {
    it('defaults to an 80 attack floor and a 70 effective-bulk floor', () => {
      expect(DEFAULT_STATS_FILTERS).toEqual({
        minimumAttacks: 80,
        minimumBulk: 70
      });
    });

    it('factors HP into physical and special bulk', () => {
      expect(hpAdjustedBulk({ hp: 70, defense: 70, 'special-defense': 70 })).toBe(70);
      expect(hpAdjustedBulk({ hp: 60, defense: 60, 'special-defense': 75 })).toBeCloseTo(63.54, 2);
    });

    it('rejects a Pokemon that clears the attack floor but not the defense floor', () => {
      return scanWithFloors(55, 90).then(r => expect(firePokemon(r)).toHaveLength(0));
    });

    it('rejects a Pokemon that clears the defense floor but not the attack floor', () => {
      return scanWithFloors(90, 40).then(r => expect(firePokemon(r)).toHaveLength(0));
    });

    it('keeps a Pokemon that reaches both floors', () => {
      return scanWithFloors(60, 42).then(r => expect(firePokemon(r)).toHaveLength(1));
    });

    it('ignores the removed total-stat floor from legacy callers', () => {
      return getResistantTypes({
        baseScore: 18,
        typeFilters: { maxDamageFromScore: false, allowQuadrupleDamage: true, limitQuadrupleDamage: false },
        pokemonFilters: { inPokedex: 'national', allowMegas: false, includeAbilityImmunities: true },
        statsFilters: { minimumStatsTotal: 900, minimumAttacks: 1, minimumBulk: 1 }
      }).then(r => expect(firePokemon(r)).toHaveLength(1));
    });

    it.each([true, false])(
      'does not combine mutually exclusive stat abilities when immunities=%s',
      async (includeAbilityImmunities) => {
        mockState.useSplitStatAbilities = true;
        const result = await getResistantTypes({
          baseScore: 18,
          typeFilters: { maxDamageFromScore: false, allowQuadrupleDamage: true, limitQuadrupleDamage: false },
          pokemonFilters: { inPokedex: 'national', allowMegas: false, includeAbilityImmunities },
          statsFilters: { minimumAttacks: 100, minimumBulk: 50 }
        });

        // Huge Power clears Attack but not Bulk; Fur Coat clears Bulk but not
        // Attack. The Pokemon cannot use both abilities at once.
        expect(firePokemon(result)).toHaveLength(0);
      }
    );

    it('keeps all ability profiles when one profile clears both floors', async () => {
      mockState.useSplitStatAbilities = true;
      const result = await getResistantTypes({
        baseScore: 18,
        typeFilters: { maxDamageFromScore: false, allowQuadrupleDamage: true, limitQuadrupleDamage: false },
        pokemonFilters: { inPokedex: 'national', allowMegas: false, includeAbilityImmunities: true },
        statsFilters: { minimumAttacks: 100, minimumBulk: 40 }
      });
      const entry = firePokemon(result)[0];

      expect(Object.keys(entry.ability_profiles!)).toEqual(['huge-power', 'fur-coat']);
      expect(entry.ability_profiles!['huge-power'].stats!.attack).toBe(104);
      expect(entry.ability_profiles!['fur-coat'].stats!.defense).toBe(86);
    });

    it('defaults to DEFAULT_STATS_FILTERS when none are supplied', async () => {
      // Charmander misses both active defaults, so omitted statsFilters must
      // not silently mean "no floors".
      const resistant = await getResistantTypes({
        baseScore: 18,
        typeFilters: { maxDamageFromScore: false, allowQuadrupleDamage: true, limitQuadrupleDamage: false },
        pokemonFilters: { inPokedex: 'national', allowMegas: false, includeAbilityImmunities: true }
      });

      expect(firePokemon(resistant)).toHaveLength(0);
    });
  });

  // The mocked charmander is 39/52/43/60/50/65 — an Attack of 52 that Huge
  // Power takes to 104.
  const scanHugePower = (statsFilters = { minimumStatsTotal: 100, minimumAttacks: 10, minimumDefenses: 10 }) => {
    mockState.useHugePower = true;
    return getResistantTypes({
      baseScore: 18,
      typeFilters: { maxDamageFromScore: false, allowQuadrupleDamage: true, limitQuadrupleDamage: false },
      pokemonFilters: { inPokedex: 'national', allowMegas: false, includeAbilityImmunities: true },
      statsFilters
    });
  };

  it('getResistantTypes should apply an unconditional stat ability', async () => {
    const entry = (await scanHugePower()).find(t => t.name === 'fire')!.pokemon[0];

    expect(entry.stats!.attack).toBe(104);
    expect(entry.base_stats!.attack).toBe(52);
    expect(entry.stat_ability_name).toBe('huge-power');
    // Only the one stat moves.
    expect(entry.stats!['special-attack']).toBe(60);
  });

  it('getResistantTypes should test the stat floors against the ability', async () => {
    // 52 Attack fails this floor; the 104 it actually swings with clears it.
    const resistant = await scanHugePower({ minimumStatsTotal: 100, minimumAttacks: 100, minimumDefenses: 10 });

    expect(resistant.find(t => t.name === 'fire')!.pokemon).toHaveLength(1);
  });

  it('getResistantTypes should prefer a stat ability over a purely defensive one', async () => {
    const entry = (await scanHugePower()).find(t => t.name === 'fire')!.pokemon[0];

    // Sap Sipper grants a Grass immunity and so wins on defensive merit, which
    // is the only thing the ability selector used to weigh. Doubling Attack
    // outweighs one type immunity for the Pokemon built around it.
    expect(entry.selected_ability_name).toBe('huge-power');
  });

  it('getResistantTypes should give each ability its own stat line', async () => {
    const entry = (await scanHugePower()).find(t => t.name === 'fire')!.pokemon[0];

    expect(entry.ability_profiles!['huge-power'].stats!.attack).toBe(104);
    // Switching ability in the UI must not keep the doubled Attack.
    expect(entry.ability_profiles!['sap-sipper'].stats!.attack).toBe(52);
  });

  it('getResistantTypes should leave ordinary Pokemon on their published stats', async () => {
    const resistant = await getResistantTypes({
      baseScore: 18,
      typeFilters: { maxDamageFromScore: false, allowQuadrupleDamage: true, limitQuadrupleDamage: false },
      pokemonFilters: { inPokedex: 'national', allowMegas: false, includeAbilityImmunities: true },
      statsFilters: { minimumStatsTotal: 100, minimumAttacks: 10, minimumDefenses: 10 }
    });
    const entry = resistant.find(t => t.name === 'fire')!.pokemon[0];

    expect(entry.stats!.attack).toBe(52);
    expect(entry.stat_ability_name).toBeUndefined();
  });

  it('getResistantTypes should select a support ability over a type immunity', async () => {
    mockState.useSupportAbility = true;
    const resistant = await getResistantTypes({
      baseScore: 18,
      typeFilters: { maxDamageFromScore: false, allowQuadrupleDamage: true, limitQuadrupleDamage: false },
      pokemonFilters: { inPokedex: 'national', allowMegas: false, includeAbilityImmunities: true },
      statsFilters: { minimumStatsTotal: 100, minimumAttacks: 10, minimumDefenses: 10 }
    });
    const entry = resistant.find(t => t.name === 'fire')!.pokemon[0];

    // Flash Fire wins on defensive merit, which was the only thing weighed.
    // Drought is the reason the Pokemon gets brought at all.
    expect(entry.selected_ability_name).toBe('drought');
    // Every ability is still offered; only the default changed.
    expect(Object.keys(entry.ability_profiles!).sort()).toEqual(['drought', 'flash-fire', 'white-smoke']);
  });

  it('getResistantTypes should select a quality ability out of a hidden slot', async () => {
    mockState.useQualityAbility = true;
    const resistant = await getResistantTypes({
      baseScore: 18,
      typeFilters: { maxDamageFromScore: false, allowQuadrupleDamage: true, limitQuadrupleDamage: false },
      pokemonFilters: { inPokedex: 'national', allowMegas: false, includeAbilityImmunities: true },
      statsFilters: { minimumStatsTotal: 100, minimumAttacks: 10, minimumDefenses: 10 }
    });
    const entry = resistant.find(t => t.name === 'fire')!.pokemon[0];

    // Unaware changes neither the stats nor a type matchup, so every earlier
    // version of the selection rule fell through to the first slot and picked
    // Blaze — which left abilityEffects.ts with nothing in the app using it.
    expect(entry.selected_ability_name).toBe('unaware');
  });

  it('getResistantTypes should fetch a battle form inside the concurrency budget', async () => {
    // Enough entries that the prefetch cannot drain in a single wave, so there
    // are provably later requests to compare against.
    mockState.expandFireRoster = true;
    await scanPalafin();

    const order = mockState.requestOrder;
    const battleFormIndex = order.indexOf('/api/v2/pokemon/9000/');
    expect(battleFormIndex).toBeGreaterThanOrEqual(0);

    // The prefetch warms every detail request under mapWithConcurrency, and
    // processPokemon then issues none of its own. A battle form resolved lazily
    // instead would be the *last* detail request of the whole scan, since by
    // then everything else is cached — so the presence of later ones is the
    // signal that this fetch happened inside the budget.
    const laterDetailRequests = order
      .slice(battleFormIndex + 1)
      .filter((url) => url.startsWith('/api/v2/pokemon'));

    expect(laterDetailRequests.length).toBeGreaterThan(0);
    expect(mockState.maxActiveDetailRequests).toBeLessThanOrEqual(12);
  });

  it('getResistantTypes should fetch a battle form once across every typing', async () => {
    mockState.duplicateCharmanderAcrossTypes = true;
    await scanPalafin();

    expect(mockState.requestCounts.get('/api/v2/pokemon/9000/')).toBe(1);
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
});
