/**
 * Which pool a threat measurement is taken over.
 *
 * `typeThreat.ts` measures a pool; this decides what the pool is. The two are
 * separate because the choice is a judgement and the measurement is not.
 *
 * ## The pool is the opponents, not the candidates
 *
 * The scan filters hard — breedable only, stat floors, no legendaries — and none
 * of that applies here. Those filters express what you would *use*; a threat
 * measurement is about what you will *face*, and nobody's opponent is restricted
 * to Pokemon you approve of. So the pool is every legal species in its default
 * form, which is the denominator `statusThreat.ts` settled on for the same
 * reason: a Pokemon faces opponents, and an opponent is a species someone
 * registered.
 *
 * Default form specifically. A species contributes its threat once whether or
 * not PokeAPI models six cosmetic varieties of it, and counting varieties would
 * weight Pikachu's caps as eighteen separate opponents.
 *
 * ## Weights are derived, never carried
 *
 * Nothing serializes these. A scan derives them, the browser derives them again
 * after loading a cached scan, and the two agree because both are a pure
 * function of catalog, regulation and cup. That is what keeps a year-old cached
 * scan from normalizing against weights nobody can reconstruct.
 *
 * Memoized on that same key, which matters twice over: `damageBounds.ts` keys
 * its cross product on weight-object identity, so handing out a fresh equal
 * object each call would silently recompute 3,078 profiles per Pokemon.
 *
 * ## An opponent has to exist in the game
 *
 * The catalog carries all 1,025 species of the National Dex. Champions has 208,
 * and `COVERAGE_MOVE_POKEDEX` names the Pokedex that says which. Everything else
 * is unreachable — nobody registers a Bulbasaur in a game Bulbasaur is not in —
 * so the roster filter is a precondition of the rule above rather than a rule of
 * its own, and it applies whether or not a regulation is selected.
 *
 * It is worth stating what went wrong without it, because the failure was
 * silent. An unregulated pool was 1,025 species of which 817 had no movepool,
 * contributing their own typing and no moves at all. That is not a small
 * distortion: with 80% of the pool unable to attack, availability collapses back
 * onto typing prevalence — the exact reading `typeThreat.ts` opens by rejecting —
 * and Water came out at 1.000 for being the most common typing in the game
 * rather than a common attack. The weights looked entirely ordinary. Nothing
 * about them said four fifths of the pool had abstained.
 *
 * The diagnosis that got here was also wrong the first time, and is recorded so
 * the next person does not repeat it. This was written up as a gap in the
 * generated table, to be closed by regenerating it over every species. It could
 * not have been: species outside the Pokedex have no `champions` learnset at
 * all, so a full-National-Dex crawl emits nothing — 20 sampled from outside the
 * roster returned zero moves between them. Missing movepool data and a Pokemon
 * that does not exist look identical from inside the table, and only one of them
 * is fixable by fetching more.
 */

import { COVERAGE_MOVE_POKEDEX } from './coverageMoves';
import { measurePoolDamageFromBounds, measurePoolDamageToBounds } from './damageBounds';
import { measureDefenderCensus } from './defenderCensus';
import type { DamageScoreBounds } from './pokedexScoring';
import type { PokemonTypeData } from './pokedexTypes';
import type { DefenderCensus } from './defenderCensus';
import type { TypeMatchupValues } from './teamCoverage';
import { getTypeThreatWeights } from './typeThreat';
import type { CatalogVarietyV1, PokemonCatalogV1 } from './pokemonCatalog';
import type { Regulation } from './regulations';
import type { TypeDefenseRelations, TypeThreatWeights } from './typeThreat';

/** Cup selections are a set of types; the empty selection means the whole pool. */
export interface ThreatPoolSelection {
  readonly regulation?: Regulation;
  /** Types the cup is restricted to. Empty or absent means unrestricted. */
  readonly cupTypes?: readonly string[];
  /** Baseline, which is also how many types the chart holds. */
  readonly baseScore: number;
}

const keyFor = (selection: ThreatPoolSelection): string => JSON.stringify([
  selection.regulation?.id ?? 'any',
  [...(selection.cupTypes ?? [])].sort(),
  selection.baseScore
]);

const cache = new WeakMap<PokemonCatalogV1, Map<string, TypeThreatWeights>>();
const censusCache = new WeakMap<PokemonCatalogV1, Map<string, DefenderCensus>>();
const valuesCache = new WeakMap<PokemonCatalogV1, Map<string, TypeMatchupValues>>();

const rosters = new WeakMap<PokemonCatalogV1, ReadonlySet<string>>();

/**
 * Species that exist in the game the movepool table was generated from.
 *
 * @param catalog Verified catalog.
 * @returns Species names in `COVERAGE_MOVE_POKEDEX`, memoized per catalog.
 */
function getRoster(catalog: PokemonCatalogV1): ReadonlySet<string> {
  const cached = rosters.get(catalog);
  if (cached) return cached;

  const roster = new Set(
    catalog.species
      .filter((species) => species.pokedexes.includes(COVERAGE_MOVE_POKEDEX))
      .map((species) => species.name)
  );
  rosters.set(catalog, roster);
  return roster;
}

/**
 * Members of the metagame a selection describes.
 *
 * @param catalog Verified catalog.
 * @param selection Regulation and cup restricting the pool.
 * @returns Default-form varieties of every species in the metagame.
 */
export function getThreatPool(
  catalog: PokemonCatalogV1,
  selection: ThreatPoolSelection
): readonly CatalogVarietyV1[] {
  const cupTypes = selection.cupTypes ?? [];
  const roster = getRoster(catalog);
  return catalog.varieties.filter((variety) => {
    if (!variety.isDefault) return false;
    // Unconditional, and before the regulation: a regulation narrows who you may
    // register, and this decides who could be registered at all.
    if (!roster.has(variety.speciesName)) return false;
    if (selection.regulation && !selection.regulation.legalSpecies.has(variety.speciesName)) {
      return false;
    }
    // A cup restricts which Pokemon are *registerable*, so it restricts the
    // opponents too — that is the whole reason cup weights differ from
    // regulation ones.
    return cupTypes.length === 0 || variety.types.some((type) => cupTypes.includes(type));
  });
}

/**
 * Pokemon a selection can put on *your* side of the field.
 *
 * The mirror of `getThreatPool`, and the distinction is the one that module
 * opens with: the threat pool is who you will face, this is who you may bring.
 * They differ in three places, and each difference is a rule about candidacy
 * rather than a filter on the view:
 *
 * - **Every form, not only the default one.** Rotom-Heat and Basculegion-Female
 *   are candidates in their own right; an opponent census counts their species
 *   once. Battle-only forms are excluded because `enrichPokemon` never admits
 *   one, so it can never need a score.
 * - **No legendaries or mythicals.** `enrichPokemon` refuses them outright, so
 *   they are opponents the tool will never offer you.
 * - **Everything else stays.** Breeding, stat floors, Pokedex region and Megas
 *   are view choices, and `threatPool.ts` already argues that scoring runs on
 *   the regulation while filtering runs on the view. A bound that moved when a
 *   stat floor slider moved would make two scans incomparable.
 *
 * @param catalog Verified catalog.
 * @param selection Regulation and cup restricting the pool.
 * @returns Varieties this metagame allows as candidates.
 */
export function getCandidatePool(
  catalog: PokemonCatalogV1,
  selection: ThreatPoolSelection
): readonly CatalogVarietyV1[] {
  const cupTypes = selection.cupTypes ?? [];
  const roster = getRoster(catalog);
  const restricted = new Set(catalog.species
    .filter((species) => species.isLegendary || species.isMythical)
    .map((species) => species.name));

  return catalog.varieties.filter((variety) => {
    if (!variety.isDefault && variety.form.isBattleOnly) return false;
    if (!roster.has(variety.speciesName)) return false;
    if (restricted.has(variety.speciesName)) return false;
    if (selection.regulation && !selection.regulation.legalSpecies.has(variety.speciesName)) {
      return false;
    }
    return cupTypes.length === 0 || variety.types.some((type) => cupTypes.includes(type));
  });
}

const fromBoundsCache = new WeakMap<PokemonCatalogV1, Map<string, DamageScoreBounds>>();
const toBoundsCache = new WeakMap<PokemonCatalogV1, Map<string, DamageScoreBounds>>();

/**
 * The range a defensive score occupies in a metagame, memoized per selection.
 *
 * Both halves of the normalization now come from one place and one key, which is
 * the property that keeps a cached scan re-scorable: the scan derives weights
 * and bounds from its regulation, the browser derives them again from the same
 * regulation, and neither serializes anything. Before this they were two calls
 * with two different notions of the pool, and only the weights tracked it.
 *
 * @param catalog Verified catalog.
 * @param selection Regulation and cup restricting the pool.
 * @param baseTypes Single elemental types, which the dual lattice is built from.
 *   Passed rather than derived here because deriving it belongs to the scan
 *   module, and importing that back into this one would close a cycle.
 * @returns Extremes of the weighted defensive score across the candidate pool.
 */
export function getDamageFromBounds(
  catalog: PokemonCatalogV1,
  selection: ThreatPoolSelection,
  baseTypes: readonly PokemonTypeData[]
): DamageScoreBounds {
  const bySelection = fromBoundsCache.get(catalog) ?? new Map<string, DamageScoreBounds>();
  const key = keyFor(selection);
  const cached = bySelection.get(key);
  if (cached) return cached;

  const bounds = measurePoolDamageFromBounds(
    getCandidatePool(catalog, selection),
    baseTypes,
    selection.baseScore,
    getThreatWeights(catalog, selection)
  );

  bySelection.set(key, bounds);
  fromBoundsCache.set(catalog, bySelection);
  return bounds;
}

/**
 * The range an offensive score occupies in a metagame, memoized per selection.
 *
 * @param catalog Verified catalog.
 * @param selection Regulation and cup restricting the pool.
 * @returns Extremes of the census-scored offensive score across the candidates.
 */
export function getDamageToBounds(
  catalog: PokemonCatalogV1,
  selection: ThreatPoolSelection
): DamageScoreBounds {
  const bySelection = toBoundsCache.get(catalog) ?? new Map<string, DamageScoreBounds>();
  const key = keyFor(selection);
  const cached = bySelection.get(key);
  if (cached) return cached;

  const bounds = measurePoolDamageToBounds(
    getCandidatePool(catalog, selection),
    getDefenderCensus(catalog, selection),
    selection.baseScore
  );

  bySelection.set(key, bounds);
  toBoundsCache.set(catalog, bySelection);
  return bounds;
}

/**
 * Threat weights for a metagame, memoized per catalog and selection.
 *
 * @param catalog Verified catalog.
 * @param selection Regulation and cup restricting the pool.
 * @returns Stable, frozen weights in 0..1.
 */
export function getThreatWeights(
  catalog: PokemonCatalogV1,
  selection: ThreatPoolSelection
): TypeThreatWeights {
  const bySelection = cache.get(catalog) ?? new Map<string, TypeThreatWeights>();
  const key = keyFor(selection);
  const cached = bySelection.get(key);
  if (cached) return cached;

  const typeNames = catalog.types
    .filter((type) => type.id <= selection.baseScore)
    .map((type) => type.name);
  // The whole chart, not a derived summary of it: the measurement needs to know
  // what each attacking type would buy its user against this specific pool, and
  // that question is not answerable from a list of types.
  const chart: Record<string, TypeDefenseRelations> = Object.fromEntries(
    catalog.types.map((type) => [type.name, type.damageRelations])
  );
  const weights = getTypeThreatWeights(getThreatPool(catalog, selection), typeNames, chart);

  bySelection.set(key, weights);
  cache.set(catalog, bySelection);
  return weights;
}

/**
 * The field a metagame presents to an attacker, memoized per catalog and
 * selection.
 *
 * Memoized on the same key as the weights, and for the same second reason:
 * `damageBounds.ts` keys the offensive bounds on census identity, so a fresh
 * equal object each call would re-derive 171 typings per entry scored.
 *
 * @param catalog Verified catalog.
 * @param selection Regulation and cup restricting the pool.
 * @returns A stable census over the pool's distinct typings.
 */
export function getDefenderCensus(
  catalog: PokemonCatalogV1,
  selection: ThreatPoolSelection
): DefenderCensus {
  const bySelection = censusCache.get(catalog) ?? new Map<string, DefenderCensus>();
  const key = keyFor(selection);
  const cached = bySelection.get(key);
  if (cached) return cached;

  const chart = Object.fromEntries(catalog.types
    .filter((type) => type.id <= selection.baseScore)
    .map((type) => [type.name, type.damageRelations]));
  const census = measureDefenderCensus(
    getThreatPool(catalog, selection), chart, selection.baseScore
  );

  bySelection.set(key, census);
  censusCache.set(catalog, bySelection);
  return census;
}

/**
 * Mean-normalizes a per-type map so its values average 1 over the types in play.
 *
 * The team scorer's denominators are counts, so a set of weights averaging 1
 * leaves every term's range exactly where `COMPOSITE_BOUNDS` measured it and
 * changes only which types carry the value. Max-normalizing instead — as
 * `toTypeThreatWeights` does, correctly, for the per-bucket defensive score —
 * would shrink every synergy term at once and reproduce the compression bug
 * `damageBounds.ts` exists to prevent.
 *
 * @param values Raw per-type measurements.
 * @param typeNames Types in play, which set the denominator.
 * @returns The same map scaled so those types average 1.
 */
const meanNormalize = (
  values: Readonly<Record<string, number>>,
  typeNames: readonly string[]
): Record<string, number> => {
  const total = typeNames.reduce((sum, name) => sum + (values[name] ?? 0), 0);
  const mean = typeNames.length > 0 ? total / typeNames.length : 0;
  if (mean <= 0) return Object.fromEntries(typeNames.map((name) => [name, 1]));
  return Object.fromEntries(typeNames.map((name) => [name, (values[name] ?? 0) / mean]));
};

/**
 * What each type is worth to a team in a metagame, for `analyzeTeamCoverage`.
 *
 * Both halves are re-readings of measurements this module already hands out:
 * `threat` is `getThreatWeights` rescaled, and `presence` is how much of
 * `getDefenderCensus` carries each type. Nothing new is measured here — the two
 * directions are the ones argued in `typeThreat.ts` and `defenderCensus.ts`.
 *
 * @param catalog Verified catalog.
 * @param selection Regulation and cup restricting the pool.
 * @returns Stable, frozen values averaging 1 across the types in play.
 */
export function getTypeMatchupValues(
  catalog: PokemonCatalogV1,
  selection: ThreatPoolSelection
): TypeMatchupValues {
  const bySelection = valuesCache.get(catalog) ?? new Map<string, TypeMatchupValues>();
  const key = keyFor(selection);
  const cached = bySelection.get(key);
  if (cached) return cached;

  const typeNames = catalog.types
    .filter((type) => type.id <= selection.baseScore)
    .map((type) => type.name);
  const census = getDefenderCensus(catalog, selection);
  const presence: Record<string, number> = Object.fromEntries(typeNames.map((name) => [name, 0]));
  census.entries.forEach(({ types, weight }) => {
    types.forEach((name) => {
      if (name in presence) presence[name] += weight;
    });
  });

  const values: TypeMatchupValues = Object.freeze({
    threat: Object.freeze(meanNormalize(getThreatWeights(catalog, selection), typeNames)),
    presence: Object.freeze(meanNormalize(presence, typeNames))
  });

  bySelection.set(key, values);
  valuesCache.set(catalog, bySelection);
  return values;
}
