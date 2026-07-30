import Pokedex from 'pokedex-promise-v2';
import { getMergedBattleForm, sharesTyping } from './battleForms';
import { enrichPokemon } from './pokemonEnrichment';
import {
  DEFAULT_BASE_SCORE,
  calculateDamageFromScore,
  calculateDamageToScore
} from './pokedexScoring';
import {
  buildDualTypes,
  resolveResistantTypeScanOptions,
  runResistantTypeScan
} from './resistantTypeScan';
import type { ResistantTypeScanOptions } from './resistantTypeScan';
import type { OffensiveTypeChart } from './coverageMoves';
import type {
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
export { DEFAULT_STATS_FILTERS } from './resistantTypeScan';

/**
 * Approximates average physical and special durability on a base-stat scale.
 * Damage endurance is proportional to HP multiplied by the relevant defense;
 * the square root returns each product to the same scale as ordinary stats.
 *
 * @param stats HP, Defense and Special Defense after unconditional abilities.
 * @returns Mean physical and special effective bulk.
 */
export { hpAdjustedBulk } from './statMetrics';

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
  return buildDualTypes(resolvedBaseTypes, baseScore);
}

/**
 * Fetches, filters, and ranks eligible type groupings and Pokemon candidates
 * for the current Pokedex, stats, and ability-immunity settings.
 *
 * @param options Scan options controlling scoring, Pokedex scope, ability-immunity handling, and stat floors.
 * @returns Ranked type results with eligible Pokemon candidates and summarized matchup data.
 */
export async function getResistantTypes(
  options: ResistantTypeScanOptions = {}
): Promise<ResistantTypeResult[]> {
  const resolvedOptions = resolveResistantTypeScanOptions(options);
  const processPokemon = async (
    t: PokemonTypeData,
    offensiveChart: OffensiveTypeChart
  ): Promise<(PokemonListEntry | null)[]> => {
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
        }, t, offensiveChart, resolvedOptions.enrichment);
      })
    );
    return pokemon;
  };

  // Acquisition stays live; dual construction and every later stage are shared
  // with the catalog path.
  const baseTypes = await getBaseTypes(resolvedOptions.baseScore);
  return runResistantTypeScan(baseTypes, resolvedOptions, {
    prepare: async (types) => {
      const uniquePokemonEntries = Array.from(
        new Map(
          types
            .flatMap((typeData) => typeData.pokemon || [])
            .filter((entry): entry is PokemonListEntry => !!entry.pokemon?.url)
            .map((entry) => [entry.pokemon.url as string, entry])
        ).values()
      );

      await mapWithConcurrency(uniquePokemonEntries, POKEMON_DETAIL_CONCURRENCY, async (entry) => {
        const id = getPokemonIdFromUrl(entry.pokemon.url!);
        const poke = await fetchPokemonResource(id);
        const speciesId = getPokemonIdFromUrl(poke.species.url);
        const species = await fetchPokemonSpeciesResource(speciesId);
        const formUrl = poke.is_default ? undefined : poke.forms?.[0]?.url;
        if (formUrl) await fetchPokemonFormResource(getPokemonIdFromUrl(formUrl));
        await resolveCombatantForm(poke, species);
      });
    },
    enrichType: processPokemon
  });
}
