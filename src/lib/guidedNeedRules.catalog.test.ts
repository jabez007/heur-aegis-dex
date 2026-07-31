import { beforeAll, describe, expect, it } from 'vitest';
import catalogData from '../../data/pokemon-catalog.v1.json';
import { BATTLE_FORMATS } from './battleFormats';
import { recommendGuidedPartners } from './guidedNeedRules';
import { flattenToPokemon, type PokemonEntry } from './pokemonEntry';
import { getCatalogResistantTypes } from './pokemonCatalogScan';
import type { PokemonCatalogV1 } from './pokemonCatalog';

const catalog = catalogData as unknown as PokemonCatalogV1;
let candidatePool: PokemonEntry[];
let typeNames: string[];

beforeAll(async () => {
  const scan = await getCatalogResistantTypes(catalog, {
    typeFilters: {
      maxDamageFromScore: false,
      allowQuadrupleDamage: true,
      limitQuadrupleDamage: false
    },
    statsFilters: { minimumAttacks: 1, minimumBulk: 1 }
  });
  candidatePool = flattenToPokemon(scan);
  typeNames = scan.map(({ name }) => name).filter((name) => !name.includes('/'));
});

const members = (...names: string[]): PokemonEntry[] => names.map((name) => {
  const pokemon = candidatePool.find((entry) => entry.name === name);
  if (!pokemon) throw new Error(`Catalog fixture is missing ${name}`);
  return pokemon;
});

describe.each(['singles', 'doubles'] as const)('guided catalog recommendations: %s', (format) => {
  it('returns a stable shortlist for a recognizable weak core', () => {
    const request = {
      format: BATTLE_FORMATS[format],
      typeNames,
      currentMembers: members('gyarados', 'pelipper'),
      candidatePool
    };
    const first = recommendGuidedPartners(request);
    const second = recommendGuidedPartners(request);

    expect(first).toHaveLength(5);
    expect(first.map(({ varietyName }) => varietyName)).toEqual([
      'archaludon',
      'mamoswine',
      'dragapult',
      'excadrill',
      'goodra-hisui'
    ]);
    expect(first.every(({ needId, reasons }) =>
      needId === 'shared-quadruple-weakness' &&
      reasons.some(({ dimension, delta }) => dimension === 'electric' && delta < 0)
    )).toBe(true);
    expect(second).toEqual(first);
  });

  it('returns no result when the primary need already has an answer', () => {
    const recommendations = recommendGuidedPartners({
      format: BATTLE_FORMATS[format],
      typeNames,
      currentMembers: members('gyarados', 'pelipper', 'seaking'),
      candidatePool
    });

    expect(members('seaking')[0].abilityName).toBe('lightning-rod');
    expect(recommendations).toEqual([]);
  });
});
