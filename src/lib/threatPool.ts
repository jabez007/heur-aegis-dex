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
