import Pokedex from 'pokedex-promise-v2';
import { getRegulation } from './regulations';
import { buildOffensiveTypeChart } from './coverageMoves';
import { getMergedBattleForm, sharesTyping } from './battleForms';
import { collapseIndistinctVarieties } from './pokemonEntry';
import { enrichPokemon } from './pokemonEnrichment';
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
  PokemonListEntry,
  PokemonStats,
  PokemonTypeData,
  ResistantTypeResult
} from './pokedexTypes';

const BASESCORE = DEFAULT_BASE_SCORE;
const POKEMON_DETAIL_CONCURRENCY = 12;

/**
 * Stat floors a Pokemon must clear to appear in a scan.
 *
 * These exist to skip Pokemon that cannot hold a slot, not to rank the ones
 * that can — scoring does the ranking. They were calibrated when a scan swept
 * the whole national Pokedex; the regulation filter now cuts that to a few
 * hundred varieties before these ever apply, and loosening them costs nothing
 * in requests because the detail prefetch runs ahead of every filter.
 *
 * Both floors are required. The attack floor removes Pokemon that cannot exert
 * meaningful pressure, while HP-adjusted bulk removes glass cannons without
 * demanding exceptional defenses. Averaging physical and special effective
 * bulk lets a Pokemon have one vulnerable side; 70 keeps Lucario exactly on the
 * boundary.
 */
export const DEFAULT_STATS_FILTERS = {
  minimumAttacks: 80,
  minimumBulk: 70
} as const;

/**
 * Approximates average physical and special durability on a base-stat scale.
 * Damage endurance is proportional to HP multiplied by the relevant defense;
 * the square root returns each product to the same scale as ordinary stats.
 *
 * @param stats HP, Defense and Special Defense after unconditional abilities.
 * @returns Mean physical and special effective bulk.
 */
export { hpAdjustedBulk } from './statMetrics';

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
export { chooseDefaultAbility } from './pokemonEnrichment';
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
 * Loads the form flags used by the source-agnostic eligibility rules.
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
 * @returns The normalized Mega and battle-only flags.
 */
async function resolveFormState(poke: any): Promise<{ isMega: boolean; isBattleOnly: boolean }> {
  if (poke.is_default) return { isMega: false, isBattleOnly: false };
  const formUrl = poke.forms?.[0]?.url;
  if (!formUrl) return { isMega: false, isBattleOnly: false };

  const form = await fetchPokemonFormResource(getPokemonIdFromUrl(formUrl));
  return {
    isMega: form.is_mega === true,
    isBattleOnly: form.is_battle_only === true
  };
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
    is_default_variety: entry.is_default_variety,
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
  /**
   * Stat floors. A Pokemon must reach both its best attacking-stat floor and
   * its HP-adjusted effective-bulk floor. See DEFAULT_STATS_FILTERS.
   */
  statsFilters?: {
    /** @deprecated Ignored. Total base stats are no longer a scan filter. */
    minimumStatsTotal?: number;
    minimumAttacks?: number;
    minimumBulk?: number;
    /** @deprecated Use minimumBulk. Retained for saved settings and API compatibility. */
    minimumDefenses?: number;
  };
} = {}): Promise<ResistantTypeResult[]> {
  const {
    baseScore = BASESCORE,
    typeFilters = { maxDamageFromScore: true, allowQuadrupleDamage: true, limitQuadrupleDamage: true },
    pokemonFilters = { inPokedex: 'national', allowMegas: false, includeAbilityImmunities: true },
    statsFilters
  } = options;

  const _typeFilters = { maxDamageFromScore: true, allowQuadrupleDamage: true, limitQuadrupleDamage: true, ...typeFilters };
  const _pokemonFilters = { inPokedex: 'national', allowMegas: false, includeAbilityImmunities: true, includeMoveCoverage: true, regulation: null, ...pokemonFilters };
  const _statsFilters = {
    minimumAttacks: statsFilters?.minimumAttacks ?? DEFAULT_STATS_FILTERS.minimumAttacks,
    minimumBulk:
      statsFilters?.minimumBulk ?? statsFilters?.minimumDefenses ?? DEFAULT_STATS_FILTERS.minimumBulk
  };

  // An unknown regulation id must not silently degrade into an unfiltered scan,
  // which would quietly hand back an illegal roster.
  const regulation = _pokemonFilters.regulation ? getRegulation(_pokemonFilters.regulation) : undefined;
  if (_pokemonFilters.regulation && !regulation) {
    throw new Error(`Unknown regulation: ${_pokemonFilters.regulation}`);
  }

  const processPokemon = async (t: PokemonTypeData, offensiveChart: OffensiveTypeChart): Promise<PokemonListEntry[]> => {
    const pokemon = await Promise.all(
      (t.pokemon || []).map(async (p: PokemonListEntry) => {
        if (!p.pokemon.url) return null;
        const id = getPokemonIdFromUrl(p.pokemon.url);
        const poke = await fetchPokemonResource(id);

        const speciesId = getPokemonIdFromUrl(poke.species.url);
        const species = await fetchPokemonSpeciesResource(speciesId);

        const form = await resolveFormState(poke);
        const combatant = await resolveCombatantForm(poke, species);
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
        return enrichPokemon({
          id,
          name: p.pokemon.name,
          url: p.pokemon.url,
          speciesName: species.name,
          isDefault: poke.is_default === true,
          types: poke.types || [],
          sprite: poke.sprites.front_default,
          abilities: (poke.abilities || []).map((abilityEntry: any) => ({
            name: abilityEntry.ability.name,
            is_hidden: abilityEntry.is_hidden
          })),
          stats: baseStats,
          battleFormName: combatant.battleFormName,
          isLegendary: species.is_legendary,
          isMythical: species.is_mythical,
          eggGroups: (species.egg_groups || []).map((entry: any) => entry.name),
          pokedexes: (species.pokedex_numbers || []).map((entry: any) => entry.pokedex.name),
          form
        }, t, offensiveChart, {
          baseScore,
          inPokedex: _pokemonFilters.inPokedex,
          allowMegas: _pokemonFilters.allowMegas,
          includeAbilityImmunities: _pokemonFilters.includeAbilityImmunities,
          includeMoveCoverage: _pokemonFilters.includeMoveCoverage,
          minimumAttacks: _statsFilters.minimumAttacks,
          minimumBulk: _statsFilters.minimumBulk,
          regulation
        });
      })
    );

    // Cosmetic varieties — Pikachu's caps, the Totem forms — are indistinguishable
    // from their base here, and a species' varieties always share a typing, so
    // this grouping holds all of them.
    return collapseIndistinctVarieties(
      pokemon
        .filter((p): p is PokemonListEntry => p !== null)
        .filter((p) => t.name.includes('/') || (p.types?.length || 0) === 1)
    ).sort((p1, p2) => (p2.stats_total || 0) - (p1.stats_total || 0));
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
        // `<= baseScore` is not a tuned cutoff. `calculateDamageFromScore`
        // returns exactly `baseScore` for a typing that takes neutral damage
        // from every type, so this reads: keep typings that are **net-neutral or
        // better** defensively, netting resistances against weaknesses. Normal
        // sits exactly on the line — one weakness to Fighting, one immunity to
        // Ghost. That it also lands near the median of the observed range is a
        // consequence of the type chart being roughly balanced, not the reason
        // for the number, so do not "recalibrate" it against a distribution.
        //
        // This is the filter that makes the tool a defensive-typing finder
        // rather than a general Pokedex, which is what it was built to be.
        const meetsScoreFilter = !_typeFilters.maxDamageFromScore || (t.damage_relations.damage_from_score || 0) <= baseScore;

        // This asks a different question from the score filter above, on purpose,
        // and the two are meant to disagree.
        //
        // `damage_from_score` is a **net** measure: it trades weaknesses against
        // resistances and reports an average. It therefore cannot express the
        // thing this rule exists for, which is discrete survivability — whether
        // the Pokemon can be removed from the field before it acts. A quadruple
        // weakness already makes a Pokemon straightforward to OHKO with the right
        // move. Add any second weakness, and in doubles — where two attackers
        // pick their targets each turn — it is close to guaranteed that it does
        // not last a turn. No amount of resistance elsewhere buys that back.
        //
        // Hence the asymmetry, which is intentional: zero quadruples passes with
        // any number of doubles, because nothing there is a one-shot. One
        // quadruple passes only with no doubles at all, because the quadruple is
        // the OHKO enabler and a second weakness means it cannot be switched in
        // safely either.
        //
        // The consequence is that this rejects typings the score filter rates
        // well — Poison/Steel at 15.75 against Normal's 18, among seven such.
        // That is the rule doing its job rather than a bug: `damage_from_score`
        // is the better answer to "how much does this typing suffer on average",
        // and it is the wrong answer to "can this be erased in one turn".
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
