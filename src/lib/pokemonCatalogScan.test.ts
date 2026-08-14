import { describe, expect, it } from 'vitest';
import catalogData from '../../data/pokemon-catalog.v1.json';
import { buildOffensiveTypeChart } from './coverageMoves';
import {
  enrichCatalogVariety,
  getCatalogResistantTypes,
  getCatalogBaseTypes
} from './pokemonCatalogScan';
import { damageFromScoreBounds } from './pokedexScoring';
import { isResistantTypeResultList } from './pokedexTypes';
import { UNIFORM_TYPE_THREAT } from './typeThreat';
import type { PokemonCatalogV1 } from './pokemonCatalog';

const catalog = catalogData as unknown as PokemonCatalogV1;
const enrichmentOptions = {
  baseScore: 18,
  // These assertions predate threat weighting and are about the adapter, not
  // the scoring, so they run on the flat count they were written against.
  threatWeights: UNIFORM_TYPE_THREAT,
  damageFromBounds: damageFromScoreBounds(18),
  inPokedex: 'national',
  allowMegas: false,
  includeAbilityImmunities: true,
  includeMoveCoverage: true,
  minimumAttacks: 1,
  minimumBulk: 1
} as const;

describe('catalog scan adapter', () => {
  it('converts the complete catalog type chart without network data', () => {
    const types = getCatalogBaseTypes(catalog, 18);
    const fire = types.find((type) => type.name === 'fire')!;

    expect(types).toHaveLength(18);
    expect(fire.damage_relations.double_damage_from.map((entry) => entry.name))
      .toEqual(['ground', 'rock', 'water']);
    expect(fire.damage_relations.damage_from_score).toBe(18);
    expect(fire.pokemon?.some((entry) => entry.pokemon.name === 'charmander')).toBe(true);
  });

  it('joins and rates Palafin on Hero stats while preserving registered identity', () => {
    const types = getCatalogBaseTypes(catalog, 18);
    const water = types.find((type) => type.name === 'water')!;
    const palafin = catalog.varieties.find((variety) => variety.name === 'palafin-zero')!;
    const before = JSON.stringify(palafin);
    const chart = buildOffensiveTypeChart(types);

    const first = enrichCatalogVariety(catalog, palafin, water, chart, enrichmentOptions);
    const second = enrichCatalogVariety(catalog, palafin, water, chart, enrichmentOptions);

    expect(first?.pokemon.name).toBe('palafin-zero');
    expect(first?.species_name).toBe('palafin');
    expect(first?.battle_form_name).toBe('palafin-hero');
    expect(first?.base_stats?.attack).toBe(160);
    expect(first?.stats_total).toBe(650);
    expect(second).toEqual(first);
    expect(JSON.stringify(palafin)).toBe(before);
  });

  it('represents explicitly missing abilities with the canonical blank profile', () => {
    const base = catalog.varieties.find((variety) => variety.name === 'charmander')!;
    const species = catalog.species.find((entry) => entry.name === 'charmander')!;
    const missingAbilitiesCatalog = {
      ...catalog,
      species: [{ ...species, varietyNames: ['charmander'] }],
      varieties: [{ ...base, abilityStatus: 'missing' as const, abilities: [] }]
    };
    const types = getCatalogBaseTypes(missingAbilitiesCatalog, 18);
    const fire = types.find((type) => type.name === 'fire')!;
    const entry = enrichCatalogVariety(
      missingAbilitiesCatalog,
      missingAbilitiesCatalog.varieties[0],
      fire,
      buildOffensiveTypeChart(types),
      enrichmentOptions
    );

    expect(entry?.abilities).toEqual([]);
    expect(Object.keys(entry?.ability_profiles || {})).toEqual(['']);
    expect(entry?.selected_ability_name).toBe('');
  });

  it('runs the complete committed catalog deterministically without acquisition', async () => {
    const options = {
      typeFilters: {
        maxDamageFromScore: false,
        allowQuadrupleDamage: true,
        limitQuadrupleDamage: false
      },
      statsFilters: { minimumAttacks: 1, minimumBulk: 1 }
    } as const;
    const first = await getCatalogResistantTypes(catalog, options);
    const second = await getCatalogResistantTypes(catalog, options);
    const groundDragon = first.find((type) => type.name === 'ground/dragon');
    const names = first.flatMap((type) => type.pokemon.map((entry) => entry.pokemon.name));

    expect(first).toHaveLength(171);
    expect(isResistantTypeResultList(first)).toBe(true);
    expect(groundDragon?.pokemon.some((entry) => entry.pokemon.name === 'garchomp')).toBe(true);
    expect(names).toContain('palafin-zero');
    expect(names).not.toContain('palafin-hero');
    expect(names).not.toContain('floette-eternal');
    expect(second).toEqual(first);
  });
});
