import { canonicalJson } from './canonicalJson';
import type { PokemonStats } from './pokedexTypes';

export const POKEMON_CATALOG_SCHEMA_VERSION = 1 as const;
export const POKEMON_CATALOG_CONTENT_HASH =
  'ab1cd34ca0fc4fd13481ea610dbb7ddb4bdd890dbe21525c556dffebe41ee1f0' as const;
export const POKEMON_CATALOG_REGULATION_DIGEST =
  'd7526351fb644511b27bc142e2e6a43f045a7fd2580ce2f9e28ec3fb21e7e09d' as const;
/**
 * Bump whenever scan rules change without changing catalog or regulation data.
 *
 * 2: threat weighting. `damage_from_score` is now scaled by how much of the
 * regulation's pool can attack with each type, so every cached score predates a
 * different formula and normalizes against a different range.
 *
 * 3: IMMUNITY_VALUE. A true immunity scores -4 rather than -1, which moves both
 * the scores and the range they normalize against.
 *
 * 4: the coverage-slot rule. A move type only counts as a threat beyond STAB if
 * something is weak to it, which re-prices every threat weight against a new
 * maximum.
 *
 * 5: IMMUNITY_VALUE corrected from -4 to -2, a unit error in its derivation.
 *
 * 6: maxDamageFromScore off by default, so a scan returns every typing.
 *
 * 7: coverage slots allocated by what they buy rather than evenly, which
 * re-prices every threat weight and moves the maximum from Dark to Fighting.
 *
 * 8: the threat pool is the game's roster rather than the National Dex. No
 * effect on a scan under a regulation, where the two already agree; an
 * unregulated scan was weighting against 817 species that have no movepool
 * because they are not in the game, and its cached scores are not recoverable.
 *
 * 9: `damage_to_score` is measured against the typings the regulation fields
 * rather than counted off the chart, so every cached offensive score predates a
 * different formula and a different range.
 *
 * 10: firepower. Member quality gained a third factor on its offence axis — how
 * hard the best STAB move actually hits — and that factor reaches the default
 * ability choice, because an ability moving an attacking stat can flip which
 * damage class the Pokemon reads its best move from. So `selected_ability_name`
 * and everything derived from it can differ from what a cache holds.
 *
 * 15: the speed/bulk transfer and the split type modulation. `MEMBER_WEIGHTS`
 * moved to 0.35 / 0.57 / 0.08 and `TYPE_MODULATION` became 0.4 offensive / 0.7
 * defensive, which changes what `scoreMemberQuality` returns — and
 * `chooseDefaultAbility` picks the default ability by comparing profiles through
 * exactly that function. A deeper defensive modulation raises what a resistance
 * or immunity is worth relative to the stats an ability moves, so an entry
 * cached under the old weights can hold a `selected_ability_name` the current
 * model would not choose, along with every `effective_*` field derived from it.
 *
 * 14: pool-relative typing bounds. Both damage scores are normalized against
 * the range the Pokemon a regulation can field actually reach, rather than
 * against every typing × ability profile the game can express. A cached entry
 * holds `normalized` scores computed against the old wider range, and the
 * default ability choice reaches them too — `chooseDefaultAbility` compares
 * profiles through `scoreMemberQuality`, so a different scale can pick a
 * different ability.
 *
 * 13: Prankster. It is priced through the support roles it makes reliable
 * rather than as a stat multiplier, and `chooseDefaultAbility` now sees that —
 * Meowstic was selecting Keen Eye over the ability it is played for, so cached
 * `selected_ability_name` can differ.
 *
 * 12: weather abusers. Sand Rush, Swift Swim, Chlorophyll, Slush Rush and Sand
 * Force became support roles, which reaches `chooseDefaultAbility` through its
 * ability-role bonus. Eight varieties now default to a different ability —
 * Excadrill to Sand Rush, Venusaur to Chlorophyll — so cached
 * `selected_ability_name` and everything derived from it can differ.
 *
 * 11: Palafin is rated on the form it registers as. `battleForms.ts` gained a
 * fourth condition — reaching the form must cost no turn — which empties the
 * merge whitelist, so cached entries hold Hero's stats for a Pokemon now scored
 * on Zero's. The stats themselves changed, not just a score derived from them.
 */
export const POKEMON_SCAN_ENGINE_CACHE_VERSION = 15 as const;
export const POKEMON_SCAN_CACHE_REVISION =
  `scan-${POKEMON_SCAN_ENGINE_CACHE_VERSION}_${POKEMON_CATALOG_CONTENT_HASH}_${POKEMON_CATALOG_REGULATION_DIGEST}` as const;
export const ELEMENTAL_TYPES = [
  'normal', 'fighting', 'flying', 'poison', 'ground', 'rock', 'bug', 'ghost', 'steel',
  'fire', 'water', 'grass', 'electric', 'psychic', 'ice', 'dragon', 'dark', 'fairy'
] as const;

export interface PokemonCatalogManifestV1 {
  readonly schemaVersion: typeof POKEMON_CATALOG_SCHEMA_VERSION;
  readonly source: {
    readonly repository: 'https://github.com/PokeAPI/api-data';
    readonly revision: string;
    readonly committedAt: string;
    readonly license: 'BSD-3-Clause';
  };
  readonly contentHash: string;
  readonly regulationDigest: string;
  readonly capabilityDigest: null;
  readonly capabilityRulesVersion: null;
  readonly counts: {
    readonly types: number;
    readonly species: number;
    readonly varieties: number;
    readonly varietiesMissingAbilities: number;
  };
}

export interface CatalogTypeV1 {
  readonly id: number;
  readonly name: string;
  readonly damageRelations: {
    readonly doubleDamageFrom: readonly string[];
    readonly halfDamageFrom: readonly string[];
    readonly noDamageFrom: readonly string[];
    readonly doubleDamageTo: readonly string[];
    readonly halfDamageTo: readonly string[];
    readonly noDamageTo: readonly string[];
  };
}

export interface CatalogSpeciesV1 {
  readonly id: number;
  readonly name: string;
  readonly isLegendary: boolean;
  readonly isMythical: boolean;
  readonly eggGroups: readonly string[];
  readonly pokedexes: readonly string[];
  readonly varietyNames: readonly string[];
}

export interface CatalogVarietyV1 {
  readonly id: number;
  readonly name: string;
  readonly speciesName: string;
  readonly isDefault: boolean;
  readonly types: readonly string[];
  /** Distinguishes incomplete upstream data from a genuine empty ability list. */
  readonly abilityStatus: 'known' | 'missing';
  readonly abilities: readonly {
    readonly slot: number;
    readonly name: string;
    readonly isHidden: boolean;
  }[];
  readonly stats: PokemonStats;
  readonly sprite: string | null;
  readonly form: {
    readonly isMega: boolean;
    readonly isBattleOnly: boolean;
  };
}

export interface PokemonCatalogV1 {
  readonly manifest: PokemonCatalogManifestV1;
  readonly types: readonly CatalogTypeV1[];
  readonly species: readonly CatalogSpeciesV1[];
  readonly varieties: readonly CatalogVarietyV1[];
}

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry.length > 0);
const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;
const hasUnique = <T>(values: readonly T[]): boolean => new Set(values).size === values.length;

const isStats = (value: unknown): value is PokemonStats => {
  if (!isRecord(value)) return false;
  return ['hp', 'attack', 'defense', 'special-attack', 'special-defense', 'speed'].every((key) =>
    typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key] > 0
  );
};

/**
 * Validates both the catalog wire shape and the joins the scan will rely on.
 * Hash verification remains a loader concern because this module is browser-safe.
 */
export function validatePokemonCatalog(value: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(value) || !isRecord(value.manifest)) return ['catalog root or manifest is not an object'];
  if (!Array.isArray(value.types) || !Array.isArray(value.species) || !Array.isArray(value.varieties)) {
    return ['catalog collections must be arrays'];
  }

  const manifest = value.manifest;
  if (manifest.schemaVersion !== POKEMON_CATALOG_SCHEMA_VERSION) issues.push('unsupported schema version');
  if (!isRecord(manifest.source)) {
    issues.push('invalid source provenance');
  } else {
    if (manifest.source.repository !== 'https://github.com/PokeAPI/api-data') issues.push('invalid source repository');
    if (typeof manifest.source.revision !== 'string' || !/^[0-9a-f]{40}$/.test(manifest.source.revision)) {
      issues.push('invalid source revision');
    }
    if (typeof manifest.source.committedAt !== 'string' ||
      !Number.isFinite(Date.parse(manifest.source.committedAt))) issues.push('invalid source commit timestamp');
    if (manifest.source.license !== 'BSD-3-Clause') issues.push('invalid source license');
  }
  if (manifest.capabilityDigest !== null || manifest.capabilityRulesVersion !== null) {
    issues.push('phase-one catalog must not claim capability data');
  }
  if (typeof manifest.contentHash !== 'string' || !/^[0-9a-f]{64}$/.test(manifest.contentHash)) {
    issues.push('invalid content hash');
  }
  if (typeof manifest.regulationDigest !== 'string' || !/^[0-9a-f]{64}$/.test(manifest.regulationDigest)) {
    issues.push('invalid regulation digest');
  }

  const types = value.types as unknown[];
  types.forEach((entry, index) => {
    if (!isRecord(entry) || !isPositiveInteger(entry.id) || typeof entry.name !== 'string') {
      issues.push(`types[${index}] has an invalid shape`);
      return;
    }
    const damageRelations = entry.damageRelations;
    if (!isRecord(damageRelations)) {
      issues.push(`types[${index}] has an invalid shape`);
      return;
    }
    const relationFields = [
      'doubleDamageFrom', 'halfDamageFrom', 'noDamageFrom',
      'doubleDamageTo', 'halfDamageTo', 'noDamageTo'
    ];
    relationFields.forEach((field) => {
      if (!isStringArray(damageRelations[field])) {
        issues.push(`type ${entry.name} has invalid damage relations`);
      }
    });
  });

  const species = value.species as unknown[];
  species.forEach((entry, index) => {
    if (!isRecord(entry) || !isPositiveInteger(entry.id) || typeof entry.name !== 'string' ||
      typeof entry.isLegendary !== 'boolean' || typeof entry.isMythical !== 'boolean' ||
      !isStringArray(entry.eggGroups) || !isStringArray(entry.pokedexes) || !isStringArray(entry.varietyNames)) {
      issues.push(`species[${index}] has an invalid shape`);
    }
  });

  const varieties = value.varieties as unknown[];
  varieties.forEach((entry, index) => {
    if (!isRecord(entry) || !isPositiveInteger(entry.id) || typeof entry.name !== 'string' ||
      typeof entry.speciesName !== 'string' || typeof entry.isDefault !== 'boolean' ||
      !isStringArray(entry.types) || !Array.isArray(entry.abilities) || !isStats(entry.stats) ||
      !(entry.abilityStatus === 'known' || entry.abilityStatus === 'missing') ||
      !(typeof entry.sprite === 'string' || entry.sprite === null) || !isRecord(entry.form) ||
      typeof entry.form.isMega !== 'boolean' || typeof entry.form.isBattleOnly !== 'boolean') {
      issues.push(`varieties[${index}] has an invalid shape`);
      return;
    }
    if (!entry.abilities.every((ability) => isRecord(ability) && isPositiveInteger(ability.slot) &&
      typeof ability.name === 'string' && typeof ability.isHidden === 'boolean')) {
      issues.push(`variety ${entry.name} has invalid abilities`);
    }
  });

  if (issues.length > 0) return issues;

  const catalog = value as unknown as PokemonCatalogV1;
  const expectedTypes = new Set(ELEMENTAL_TYPES);
  const expectedTypeIds = new Map<string, number>(
    ELEMENTAL_TYPES.map((name, index) => [name, index + 1])
  );
  const typeNames = catalog.types.map((entry) => entry.name);
  if (catalog.types.length !== ELEMENTAL_TYPES.length || !hasUnique(typeNames) ||
    typeNames.some((name) => !expectedTypes.has(name as typeof ELEMENTAL_TYPES[number]))) {
    issues.push('catalog must contain each elemental type exactly once');
  }
  if (catalog.types.some((entry) => expectedTypeIds.get(entry.name) !== entry.id)) {
    issues.push('catalog elemental type ids do not match canonical PokeAPI ids');
  }
  catalog.types.forEach((entry) => {
    Object.values(entry.damageRelations).flat().forEach((name) => {
      if (!expectedTypes.has(name as typeof ELEMENTAL_TYPES[number])) {
        issues.push(`type ${entry.name} references unknown type ${name}`);
      }
    });
  });

  const speciesIds = catalog.species.map((entry) => entry.id);
  const speciesNames = catalog.species.map((entry) => entry.name);
  const varietyIds = catalog.varieties.map((entry) => entry.id);
  const varietyNames = catalog.varieties.map((entry) => entry.name);
  if (!hasUnique(speciesIds) || !hasUnique(speciesNames)) issues.push('species ids and names must be unique');
  if (!hasUnique(varietyIds) || !hasUnique(varietyNames)) issues.push('variety ids and names must be unique');

  const speciesByName = new Map(catalog.species.map((entry) => [entry.name, entry]));
  const varietyByName = new Map(catalog.varieties.map((entry) => [entry.name, entry]));
  catalog.varieties.forEach((entry) => {
    if (!speciesByName.has(entry.speciesName)) issues.push(`variety ${entry.name} references missing species`);
    if (entry.types.length < 1 || entry.types.length > 2 || entry.types.some((name) => !expectedTypes.has(
      name as typeof ELEMENTAL_TYPES[number]
    ))) issues.push(`variety ${entry.name} has invalid types`);
    if (!hasUnique(entry.types)) issues.push(`variety ${entry.name} must have unique types`);
    if (!hasUnique(entry.abilities.map((ability) => ability.slot))) {
      issues.push(`variety ${entry.name} must have uniquely slotted abilities`);
    }
    if ((entry.abilityStatus === 'known' && entry.abilities.length === 0) ||
      (entry.abilityStatus === 'missing' && entry.abilities.length > 0)) {
      issues.push(`variety ${entry.name} ability status does not match its ability data`);
    }
    if (entry.isDefault && (entry.form.isMega || entry.form.isBattleOnly)) {
      issues.push(`default variety ${entry.name} cannot be Mega or battle-only`);
    }
  });

  catalog.species.forEach((entry) => {
    const linked = catalog.varieties.filter((variety) => variety.speciesName === entry.name);
    const declared = [...entry.varietyNames].sort();
    const actual = linked.map((variety) => variety.name).sort();
    if (!hasUnique(entry.varietyNames) || declared.join('\0') !== actual.join('\0')) {
      issues.push(`species ${entry.name} variety list does not match catalog joins`);
    }
    if (linked.filter((variety) => variety.isDefault).length !== 1) {
      issues.push(`species ${entry.name} must have exactly one default variety`);
    }
    entry.varietyNames.forEach((name) => {
      if (!varietyByName.has(name)) issues.push(`species ${entry.name} references missing variety ${name}`);
    });
  });

  if (!isRecord(manifest.counts) || manifest.counts.types !== catalog.types.length ||
    manifest.counts.species !== catalog.species.length || manifest.counts.varieties !== catalog.varieties.length ||
    manifest.counts.varietiesMissingAbilities !== catalog.varieties.filter(
      (entry) => entry.abilityStatus === 'missing'
    ).length) {
    issues.push('manifest counts do not match catalog collections');
  }

  return [...new Set(issues)];
}

export function assertPokemonCatalog(value: unknown): asserts value is PokemonCatalogV1 {
  const issues = validatePokemonCatalog(value);
  if (issues.length > 0) throw new Error(`Invalid Pokemon catalog:\n- ${issues.join('\n- ')}`);
}

/** Validates catalog semantics and verifies the manifest's content hash. */
export async function parseAndVerifyPokemonCatalog(value: unknown): Promise<PokemonCatalogV1> {
  assertPokemonCatalog(value);
  if (value.manifest.contentHash !== POKEMON_CATALOG_CONTENT_HASH ||
    value.manifest.regulationDigest !== POKEMON_CATALOG_REGULATION_DIGEST) {
    throw new Error('Pokemon catalog revision does not match the runtime scan contract');
  }
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Pokemon catalog integrity verification requires Web Crypto');

  const payload = canonicalJson({
    types: value.types,
    species: value.species,
    varieties: value.varieties
  });
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(payload));
  const actualHash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  if (actualHash !== value.manifest.contentHash) {
    throw new Error(
      `Pokemon catalog content hash mismatch: expected ${value.manifest.contentHash}, received ${actualHash}`
    );
  }
  return value;
}
