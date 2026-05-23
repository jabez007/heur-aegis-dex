//https://pokeapi.co/
import Pokedex from 'pokedex-promise-v2';
import 'lodash.combinations';
import _ from 'lodash';
import { applyAbilityModifiers, createRawAbilityProfile } from './pokedexAbilities';
import {
  calculateDamageFromScore,
  calculateDamageToScore,
  cloneDamageRelations,
  createTypeSummary,
  filterUniqueBy
} from './pokedexScoring';
import type {
  DamageRelations,
  NamedResource,
  PokemonAbilitySlot,
  PokemonListEntry,
  PokemonStats,
  PokemonTypeData,
  ResistantTypeResult
} from './pokedexTypes';

const _lodash = _ as any;
const BASESCORE = 18;
const POKEMON_DETAIL_CONCURRENCY = 12;

const pokemonResourceCache = new Map<number, Promise<any>>();
const pokemonSpeciesCache = new Map<number, Promise<any>>();

export const pokedex = new Pokedex({
  protocol: 'https',
  timeout: 1000 * 20,
  cacheLimit: 1000 * 60 * 60 * 24 * 7
});

export type { NamedResource, DamageRelations, PokemonTypeData } from './pokedexTypes';
export { generateTeams } from './teamGeneration';

export function __resetPokedexResourceCaches() {
  pokemonResourceCache.clear();
  pokemonSpeciesCache.clear();
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];

  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function getPokemonIdFromUrl(url: string): number {
  return Number(url.split('/').slice(-2)[0]);
}

function fetchPokemonResource(id: number) {
  const cached = pokemonResourceCache.get(id);
  if (cached) return cached;

  const request = pokedex.getResource(`/api/v2/pokemon/${id}/`).catch((error) => {
    pokemonResourceCache.delete(id);
    throw error;
  });
  pokemonResourceCache.set(id, request);
  return request;
}

function fetchPokemonSpeciesResource(id: number) {
  const cached = pokemonSpeciesCache.get(id);
  if (cached) return cached;

  const request = pokedex.getResource(`/api/v2/pokemon-species/${id}/`).catch((error) => {
    pokemonSpeciesCache.delete(id);
    throw error;
  });
  pokemonSpeciesCache.set(id, request);
  return request;
}

function clonePokemonEntry(entry: PokemonListEntry): PokemonListEntry {
  const abilityProfiles = entry.ability_profiles
    ? Object.fromEntries(
        Object.entries(entry.ability_profiles).map(([abilityName, profile]) => [
          abilityName,
          {
            ...profile,
            damage_relations: profile.damage_relations ? cloneDamageRelations(profile.damage_relations) : undefined,
            weaknesses: [...(profile.weaknesses || [])],
            quadruple_weaknesses: [...(profile.quadruple_weaknesses || [])],
            resistances: [...(profile.resistances || [])],
            ineffectives: [...(profile.ineffectives || [])],
            coverages: [...(profile.coverages || [])]
          }
        ])
      )
    : undefined;

  return {
    ...entry,
    pokemon: { ...entry.pokemon },
    types: entry.types ? entry.types.map((typeSlot) => ({ ...typeSlot, type: { ...typeSlot.type } })) : undefined,
    abilities: entry.abilities ? entry.abilities.map((ability) => ({ ...ability })) : undefined,
    stats: entry.stats ? { ...entry.stats } : undefined,
    ability_profiles: abilityProfiles,
    effective_damage_relations: entry.effective_damage_relations ? cloneDamageRelations(entry.effective_damage_relations) : undefined,
    effective_weaknesses: [...(entry.effective_weaknesses || [])],
    effective_quadruple_weaknesses: [...(entry.effective_quadruple_weaknesses || [])],
    effective_resistances: [...(entry.effective_resistances || [])],
    effective_ineffectives: [...(entry.effective_ineffectives || [])],
    effective_coverages: [...(entry.effective_coverages || [])]
  };
}

export async function getBaseTypes(baseScore: number = BASESCORE): Promise<PokemonTypeData[]> {
  const types: PokemonTypeData[] = await Promise.all(
    (await pokedex.getResource('/api/v2/type/')).results
      .map((type: NamedResource) => pokedex.getResource(`/api/v2/type/${type.name}/`))
  );

  return types
    .filter(t => (t.id || 0) <= baseScore)
    .map(t => {
      t.damage_relations.damage_from_score = calculateDamageFromScore(t.damage_relations, baseScore);
      t.damage_relations.damage_to_score = calculateDamageToScore(t.damage_relations, baseScore);
      return t;
    });
}

export async function getDualTypes(baseScore: number = BASESCORE): Promise<PokemonTypeData[]> {
  const baseTypes = await getBaseTypes(baseScore);

  return _lodash.combinations(baseTypes, 2)
    .map((dt: PokemonTypeData[]) => {
      const dr0 = dt[0].damage_relations;
      const dr1 = dt[1].damage_relations;

      const dualType: PokemonTypeData = {
        name: `${dt[0].name}/${dt[1].name}`,
        damage_relations: {
          quadruple_damage_from: dr0.double_damage_from
            .filter(dt0_ddf => dr1.double_damage_from.some(dt1_ddf => dt0_ddf.name === dt1_ddf.name)),

          double_damage_from: filterUniqueBy(dr0.double_damage_from.concat(dr1.double_damage_from))
            .filter(ddf =>
              (dr0.double_damage_from.every(dt0_ddf => ddf.name !== dt0_ddf.name) ||
                dr1.double_damage_from.every(dt1_ddf => ddf.name !== dt1_ddf.name))
              &&
              (dr0.half_damage_from.every(dt0_hdf => ddf.name !== dt0_hdf.name) &&
                dr1.half_damage_from.every(dt1_hdf => ddf.name !== dt1_hdf.name) &&
                dr0.no_damage_from.every(dt0_ndf => ddf.name !== dt0_ndf.name) &&
                dr1.no_damage_from.every(dt1_ndf => ddf.name !== dt1_ndf.name))
            ),

          double_damage_to: filterUniqueBy(dr0.double_damage_to.concat(dr1.double_damage_to)),

          half_damage_from: filterUniqueBy(dr0.half_damage_from.concat(dr1.half_damage_from))
            .filter(hdf =>
              (dr0.half_damage_from.every(dt0_hdf => hdf.name !== dt0_hdf.name) ||
                dr1.half_damage_from.every(dt1_hdf => hdf.name !== dt1_hdf.name))
              &&
              (dr0.double_damage_from.every(dt0_ddf => hdf.name !== dt0_ddf.name) &&
                dr1.double_damage_from.every(dt1_ddf => hdf.name !== dt1_ddf.name) &&
                dr0.no_damage_from.every(dt0_ndf => hdf.name !== dt0_ndf.name) &&
                dr1.no_damage_from.every(dt1_ndf => hdf.name !== dt1_ndf.name))
            ),

          half_damage_to: dr0.half_damage_to
            .filter(dt0_hdt =>
              dr1.half_damage_to.some(dt1_hdt => dt0_hdt.name === dt1_hdt.name) ||
              dr1.no_damage_to.some(dt1_ndt => dt0_hdt.name === dt1_ndt.name)
            )
            .concat(dr1.half_damage_to.filter(dt1_hdt =>
              dr0.no_damage_to.some(dt0_ndt => dt1_hdt.name === dt0_ndt.name)
            )),

          quarter_damage_from: dr0.half_damage_from
            .filter(dt0_hdf => dr1.half_damage_from.some(dt1_hdf => dt0_hdf.name === dt1_hdf.name)),

          no_damage_from: filterUniqueBy(dr0.no_damage_from.concat(dr1.no_damage_from)),

          no_damage_to: dr0.no_damage_to
            .filter(dt0_ndt => dr1.no_damage_to.some(dt1_ndt => dt0_ndt.name === dt1_ndt.name))
        },
        pokemon: (dt[0].pokemon || [])
          .filter((dt0_p: any) =>
            (dt[1].pokemon || []).some((dt1_p: any) => dt0_p.pokemon.name === dt1_p.pokemon.name)
          )
          .map((pokemonEntry: PokemonListEntry) => clonePokemonEntry(pokemonEntry))
      };

      dualType.damage_relations.damage_from_score = calculateDamageFromScore(dualType.damage_relations, baseScore);
      dualType.damage_relations.damage_to_score = calculateDamageToScore(dualType.damage_relations, baseScore);

      return dualType;
    });
}

export async function getResistantTypes(options: {
  baseScore?: number;
  typeFilters?: {
    maxDamageFromScore?: boolean;
    allowQuadrupleDamage?: boolean;
    limitQuadrupleDamage?: boolean;
  };
  pokemonFilters?: {
    inPokedex?: string;
    allowMegas?: boolean;
    includeAbilityImmunities?: boolean;
  };
  statsFilters?: {
    minimumStatsTotal?: number;
    minimumAttacks?: number;
    minimumDefenses?: number;
  };
} = {}): Promise<ResistantTypeResult[]> {
  const {
    baseScore = BASESCORE,
    typeFilters = { maxDamageFromScore: true, allowQuadrupleDamage: true, limitQuadrupleDamage: true },
    pokemonFilters = { inPokedex: 'national', allowMegas: false, includeAbilityImmunities: true },
    statsFilters = { minimumStatsTotal: 500, minimumAttacks: 90, minimumDefenses: 80 }
  } = options;

  const _typeFilters = { maxDamageFromScore: true, allowQuadrupleDamage: true, limitQuadrupleDamage: true, ...typeFilters };
  const _pokemonFilters = { inPokedex: 'national', allowMegas: false, includeAbilityImmunities: true, ...pokemonFilters };
  const _statsFilters = { minimumStatsTotal: 480, minimumAttacks: 80, minimumDefenses: 80, ...statsFilters };

  const pokedexMaps: Record<string, string[]> = {
    national: ['national'],
    kanto: ['letsgo-kanto'],
    galar: ['galar', 'isle-of-armor', 'crown-tundra'],
    sinnoh: ['sinnoh'],
    hisui: ['hisui'],
    paldea: ['paldea', 'kitakami', 'blueberry']
  };

  const isBreedable = (species: any, pokeName: string) => {
    if (species.is_legendary || species.is_mythical) return false;
    if (species.egg_groups.length > 0 && species.egg_groups.every((eg: any) => eg.name === 'no-eggs')) return false;
    const paradoxPokemon = ['koraidon', 'miraidon', 'roaring-moon', 'iron-valiant', 'great-tusk', 'brute-bonnet', 'sandy-shocks', 'scream-tail', 'flutter-mane', 'slither-wing', 'iron-treads', 'iron-moth', 'iron-hands', 'iron-jugulis', 'iron-thorns', 'iron-bundle', 'ting-lu', 'chien-pao', 'wo-chien', 'chi-yu', 'gholdengo'];
    if (paradoxPokemon.includes(pokeName)) return false;
    return true;
  };

  const processPokemon = async (t: PokemonTypeData): Promise<PokemonListEntry[]> => {
    const pokemon = await Promise.all(
      (t.pokemon || []).map(async (p: PokemonListEntry) => {
        if (!_pokemonFilters.allowMegas && p.pokemon.name.includes('-mega')) return null;

        if (!p.pokemon.url) return null;
        const id = getPokemonIdFromUrl(p.pokemon.url);
        const poke = await fetchPokemonResource(id);
        const speciesId = getPokemonIdFromUrl(poke.species.url);
        const species = await fetchPokemonSpeciesResource(speciesId);

        if (!isBreedable(species, p.pokemon.name)) return null;

        if (!species.pokedex_numbers.some((pn: any) =>
          (pokedexMaps[_pokemonFilters.inPokedex] || []).some((pm: any) => pn.pokedex.name.includes(pm))
        )) {
          return null;
        }

        p.types = poke.types;
        p.sprite = poke.sprites.front_default;
        p.abilities = poke.abilities.map((abilityEntry: any): PokemonAbilitySlot => ({
          name: abilityEntry.ability.name,
          is_hidden: abilityEntry.is_hidden
        }));
        const stats = poke.stats.reduce((merged: PokemonStats, curr: any) => {
          merged[curr.stat.name] = curr.base_stat;
          return merged;
        }, {
          hp: 0,
          attack: 0,
          defense: 0,
          'special-attack': 0,
          'special-defense': 0,
          speed: 0
        });
        p.stats = stats;

        if (stats.attack < _statsFilters.minimumAttacks && stats['special-attack'] < _statsFilters.minimumAttacks) return null;
        if ((stats.defense + stats['special-defense']) / 2 < _statsFilters.minimumDefenses) return null;

        const statsTotal = poke.stats.reduce((total: number, curr: any) => total + curr.base_stat, 0);
        p.stats_total = statsTotal;
        if (statsTotal < _statsFilters.minimumStatsTotal) return null;

        const baseDamageRelations = cloneDamageRelations(t.damage_relations);
        const abilityNames = (p.abilities || []).map((ability) => ability.name);
        const { abilityProfiles, bestProfile } = _pokemonFilters.includeAbilityImmunities
          ? applyAbilityModifiers(baseDamageRelations, abilityNames, baseScore)
          : {
            abilityProfiles: abilityNames.length > 0
              ? abilityNames.map((abilityName: string) => createRawAbilityProfile(baseDamageRelations, abilityName, baseScore))
              : [createRawAbilityProfile(baseDamageRelations, '', baseScore)],
            bestProfile: abilityNames.length > 0
              ? createRawAbilityProfile(baseDamageRelations, abilityNames[0], baseScore)
              : createRawAbilityProfile(baseDamageRelations, '', baseScore)
          };

        p.ability_profiles = Object.fromEntries(abilityProfiles.map((profile) => [profile.ability_name || '', profile]));
        p.selected_ability_name = bestProfile.ability_name;
        p.effective_damage_relations = bestProfile.damage_relations;
        p.effective_weaknesses = bestProfile.weaknesses;
        p.effective_quadruple_weaknesses = bestProfile.quadruple_weaknesses;
        p.effective_resistances = bestProfile.resistances;
        p.effective_ineffectives = bestProfile.ineffectives;
        p.effective_coverages = bestProfile.coverages;
        p.effective_damage_from_score = bestProfile.damage_from_score;
        p.effective_damage_to_score = bestProfile.damage_to_score;

        return p;
      })
    );

    return pokemon
      .filter((p): p is PokemonListEntry => p !== null)
      .filter((p) => t.name.includes('/') || (p.types?.length || 0) === 1)
      .sort((p1, p2) => (p2.stats_total || 0) - (p1.stats_total || 0));
  };

  const baseAndDualTypes = (await getBaseTypes(baseScore)).concat(await getDualTypes(baseScore));

  const uniquePokemonEntries = Array.from(
    new Map(
      baseAndDualTypes
        .flatMap((typeData) => typeData.pokemon || [])
        .filter((pokemonEntry): pokemonEntry is PokemonListEntry => !!pokemonEntry.pokemon?.url)
        .map((pokemonEntry) => [pokemonEntry.pokemon.url as string, pokemonEntry])
    ).values()
  );

  await mapWithConcurrency(uniquePokemonEntries, POKEMON_DETAIL_CONCURRENCY, async (pokemonEntry) => {
    const id = getPokemonIdFromUrl(pokemonEntry.pokemon.url!);
    const poke = await fetchPokemonResource(id);
    const speciesId = getPokemonIdFromUrl(poke.species.url);
    await fetchPokemonSpeciesResource(speciesId);
  });

  return (await Promise.all(
    baseAndDualTypes
      .filter((t: PokemonTypeData) => {
        const meetsScoreFilter = !_typeFilters.maxDamageFromScore || (t.damage_relations.damage_from_score || 0) <= baseScore;

        let meetsQuadFilter = true;
        if (_typeFilters.allowQuadrupleDamage) {
          if (_typeFilters.limitQuadrupleDamage) {
            const quadLen = (t.damage_relations.quadruple_damage_from || []).length;
            const doubleLen = t.damage_relations.double_damage_from.length;
            meetsQuadFilter = (quadLen === 1 && doubleLen === 0) || quadLen === 0;
          }
        } else {
          meetsQuadFilter = (t.damage_relations.quadruple_damage_from || []).length === 0;
        }

        return meetsScoreFilter && meetsQuadFilter;
      })
      .map(async (t: PokemonTypeData) => {
        const pokemon = await processPokemon(t);
        const summarySource: DamageRelations = pokemon[0]?.effective_damage_relations || t.damage_relations;
        const summary = createTypeSummary(summarySource);

        return {
          name: t.name,
          include_ability_immunities: _pokemonFilters.includeAbilityImmunities,
          ...summary,
          pokemon
        } satisfies ResistantTypeResult;
      })
  ))
    .sort((t1, t2) => {
      const t1From = t1.damage_from_score ?? Number.POSITIVE_INFINITY;
      const t1To = t1.damage_to_score ?? 1;
      const t2From = t2.damage_from_score ?? Number.POSITIVE_INFINITY;
      const t2To = t2.damage_to_score ?? 1;
      const t1Quotient = (t1From / t1To);
      const t2Quotient = (t2From / t2To);
      return t2Quotient === t1Quotient ? t1From - t2From : t1Quotient - t2Quotient;
    });
}
