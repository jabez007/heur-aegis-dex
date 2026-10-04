import { createHash } from 'node:crypto';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  ELEMENTAL_TYPES,
  POKEMON_CATALOG_SCHEMA_VERSION,
  assertPokemonCatalog,
  type CatalogSpeciesV1,
  type CatalogTypeV1,
  type CatalogVarietyV1,
  type PokemonCatalogV1
} from '../src/lib/pokemonCatalog.ts';
import { REGULATIONS } from '../src/lib/regulations.ts';
import {
  canonicalJson,
  fetchJsonWithRetry,
  mapBounded,
  readArray,
  readBoolean,
  readPositiveInteger,
  readRecord,
  readResourceIndex,
  readString,
  type IndexedResource
} from './pokemon-catalog-generator.ts';

const SOURCE_REVISION = 'eed7925e3158c9f744816768d3cc3395e290127f';
const SOURCE_COMMITTED_AT = '2026-07-28T23:18:27Z';
const SOURCE_ROOT = `https://raw.githubusercontent.com/PokeAPI/api-data/${SOURCE_REVISION}/data/api/v2`;
const CONCURRENCY = 12;
const REPOSITORY_ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUTPUT_PATH = fileURLToPath(new URL('../data/pokemon-catalog.v1.json', import.meta.url));

type ResourceRef = IndexedResource;

interface TypeResult {
  readonly catalogType: CatalogTypeV1;
  readonly varieties: readonly ResourceRef[];
}

interface VarietySource {
  readonly catalogVariety: Omit<CatalogVarietyV1, 'form'>;
  readonly species: ResourceRef;
  readonly formRefs: readonly ResourceRef[];
}

interface SpeciesResult {
  readonly catalogSpecies: CatalogSpeciesV1;
  readonly varieties: readonly { ref: ResourceRef; isDefault: boolean }[];
}

interface FormResult {
  readonly ref: ResourceRef;
  readonly pokemon: ResourceRef;
  readonly isDefault: boolean;
  readonly isMega: boolean;
  readonly isBattleOnly: boolean;
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

function assertUnique<T>(values: readonly T[], path: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${path} contains duplicates`);
}

function resourceRef(value: unknown, endpoint: string, path: string): ResourceRef {
  const record = readRecord(value, path);
  const name = readString(record, 'name', path);
  const url = readString(record, 'url', path);
  const match = url.match(new RegExp(`^(?:https://pokeapi\\.co)?/api/v2/${endpoint}/(\\d+)/$`));
  if (!match) throw new Error(`${path}.url is not a ${endpoint} resource URL`);
  const id = Number(match[1]);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`${path}.url has an invalid resource id`);
  return { id, name };
}

function namedResources(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  const names = value.map((entry, index) => readString(readRecord(entry, `${path}[${index}]`), 'name', `${path}[${index}]`));
  assertUnique(names, path);
  return names.sort();
}

function normalizeType(value: unknown, expectedName: string, expectedId: number): TypeResult {
  const path = `type/${expectedId}`;
  const type = readRecord(value, path);
  const id = readPositiveInteger(type, 'id', path);
  const name = readString(type, 'name', path);
  if (id !== expectedId || name !== expectedName) {
    throw new Error(`${path} identity mismatch: expected ${expectedName}/${expectedId}, received ${name}/${id}`);
  }
  const relations = readRecord(type.damage_relations, `${path}.damage_relations`);
  const varieties = readArray(type, 'pokemon', path).map((entry, index) => {
    const itemPath = `${path}.pokemon[${index}]`;
    const item = readRecord(entry, itemPath);
    readPositiveInteger(item, 'slot', itemPath);
    return resourceRef(item.pokemon, 'pokemon', `${itemPath}.pokemon`);
  });
  assertUnique(varieties.map((entry) => entry.id), `${path}.pokemon ids`);

  return {
    catalogType: {
      id,
      name,
      damageRelations: {
        doubleDamageFrom: namedResources(relations.double_damage_from, `${path}.damage_relations.double_damage_from`),
        halfDamageFrom: namedResources(relations.half_damage_from, `${path}.damage_relations.half_damage_from`),
        noDamageFrom: namedResources(relations.no_damage_from, `${path}.damage_relations.no_damage_from`),
        doubleDamageTo: namedResources(relations.double_damage_to, `${path}.damage_relations.double_damage_to`),
        halfDamageTo: namedResources(relations.half_damage_to, `${path}.damage_relations.half_damage_to`),
        noDamageTo: namedResources(relations.no_damage_to, `${path}.damage_relations.no_damage_to`)
      }
    },
    varieties
  };
}

function normalizeVariety(value: unknown, expected: ResourceRef): VarietySource {
  const path = `pokemon/${expected.id}`;
  const pokemon = readRecord(value, path);
  const id = readPositiveInteger(pokemon, 'id', path);
  const name = readString(pokemon, 'name', path);
  if (id !== expected.id || name !== expected.name) throw new Error(`${path} identity does not match its type reference`);

  const species = resourceRef(pokemon.species, 'pokemon-species', `${path}.species`);
  const isDefault = readBoolean(pokemon, 'is_default', path);
  const types = readArray(pokemon, 'types', path).map((entry, index) => {
    const itemPath = `${path}.types[${index}]`;
    const item = readRecord(entry, itemPath);
    const slot = readPositiveInteger(item, 'slot', itemPath);
    const ref = resourceRef(item.type, 'type', `${itemPath}.type`);
    return { slot, ref };
  }).sort((a, b) => a.slot - b.slot);
  assertUnique(types.map((entry) => entry.slot), `${path}.type slots`);

  const abilities = readArray(pokemon, 'abilities', path).map((entry, index) => {
    const itemPath = `${path}.abilities[${index}]`;
    const item = readRecord(entry, itemPath);
    return {
      slot: readPositiveInteger(item, 'slot', itemPath),
      name: resourceRef(item.ability, 'ability', `${itemPath}.ability`).name,
      isHidden: readBoolean(item, 'is_hidden', itemPath)
    };
  }).sort((a, b) => a.slot - b.slot);
  assertUnique(abilities.map((entry) => entry.slot), `${path}.ability slots`);

  const statEntries = readArray(pokemon, 'stats', path).map((entry, index) => {
    const itemPath = `${path}.stats[${index}]`;
    const item = readRecord(entry, itemPath);
    return [resourceRef(item.stat, 'stat', `${itemPath}.stat`).name, readPositiveInteger(item, 'base_stat', itemPath)] as const;
  });
  const expectedStats = ['hp', 'attack', 'defense', 'special-attack', 'special-defense', 'speed'] as const;
  assertUnique(statEntries.map(([statName]) => statName), `${path}.stat names`);
  const stats = Object.fromEntries(statEntries) as Record<string, number>;
  if (statEntries.length !== expectedStats.length || expectedStats.some((statName) => stats[statName] === undefined)) {
    throw new Error(`${path}.stats must contain exactly the six battle stats`);
  }

  const sprites = readRecord(pokemon.sprites, `${path}.sprites`);
  const spriteValue = sprites.front_default;
  if (!(typeof spriteValue === 'string' && spriteValue.length > 0) && spriteValue !== null) {
    throw new Error(`${path}.sprites.front_default must be a non-empty string or null`);
  }
  const formRefs = readArray(pokemon, 'forms', path).map((entry, index) =>
    resourceRef(entry, 'pokemon-form', `${path}.forms[${index}]`)
  );
  if (formRefs.length === 0) throw new Error(`${path}.forms must not be empty`);
  assertUnique(formRefs.map((entry) => entry.id), `${path}.form ids`);

  return {
    catalogVariety: {
      id,
      name,
      speciesName: species.name,
      isDefault,
      types: types.map((entry) => entry.ref.name),
      abilityStatus: abilities.length > 0 ? 'known' : 'missing',
      abilities,
      stats: {
        hp: stats.hp,
        attack: stats.attack,
        defense: stats.defense,
        'special-attack': stats['special-attack'],
        'special-defense': stats['special-defense'],
        speed: stats.speed
      },
      sprite: spriteValue
    },
    species,
    formRefs
  };
}

function normalizeSpecies(value: unknown, expected: ResourceRef): SpeciesResult {
  const path = `pokemon-species/${expected.id}`;
  const species = readRecord(value, path);
  const id = readPositiveInteger(species, 'id', path);
  const name = readString(species, 'name', path);
  if (id !== expected.id || name !== expected.name) throw new Error(`${path} identity does not match its variety reference`);

  const eggGroups = readArray(species, 'egg_groups', path).map((entry, index) =>
    resourceRef(entry, 'egg-group', `${path}.egg_groups[${index}]`).name
  ).sort();
  const pokedexes = readArray(species, 'pokedex_numbers', path).map((entry, index) => {
    const itemPath = `${path}.pokedex_numbers[${index}]`;
    const item = readRecord(entry, itemPath);
    return resourceRef(item.pokedex, 'pokedex', `${itemPath}.pokedex`).name;
  }).sort();
  const varieties = readArray(species, 'varieties', path).map((entry, index) => {
    const itemPath = `${path}.varieties[${index}]`;
    const item = readRecord(entry, itemPath);
    return {
      ref: resourceRef(item.pokemon, 'pokemon', `${itemPath}.pokemon`),
      isDefault: readBoolean(item, 'is_default', itemPath)
    };
  }).sort((a, b) => a.ref.id - b.ref.id);
  assertUnique(eggGroups, `${path}.egg_groups`);
  assertUnique(pokedexes, `${path}.pokedex_numbers`);
  assertUnique(varieties.map((entry) => entry.ref.id), `${path}.variety ids`);

  return {
    catalogSpecies: {
      id,
      name,
      isLegendary: readBoolean(species, 'is_legendary', path),
      isMythical: readBoolean(species, 'is_mythical', path),
      eggGroups,
      pokedexes,
      varietyNames: varieties.map((entry) => entry.ref.name)
    },
    varieties
  };
}

function normalizeForm(value: unknown, expected: ResourceRef): FormResult {
  const path = `pokemon-form/${expected.id}`;
  const form = readRecord(value, path);
  const id = readPositiveInteger(form, 'id', path);
  const name = readString(form, 'name', path);
  if (id !== expected.id || name !== expected.name) throw new Error(`${path} identity does not match its variety reference`);
  return {
    ref: { id, name },
    pokemon: resourceRef(form.pokemon, 'pokemon', `${path}.pokemon`),
    isDefault: readBoolean(form, 'is_default', path),
    isMega: readBoolean(form, 'is_mega', path),
    isBattleOnly: readBoolean(form, 'is_battle_only', path)
  };
}

function regulationDigest(): string {
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
  return sha256(canonicalJson(normalized));
}

async function fetchResource(endpoint: string, id: number): Promise<unknown> {
  return fetchJsonWithRetry(`${SOURCE_ROOT}/${endpoint}/${id}/index.json`);
}

async function generateCatalog(): Promise<PokemonCatalogV1> {
  console.log('Fetching authoritative Pokemon and species indexes');
  const indexedVarieties = readResourceIndex(
    await fetchJsonWithRetry(`${SOURCE_ROOT}/pokemon/index.json`),
    'pokemon'
  );
  const indexedSpecies = readResourceIndex(
    await fetchJsonWithRetry(`${SOURCE_ROOT}/pokemon-species/index.json`),
    'pokemon-species'
  );

  console.log(`Fetching 18 elemental types from PokeAPI/api-data@${SOURCE_REVISION}`);
  const typeResults = await mapBounded(ELEMENTAL_TYPES, CONCURRENCY, async (name, index) =>
    normalizeType(await fetchResource('type', index + 1), name, index + 1)
  );

  const varietyRefsById = new Map<number, ResourceRef>();
  const typeMembership = new Map<number, Set<string>>();
  typeResults.forEach(({ catalogType, varieties }) => varieties.forEach((ref) => {
    const existing = varietyRefsById.get(ref.id);
    if (existing && existing.name !== ref.name) throw new Error(`pokemon/${ref.id} has conflicting names in type resources`);
    varietyRefsById.set(ref.id, ref);
    const memberships = typeMembership.get(ref.id) ?? new Set<string>();
    if (memberships.has(catalogType.name)) throw new Error(`type/${catalogType.id} references pokemon/${ref.id} twice`);
    memberships.add(catalogType.name);
    typeMembership.set(ref.id, memberships);
  }));
  if (varietyRefsById.size !== indexedVarieties.length || indexedVarieties.some((ref) => {
    const typeRef = varietyRefsById.get(ref.id);
    return !typeRef || typeRef.name !== ref.name;
  })) throw new Error('elemental type resources do not cover the complete Pokemon index');
  const varietyRefs = indexedVarieties;
  console.log(`Fetching ${varietyRefs.length} varieties with concurrency ${CONCURRENCY}`);
  const varietySources = await mapBounded(varietyRefs, CONCURRENCY, async (ref) =>
    normalizeVariety(await fetchResource('pokemon', ref.id), ref)
  );

  varietySources.forEach(({ catalogVariety }) => {
    const expectedTypes = [...(typeMembership.get(catalogVariety.id) ?? [])].sort();
    const actualTypes = [...catalogVariety.types].sort();
    if (expectedTypes.join('\0') !== actualTypes.join('\0')) {
      throw new Error(`pokemon/${catalogVariety.id} types do not match the elemental type resources`);
    }
  });

  const speciesRefsById = new Map<number, ResourceRef>();
  varietySources.forEach(({ species }) => {
    const existing = speciesRefsById.get(species.id);
    if (existing && existing.name !== species.name) throw new Error(`pokemon-species/${species.id} has conflicting names`);
    speciesRefsById.set(species.id, species);
  });
  if (speciesRefsById.size !== indexedSpecies.length || indexedSpecies.some((ref) => {
    const varietyRef = speciesRefsById.get(ref.id);
    return !varietyRef || varietyRef.name !== ref.name;
  })) throw new Error('Pokemon resources do not cover the complete species index');
  const speciesRefs = indexedSpecies;
  console.log(`Fetching ${speciesRefs.length} species`);
  const speciesResults = await mapBounded(speciesRefs, CONCURRENCY, async (ref) =>
    normalizeSpecies(await fetchResource('pokemon-species', ref.id), ref)
  );

  const varietiesById = new Map(varietySources.map((entry) => [entry.catalogVariety.id, entry]));
  speciesResults.forEach(({ catalogSpecies, varieties }) => varieties.forEach(({ ref, isDefault }) => {
    const variety = varietiesById.get(ref.id)?.catalogVariety;
    if (!variety || variety.name !== ref.name || variety.speciesName !== catalogSpecies.name) {
      throw new Error(`pokemon-species/${catalogSpecies.id} references a variety absent from the type resources`);
    }
    if (variety.isDefault !== isDefault) {
      throw new Error(`pokemon-species/${catalogSpecies.id} disagrees with pokemon/${ref.id} about default status`);
    }
  }));
  const declaredVarietyIds = new Set(speciesResults.flatMap((entry) => entry.varieties.map(({ ref }) => ref.id)));
  if (declaredVarietyIds.size !== varietySources.length || varietySources.some(({ catalogVariety }) =>
    !declaredVarietyIds.has(catalogVariety.id)
  )) throw new Error('variety/species references do not form a complete closure');

  const nonDefaultVarieties = varietySources.filter(({ catalogVariety }) => !catalogVariety.isDefault);
  const formRefs = nonDefaultVarieties.flatMap((entry) => entry.formRefs);
  console.log(`Fetching ${formRefs.length} form records for ${nonDefaultVarieties.length} non-default varieties`);
  const forms = await mapBounded(formRefs, CONCURRENCY, async (ref) =>
    normalizeForm(await fetchResource('pokemon-form', ref.id), ref)
  );
  const formsById = new Map(forms.map((form) => [form.ref.id, form]));

  const varieties = varietySources.map(({ catalogVariety, formRefs: refs }): CatalogVarietyV1 => {
    if (catalogVariety.isDefault) return { ...catalogVariety, form: { isMega: false, isBattleOnly: false } };
    const linkedForms = refs.map((ref) => formsById.get(ref.id));
    if (linkedForms.some((form) => form === undefined)) throw new Error(`pokemon/${catalogVariety.id} is missing a form resource`);
    const completeForms = linkedForms as FormResult[];
    if (completeForms.some((form) => form.pokemon.id !== catalogVariety.id || form.pokemon.name !== catalogVariety.name)) {
      throw new Error(`pokemon/${catalogVariety.id} has a form linked to another variety`);
    }
    const form = completeForms[0];
    return { ...catalogVariety, form: { isMega: form.isMega, isBattleOnly: form.isBattleOnly } };
  });

  const types = typeResults.map((entry) => entry.catalogType).sort((a, b) => a.id - b.id);
  const species = speciesResults.map((entry) => entry.catalogSpecies).sort((a, b) => a.id - b.id);
  varieties.sort((a, b) => a.id - b.id);
  const contentHash = sha256(canonicalJson({ types, species, varieties }));
  const catalog: PokemonCatalogV1 = {
    manifest: {
      schemaVersion: POKEMON_CATALOG_SCHEMA_VERSION,
      source: {
        repository: 'https://github.com/PokeAPI/api-data',
        revision: SOURCE_REVISION,
        committedAt: SOURCE_COMMITTED_AT,
        license: 'BSD-3-Clause'
      },
      contentHash,
      regulationDigest: regulationDigest(),
      capabilityDigest: null,
      capabilityRulesVersion: null,
      counts: {
        types: types.length,
        species: species.length,
        varieties: varieties.length,
        varietiesMissingAbilities: varieties.filter((entry) => entry.abilityStatus === 'missing').length
      }
    },
    types,
    species,
    varieties
  };
  try {
    assertPokemonCatalog(catalog);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Normalized candidate has ${types.length} types, ${species.length} species, ${varieties.length} varieties, `
      + `content hash ${contentHash}\n${reason}`,
      { cause: error }
    );
  }
  return catalog;
}

async function writeAtomically(catalog: PokemonCatalogV1): Promise<number> {
  const serialized = `${JSON.stringify(catalog, null, 2)}\n`;
  const temporaryPath = `${OUTPUT_PATH}.${process.pid}.tmp`;
  await mkdir(fileURLToPath(new URL('../data/', import.meta.url)), { recursive: true });
  try {
    await writeFile(temporaryPath, serialized, { encoding: 'utf8', flag: 'wx' });
    await rename(temporaryPath, OUTPUT_PATH);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
  return (await stat(OUTPUT_PATH)).size;
}

try {
  const catalog = await generateCatalog();
  const size = await writeAtomically(catalog);
  console.log(
    `Wrote ${OUTPUT_PATH.slice(REPOSITORY_ROOT.length)}: `
    + `${catalog.manifest.counts.types} types, ${catalog.manifest.counts.species} species, `
    + `${catalog.manifest.counts.varieties} varieties, ${size} bytes, ${catalog.manifest.contentHash}`
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
