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
 */

import { getTypeThreatWeights } from './typeThreat';
import type { CatalogVarietyV1, PokemonCatalogV1 } from './pokemonCatalog';
import type { Regulation } from './regulations';
import type { TypeThreatWeights } from './typeThreat';

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
  return catalog.varieties.filter((variety) => {
    if (!variety.isDefault) return false;
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
  const weights = getTypeThreatWeights(getThreatPool(catalog, selection), typeNames);

  bySelection.set(key, weights);
  cache.set(catalog, bySelection);
  return weights;
}
