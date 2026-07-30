import { getMergedBattleForm, sharesTyping } from './battleForms';
import { enrichPokemon } from './pokemonEnrichment';
import { calculateDamageFromScore, calculateDamageToScore } from './pokedexScoring';
import type { OffensiveTypeChart } from './coverageMoves';
import type {
  CatalogTypeV1,
  CatalogVarietyV1,
  PokemonCatalogV1
} from './pokemonCatalog';
import type { PokemonEnrichmentFacts, PokemonEnrichmentOptions } from './pokemonEnrichment';
import type { DamageRelations, NamedResource, PokemonListEntry, PokemonTypeData } from './pokedexTypes';

const resources = (names: readonly string[]): NamedResource[] => names.map((name) => ({ name }));

/** Converts a normalized catalog type into the scan engine's base-type shape. */
export function catalogTypeToPokemonType(
  type: CatalogTypeV1,
  catalog: PokemonCatalogV1,
  baseScore: number
): PokemonTypeData {
  const damageRelations: DamageRelations = {
    double_damage_from: resources(type.damageRelations.doubleDamageFrom),
    half_damage_from: resources(type.damageRelations.halfDamageFrom),
    no_damage_from: resources(type.damageRelations.noDamageFrom),
    double_damage_to: resources(type.damageRelations.doubleDamageTo),
    half_damage_to: resources(type.damageRelations.halfDamageTo),
    no_damage_to: resources(type.damageRelations.noDamageTo)
  };
  damageRelations.damage_from_score = calculateDamageFromScore(damageRelations, baseScore);
  damageRelations.damage_to_score = calculateDamageToScore(damageRelations, baseScore);

  return {
    id: type.id,
    name: type.name,
    damage_relations: damageRelations,
    pokemon: catalog.varieties
      .filter((variety) => variety.types.includes(type.name))
      .map((variety) => ({
        pokemon: {
          name: variety.name,
          url: `https://pokeapi.co/api/v2/pokemon/${variety.id}/`
        }
      }))
  };
}

/** Builds the standard base types from a validated catalog without network access. */
export function getCatalogBaseTypes(
  catalog: PokemonCatalogV1,
  baseScore: number
): PokemonTypeData[] {
  return catalog.types
    .filter((type) => type.id <= baseScore)
    .map((type) => catalogTypeToPokemonType(type, catalog, baseScore));
}

const toFacts = (
  catalog: PokemonCatalogV1,
  variety: CatalogVarietyV1
): PokemonEnrichmentFacts => {
  const species = catalog.species.find((entry) => entry.name === variety.speciesName);
  if (!species) throw new Error(`Catalog variety ${variety.name} references missing species ${variety.speciesName}`);

  const abilityNames = variety.abilities.map((ability) => ability.name);
  const battleRule = getMergedBattleForm(species.name, abilityNames);
  const battleVariety = battleRule
    ? catalog.varieties.find((entry) => entry.name === battleRule.variety)
    : undefined;
  const useBattleVariety = battleVariety && sharesTyping(variety.types, battleVariety.types);

  return {
    id: variety.id,
    name: variety.name,
    url: `https://pokeapi.co/api/v2/pokemon/${variety.id}/`,
    speciesName: species.name,
    isDefault: variety.isDefault,
    types: variety.types.map((name) => ({ type: { name } })),
    sprite: variety.sprite,
    abilities: variety.abilities.map((ability) => ({
      name: ability.name,
      is_hidden: ability.isHidden
    })),
    stats: useBattleVariety ? battleVariety.stats : variety.stats,
    battleFormName: useBattleVariety ? battleRule?.variety : undefined,
    isLegendary: species.isLegendary,
    isMythical: species.isMythical,
    eggGroups: species.eggGroups,
    pokedexes: species.pokedexes,
    form: variety.form
  };
};

/** Joins one catalog variety to its species and enriches it with the shared scan rules. */
export function enrichCatalogVariety(
  catalog: PokemonCatalogV1,
  variety: CatalogVarietyV1,
  type: PokemonTypeData,
  offensiveChart: OffensiveTypeChart,
  options: PokemonEnrichmentOptions
): PokemonListEntry | null {
  return enrichPokemon(toFacts(catalog, variety), type, offensiveChart, options);
}
