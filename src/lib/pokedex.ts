import Pokedex from 'pokedex-promise-v2';
import { applyAbilityModifiers, createRawAbilityProfile } from './pokedexAbilities';
import { getRegulation, isSpeciesLegal } from './regulations';
import { buildOffensiveTypeChart, getMoveCoverage } from './coverageMoves';
import { getMergedBattleForm, sharesTyping } from './battleForms';
import { getEffectiveStats, getStatAbility, getStatAbilityName, totalStats } from './statAbilities';
import {
  DEFAULT_BASE_SCORE,
  calculateDamageFromScore,
  calculateDamageToScore,
  cloneDamageRelations,
  createTypeSummary,
  filterUniqueBy
} from './pokedexScoring';
import type { OffensiveTypeChart } from './coverageMoves';
import type {
  DamageRelations,
  NamedResource,
  PokemonAbilitySlot,
  PokemonListEntry,
  PokemonStats,
  PokemonTypeData,
  ResistantTypeResult
} from './pokedexTypes';

const BASESCORE = DEFAULT_BASE_SCORE;
const POKEMON_DETAIL_CONCURRENCY = 12;

/**
 * Returns every unordered pair drawn from the supplied items.
 *
 * Replaces lodash.combinations, which pulled all of lodash into the browser
 * bundle and needed an `any` cast because it patches the lodash namespace.
 *
 * @param items Items to pair up.
 * @returns Each distinct pair, in input order.
 */
function pairCombinations<T>(items: T[]): [T, T][] {
  const pairs: [T, T][] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      pairs.push([items[i], items[j]]);
    }
  }
  return pairs;
}

const pokemonResourceCache = new Map<number, Promise<any>>();
const pokemonSpeciesCache = new Map<number, Promise<any>>();
const pokemonFormCache = new Map<number, Promise<any>>();

export const pokedex = new Pokedex({
  protocol: 'https',
  timeout: 1000 * 20,
  cacheLimit: 1000 * 60 * 60 * 24 * 7
});

export type { NamedResource, DamageRelations, PokemonTypeData } from './pokedexTypes';
export {
  REGULATIONS,
  getActiveRegulation,
  getRegulation,
  isSpeciesLegal,
  canMegaEvolve,
  hasCompleteData
} from './regulations';
export type { Regulation, RegulationId, RegulationRules, MechanicId } from './regulations';

/**
 * Clears internal Pokemon detail caches. Intended for tests.
 *
 * @returns Nothing.
 */
export function __resetPokedexResourceCaches() {
  pokemonResourceCache.clear();
  pokemonSpeciesCache.clear();
  pokemonFormCache.clear();
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

  // Failed in-flight requests must be evicted so later scans can retry instead
  // of reusing a permanently rejected promise from the cache.
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

  // Failed in-flight requests must be evicted so later scans can retry instead
  // of reusing a permanently rejected promise from the cache.
  const request = pokedex.getResource(`/api/v2/pokemon-species/${id}/`).catch((error) => {
    pokemonSpeciesCache.delete(id);
    throw error;
  });
  pokemonSpeciesCache.set(id, request);
  return request;
}

function fetchPokemonFormResource(id: number) {
  const cached = pokemonFormCache.get(id);
  if (cached) return cached;

  // Failed in-flight requests must be evicted so later scans can retry instead
  // of reusing a permanently rejected promise from the cache.
  const request = pokedex.getResource(`/api/v2/pokemon-form/${id}/`).catch((error) => {
    pokemonFormCache.delete(id);
    throw error;
  });
  pokemonFormCache.set(id, request);
  return request;
}

/**
 * Decides whether a variety is something a player can actually register.
 *
 * Gigantamax, Mimikyu-Busted, Eiscue-Noice and the rest only exist mid-battle:
 * they are states a Pokemon enters, not separate Pokemon, so listing them
 * alongside their base form invents team slots that do not exist. PokeAPI marks
 * them with `is_battle_only` on the form resource, which is the authority here —
 * a name-suffix denylist would silently miss whatever form ships next.
 *
 * Megas are battle-only by the same flag but are a real pre-battle choice under
 * Champions, so they stay behind the caller's own switch rather than being
 * swept up with the temporary forms.
 *
 * Only non-default varieties are checked, so the extra request is confined to
 * alternate forms instead of being paid for every Pokemon in the Pokedex.
 *
 * @param poke Fetched `/pokemon` resource.
 * @param allowMegas Whether Mega Evolutions are permitted by the current scan.
 * @returns Whether the variety may appear as its own Pokemon.
 */
async function isRegisterableForm(poke: any, allowMegas: boolean): Promise<boolean> {
  if (poke.is_default) return true;

  const formUrl = poke.forms?.[0]?.url;
  if (!formUrl) return true;

  const form = await fetchPokemonFormResource(getPokemonIdFromUrl(formUrl));
  if (form.is_mega) return allowMegas;
  return !form.is_battle_only;
}

/**
 * Resolves which form's numbers describe how a Pokemon actually battles.
 *
 * Returns the registered `/pokemon` resource unchanged unless `battleForms.ts`
 * whitelists a battle-only form for the species *and* the registered form has
 * the ability that triggers it *and* the merge leaves the typing alone. Any of
 * those failing means the Pokemon is rated as registered, which is the safe
 * direction: understating one Pokemon is a worse outcome than silently filing
 * it under a typing it does not have.
 *
 * Resolution is driven entirely by the two fetched resources so the prefetch
 * pass can call it to warm the cache. Sharing the call rather than duplicating
 * the decision is what keeps the two from drifting: the prefetch cannot warm
 * the wrong resource, because it asks the same question.
 *
 * @param poke Fetched `/pokemon` resource for the registered form.
 * @param species Fetched `/pokemon-species` resource, used to locate the variety.
 * @returns The resource to take stats from, and the form name to disclose. The
 *          name comes from the table rather than the fetched resource, so the
 *          disclosure cannot go missing if the response shape shifts.
 */
async function resolveCombatantForm(
  poke: any,
  species: any
): Promise<{ resource: any; battleFormName?: string }> {
  const asRegistered = { resource: poke };

  const abilityNames = (poke.abilities || []).map((entry: any) => entry.ability.name);
  const rule = getMergedBattleForm(species.name, abilityNames);
  if (!rule) return asRegistered;

  const variety = (species.varieties || [])
    .find((entry: any) => entry.pokemon?.name === rule.variety);
  if (!variety?.pokemon?.url) return asRegistered;

  const battleForm = await fetchPokemonResource(getPokemonIdFromUrl(variety.pokemon.url));

  const typeNames = (resource: any) => (resource.types || []).map((slot: any) => slot.type.name);
  if (!sharesTyping(typeNames(poke), typeNames(battleForm))) return asRegistered;

  return { resource: battleForm, battleFormName: rule.variety };
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
            immunities: [...(profile.immunities || [])],
            ineffectives: [...(profile.ineffectives || [])],
            coverages: [...(profile.coverages || [])],
            stats: profile.stats ? { ...profile.stats } : undefined,
            move_coverages: profile.move_coverages ? [...profile.move_coverages] : undefined
          }
        ])
      )
    : undefined;

  return {
    ...entry,
    pokemon: { ...entry.pokemon },
    species_name: entry.species_name,
    battle_form_name: entry.battle_form_name,
    types: entry.types ? entry.types.map((typeSlot) => ({ ...typeSlot, type: { ...typeSlot.type } })) : undefined,
    abilities: entry.abilities ? entry.abilities.map((ability) => ({ ...ability })) : undefined,
    stats: entry.stats ? { ...entry.stats } : undefined,
    base_stats: entry.base_stats ? { ...entry.base_stats } : undefined,
    stat_ability_name: entry.stat_ability_name,
    ability_profiles: abilityProfiles,
    effective_damage_relations: entry.effective_damage_relations ? cloneDamageRelations(entry.effective_damage_relations) : undefined,
    effective_weaknesses: [...(entry.effective_weaknesses || [])],
    effective_quadruple_weaknesses: [...(entry.effective_quadruple_weaknesses || [])],
    effective_resistances: [...(entry.effective_resistances || [])],
    effective_immunities: [...(entry.effective_immunities || [])],
    effective_move_coverages: [...(entry.effective_move_coverages || [])],
    effective_ineffectives: [...(entry.effective_ineffectives || [])],
    effective_coverages: [...(entry.effective_coverages || [])]
  };
}

/**
 * Fetches and scores the base elemental types from PokeAPI.
 *
 * @param baseScore Baseline score used to normalize offensive and defensive damage values.
 * @returns A list of base type entries with calculated damage scores.
 */
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

/**
 * Builds combined dual-type damage profiles from the fetched base types.
 *
 * @param baseScore Baseline score used to normalize offensive and defensive damage values.
 * @param baseTypes Already-fetched base types to combine. Fetched on demand when omitted.
 * @returns A list of synthesized dual-type entries with merged damage relations.
 */
export async function getDualTypes(
  baseScore: number = BASESCORE,
  baseTypes?: PokemonTypeData[]
): Promise<PokemonTypeData[]> {
  const resolvedBaseTypes = baseTypes ?? await getBaseTypes(baseScore);

  return pairCombinations(resolvedBaseTypes)
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
          // Dual-type processing mutates enriched Pokemon records later, so each
          // synthesized type needs its own copy instead of sharing source objects.
          .map((pokemonEntry: PokemonListEntry) => clonePokemonEntry(pokemonEntry))
      };

      dualType.damage_relations.damage_from_score = calculateDamageFromScore(dualType.damage_relations, baseScore);
      dualType.damage_relations.damage_to_score = calculateDamageToScore(dualType.damage_relations, baseScore);

      return dualType;
    });
}

/**
 * Fetches, filters, and ranks eligible type groupings and Pokemon candidates
 * for the current Pokedex, stats, and ability-immunity settings.
 *
 * @param options Scan options controlling scoring, Pokedex scope, ability-immunity handling, and stat floors.
 * @returns Ranked type results with eligible Pokemon candidates and summarized matchup data.
 */
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
    /**
     * Include coverage reachable through learnable moves, not only STAB.
     * Defaults to true; disable to score on typing alone.
     */
    includeMoveCoverage?: boolean;
    /**
     * Restrict results to a Champions regulation roster, for example `M-B`.
     * Omit or pass null to scan without a legality filter. Applied on top of
     * the breedable-only rule, never instead of it.
     */
    regulation?: string | null;
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
  const _pokemonFilters = { inPokedex: 'national', allowMegas: false, includeAbilityImmunities: true, includeMoveCoverage: true, regulation: null, ...pokemonFilters };
  const _statsFilters = { minimumStatsTotal: 480, minimumAttacks: 80, minimumDefenses: 80, ...statsFilters };

  // An unknown regulation id must not silently degrade into an unfiltered scan,
  // which would quietly hand back an illegal roster.
  const regulation = _pokemonFilters.regulation ? getRegulation(_pokemonFilters.regulation) : undefined;
  if (_pokemonFilters.regulation && !regulation) {
    throw new Error(`Unknown regulation: ${_pokemonFilters.regulation}`);
  }

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

  const processPokemon = async (t: PokemonTypeData, offensiveChart: OffensiveTypeChart): Promise<PokemonListEntry[]> => {
    const pokemon = await Promise.all(
      (t.pokemon || []).map(async (p: PokemonListEntry) => {
        if (!p.pokemon.url) return null;
        const id = getPokemonIdFromUrl(p.pokemon.url);
        const poke = await fetchPokemonResource(id);

        // Battle-only forms are not team slots, and Megas are gated separately.
        if (!await isRegisterableForm(poke, _pokemonFilters.allowMegas)) return null;

        const speciesId = getPokemonIdFromUrl(poke.species.url);
        const species = await fetchPokemonSpeciesResource(speciesId);

        // Two independent filters. Legality is what the format permits;
        // breedability is a play-style preference. Neither implies the other,
        // so both are applied and neither replaces the other.
        if (!isBreedable(species, p.pokemon.name)) return null;
        if (regulation && !isSpeciesLegal(regulation, species.name)) return null;

        if (!species.pokedex_numbers.some((pn: any) =>
          (pokedexMaps[_pokemonFilters.inPokedex] || []).some((pm: any) => pn.pokedex.name.includes(pm))
        )) {
          return null;
        }

        p.species_name = species.name;
        p.types = poke.types;
        p.sprite = poke.sprites.front_default;
        p.abilities = poke.abilities.map((abilityEntry: any): PokemonAbilitySlot => ({
          name: abilityEntry.ability.name,
          is_hidden: abilityEntry.is_hidden
        }));

        // Identity stays with the registered form; only the numbers move. A
        // Palafin on your team list is a Palafin, but every turn it takes is
        // taken as Hero, so that is what the stat filters and scoring see.
        const combatant = await resolveCombatantForm(poke, species);
        p.battle_form_name = combatant.battleFormName;

        const baseStats = combatant.resource.stats.reduce((merged: PokemonStats, curr: any) => {
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
        p.base_stats = baseStats;

        // Huge Power and its kin are the entire reason their Pokemon are used,
        // so the stat floors have to see the doubled number. Judging Azumarill
        // on 50 Attack rejected it for failing a floor its ability clears twice
        // over.
        const abilityNames = (p.abilities || []).map((ability) => ability.name);
        const stats = getEffectiveStats(baseStats, abilityNames);
        p.stats = stats;
        p.stat_ability_name = getStatAbilityName(abilityNames);

        if (stats.attack < _statsFilters.minimumAttacks && stats['special-attack'] < _statsFilters.minimumAttacks) return null;
        if ((stats.defense + stats['special-defense']) / 2 < _statsFilters.minimumDefenses) return null;

        const statsTotal = totalStats(stats);
        p.stats_total = statsTotal;
        if (statsTotal < _statsFilters.minimumStatsTotal) return null;

        const baseDamageRelations = cloneDamageRelations(t.damage_relations);
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

        // Each ability carries its own stat line, so switching ability in the UI
        // moves the numbers as well as the resistances.
        const profilesWithStats = abilityProfiles.map((profile) => {
          const profileStats = getEffectiveStats(baseStats, [profile.ability_name]);
          return {
            ...profile,
            stats: profileStats,
            stats_total: totalStats(profileStats),
            move_coverages: _pokemonFilters.includeMoveCoverage
              ? getMoveCoverage(p.pokemon.name, offensiveChart, profileStats)
              : []
          };
        });

        // The default selection is otherwise made on defensive merit alone,
        // which would hand Azumarill Sap Sipper — a Grass immunity — in place of
        // the ability that doubles its Attack. A stat ability outweighs any one
        // type immunity for the Pokemon that have one, so it wins the default.
        const statAbilityProfile = profilesWithStats.find((profile) => getStatAbility(profile.ability_name));
        const selectedProfile = statAbilityProfile
          ?? profilesWithStats.find((profile) => profile.ability_name === bestProfile.ability_name)
          ?? profilesWithStats[0];

        p.ability_profiles = Object.fromEntries(profilesWithStats.map((profile) => [profile.ability_name || '', profile]));
        p.selected_ability_name = selectedProfile.ability_name;
        p.effective_damage_relations = selectedProfile.damage_relations;
        p.effective_weaknesses = selectedProfile.weaknesses;
        p.effective_quadruple_weaknesses = selectedProfile.quadruple_weaknesses;
        p.effective_resistances = selectedProfile.resistances;
        p.effective_immunities = selectedProfile.immunities;
        // Move coverage is a property of the Pokemon rather than its typing, so
        // it is resolved per entry from the variety name the scan already holds.
        // The learnset belongs to the registered variety, but which half of it
        // is worth a moveslot depends on the stats it fights with — for a merged
        // battle form those are not the same Pokemon's numbers.
        p.effective_move_coverages = selectedProfile.move_coverages;
        p.effective_ineffectives = selectedProfile.ineffectives;
        p.effective_coverages = selectedProfile.coverages;
        p.effective_damage_from_score = selectedProfile.damage_from_score;
        p.effective_damage_to_score = selectedProfile.damage_to_score;
        // The selected ability decides the stat line too, and it is not always
        // the one that cleared the floors above.
        p.stats = selectedProfile.stats;
        p.stats_total = selectedProfile.stats_total;

        return p;
      })
    );

    return pokemon
      .filter((p): p is PokemonListEntry => p !== null)
      .filter((p) => t.name.includes('/') || (p.types?.length || 0) === 1)
      .sort((p1, p2) => (p2.stats_total || 0) - (p1.stats_total || 0));
  };

  // Fetch the base types once and hand them to getDualTypes, which would
  // otherwise refetch all 18 type resources for the same scan.
  const baseTypes = await getBaseTypes(baseScore);
  const baseAndDualTypes = baseTypes.concat(await getDualTypes(baseScore, baseTypes));
  const offensiveChart = buildOffensiveTypeChart(baseTypes);

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
    const species = await fetchPokemonSpeciesResource(speciesId);

    // Every detail request a scan makes is warmed here, under this concurrency
    // limit. processPokemon then runs against a hot cache and issues none of
    // its own — which matters because it fans out across all type groupings at
    // once, so anything left to resolve lazily escapes the budget entirely and
    // its request count scales with the number of typings a Pokemon appears in.
    const formUrl = poke.is_default ? undefined : poke.forms?.[0]?.url;
    if (formUrl) await fetchPokemonFormResource(getPokemonIdFromUrl(formUrl));

    // Asks the same question processPokemon will ask, rather than reimplementing
    // it, so the prefetch cannot warm the wrong resource as the table grows.
    await resolveCombatantForm(poke, species);
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
        const pokemon = await processPokemon(t, offensiveChart);
        // The summary describes the typing itself, so it must come from the type's
        // own damage relations. Deriving it from the highest-stat Pokemon leaked
        // that Pokemon's ability immunities into a row presented as a property of
        // the type. Per-Pokemon adjustments live on each entry's effective_* fields
        // and are overlaid by the UI when a specific Pokemon is selected.
        const summarySource: DamageRelations = t.damage_relations;
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
