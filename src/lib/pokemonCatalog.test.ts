import { describe, expect, it } from 'vitest';
import catalogData from '../../data/pokemon-catalog.v1.json';
import { BATTLE_FORMS } from './battleForms';
import {
  ELEMENTAL_TYPES,
  POKEMON_CATALOG_CONTENT_HASH,
  POKEMON_CATALOG_REGULATION_DIGEST,
  POKEMON_CATALOG_SCHEMA_VERSION,
  parseAndVerifyPokemonCatalog,
  validatePokemonCatalog,
  type PokemonCatalogV1
} from './pokemonCatalog';
import { REGULATIONS } from './regulations';
import { UNBREEDABLE_FORMS } from './unbreedableForms';

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`
    ).join(',')}}`;
  }
  return JSON.stringify(value);
};

const sha256 = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

const fixture = (): PokemonCatalogV1 => ({
  manifest: {
    schemaVersion: POKEMON_CATALOG_SCHEMA_VERSION,
    source: {
      repository: 'https://github.com/PokeAPI/api-data',
      revision: 'a'.repeat(40),
      committedAt: '2026-07-28T23:18:27Z',
      license: 'BSD-3-Clause'
    },
    contentHash: 'b'.repeat(64),
    regulationDigest: 'c'.repeat(64),
    capabilityDigest: null,
    capabilityRulesVersion: null,
    counts: { types: 18, species: 1, varieties: 1, varietiesMissingAbilities: 0 }
  },
  types: ELEMENTAL_TYPES.map((name, index) => ({
    id: index + 1,
    name,
    damageRelations: {
      doubleDamageFrom: [], halfDamageFrom: [], noDamageFrom: [],
      doubleDamageTo: [], halfDamageTo: [], noDamageTo: []
    }
  })),
  species: [{
    id: 1,
    name: 'bulbasaur',
    isLegendary: false,
    isMythical: false,
    eggGroups: ['monster', 'plant'],
    pokedexes: ['national', 'kanto'],
    varietyNames: ['bulbasaur']
  }],
  varieties: [{
    id: 1,
    name: 'bulbasaur',
    speciesName: 'bulbasaur',
    isDefault: true,
    types: ['grass', 'poison'],
    abilityStatus: 'known',
    abilities: [{ slot: 1, name: 'overgrow', isHidden: false }],
    stats: { hp: 45, attack: 49, defense: 49, 'special-attack': 65, 'special-defense': 65, speed: 45 },
    sprite: 'https://example.test/1.png',
    form: { isMega: false, isBattleOnly: false }
  }]
});

describe('Pokemon catalog validation', () => {
  it('accepts a complete normalized catalog', () => {
    expect(validatePokemonCatalog(fixture())).toEqual([]);
  });

  it('rejects duplicate identities and broken joins', () => {
    const catalog = fixture();
    const orphan = { ...catalog.varieties[0], speciesName: 'missing' };
    const invalid = {
      ...catalog,
      manifest: { ...catalog.manifest, counts: { ...catalog.manifest.counts, varieties: 2 } },
      varieties: [orphan, { ...orphan }]
    };

    expect(validatePokemonCatalog(invalid)).toEqual(expect.arrayContaining([
      'variety ids and names must be unique',
      'variety bulbasaur references missing species',
      'species bulbasaur variety list does not match catalog joins'
    ]));
  });

  it('rejects incomplete type charts and stale manifest counts', () => {
    const catalog = fixture();
    const invalid = {
      ...catalog,
      manifest: {
        ...catalog.manifest,
        counts: { types: 18, species: 2, varieties: 1, varietiesMissingAbilities: 0 }
      },
      types: catalog.types.slice(1)
    };

    expect(validatePokemonCatalog(invalid)).toEqual(expect.arrayContaining([
      'catalog must contain each elemental type exactly once',
      'manifest counts do not match catalog collections'
    ]));
  });

  it('rejects noncanonical type ids and duplicate variety typings', () => {
    const catalog = fixture();
    const invalid = {
      ...catalog,
      types: [{ ...catalog.types[0], id: 99 }, ...catalog.types.slice(1)],
      varieties: [{ ...catalog.varieties[0], types: ['grass', 'grass'] }]
    };

    expect(validatePokemonCatalog(invalid)).toEqual(expect.arrayContaining([
      'catalog elemental type ids do not match canonical PokeAPI ids',
      'variety bulbasaur must have unique types'
    ]));
  });

  it('rejects incomplete relation and provenance contracts', () => {
    const catalog = fixture();
    const invalid = {
      ...catalog,
      manifest: {
        ...catalog.manifest,
        source: {
          ...catalog.manifest.source,
          repository: 'https://example.test/data',
          committedAt: 'not-a-date',
          license: 'proprietary'
        },
        capabilityDigest: 'unexpected',
        capabilityRulesVersion: 1
      },
      types: [{ ...catalog.types[0], damageRelations: {} }, ...catalog.types.slice(1)]
    };

    expect(validatePokemonCatalog(invalid)).toEqual(expect.arrayContaining([
      'invalid source repository',
      'invalid source commit timestamp',
      'invalid source license',
      'phase-one catalog must not claim capability data',
      'type normal has invalid damage relations'
    ]));
  });

  it('requires missing ability data to be explicit', () => {
    const catalog = fixture();
    const invalid = {
      ...catalog,
      varieties: [{ ...catalog.varieties[0], abilities: [] }]
    };

    expect(validatePokemonCatalog(invalid)).toContain(
      'variety bulbasaur ability status does not match its ability data'
    );

    const explicit = {
      ...invalid,
      manifest: {
        ...catalog.manifest,
        counts: { ...catalog.manifest.counts, varietiesMissingAbilities: 1 }
      },
      varieties: [{ ...invalid.varieties[0], abilityStatus: 'missing' }]
    };
    expect(validatePokemonCatalog(explicit)).toEqual([]);
  });
});

describe('generated Pokemon catalog', () => {
  const catalog = catalogData as unknown as PokemonCatalogV1;

  it('is semantically valid and content-addressed', async () => {
    expect(validatePokemonCatalog(catalog)).toEqual([]);
    expect(catalog.manifest.contentHash).toBe(POKEMON_CATALOG_CONTENT_HASH);
    expect(catalog.manifest.regulationDigest).toBe(POKEMON_CATALOG_REGULATION_DIGEST);
    await expect(parseAndVerifyPokemonCatalog(catalog)).resolves.toBe(catalog);
    const hash = await sha256(canonicalJson({
      types: catalog.types,
      species: catalog.species,
      varieties: catalog.varieties
    }));
    expect(hash).toBe(catalog.manifest.contentHash);
  });

  it('rejects semantically valid catalog data whose content hash was not updated', async () => {
    const first = catalog.varieties[0];
    const tampered = {
      ...catalog,
      varieties: [{ ...first, sprite: 'https://example.test/tampered.png' }, ...catalog.varieties.slice(1)]
    };

    await expect(parseAndVerifyPokemonCatalog(tampered)).rejects.toThrow(
      'Pokemon catalog content hash mismatch'
    );
  });

  it('contains every regulation and curated-form dependency', () => {
    const species = new Set(catalog.species.map((entry) => entry.name));
    const varieties = new Set(catalog.varieties.map((entry) => entry.name));

    REGULATIONS.forEach((regulation) => {
      [...regulation.legalSpecies].forEach((name) => expect(species.has(name), name).toBe(true));
    });
    BATTLE_FORMS.forEach((rule) => {
      expect(species.has(rule.species), rule.species).toBe(true);
      expect(varieties.has(rule.variety), rule.variety).toBe(true);
    });
    UNBREEDABLE_FORMS.forEach((rule) => {
      expect(species.has(rule.species), rule.species).toBe(true);
      expect(varieties.has(rule.variety), rule.variety).toBe(true);
    });
  });

  it('is tied to the complete current regulation data', async () => {
    const normalized = [...REGULATIONS].sort((a, b) => a.id.localeCompare(b.id)).map((regulation) => ({
      id: regulation.id,
      label: regulation.label,
      activeFrom: regulation.activeFrom,
      activeTo: regulation.activeTo,
      rules: {
        formats: [...regulation.rules.formats].sort(),
        battleLevel: regulation.rules.battleLevel,
        allowDuplicateSpecies: regulation.rules.allowDuplicateSpecies,
        allowDuplicateItems: regulation.rules.allowDuplicateItems
      },
      mechanics: [...regulation.mechanics].sort(),
      legalSpecies: [...regulation.legalSpecies].sort(),
      megaCapableSpecies: [...regulation.megaCapableSpecies].sort(),
      incompleteFields: [...regulation.incompleteFields].sort(),
      sources: [...regulation.sources].sort(),
      verifiedOn: regulation.verifiedOn
    }));

    expect(await sha256(canonicalJson(normalized))).toBe(catalog.manifest.regulationDigest);
  });

  it('records incomplete upstream ability data instead of dropping varieties', () => {
    const missing = catalog.varieties.filter((entry) => entry.abilityStatus === 'missing');
    expect(missing).toHaveLength(catalog.manifest.counts.varietiesMissingAbilities);
    expect(missing).toHaveLength(14);
    expect(missing.every((entry) => entry.abilities.length === 0)).toBe(true);
  });
});
