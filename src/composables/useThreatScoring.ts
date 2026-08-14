import { computed, shallowRef } from 'vue';
import { measureDamageFromBounds } from '../lib/damageBounds';
import { DEFAULT_BASE_SCORE } from '../lib/pokedexScoring';
import { getCatalogBaseTypes } from '../lib/pokemonCatalogScan';
import { loadPokemonCatalog } from '../lib/pokemonCatalogLoader';
import { getRegulation } from '../lib/regulations';
import { getThreatWeights } from '../lib/threatPool';
import { ALL_TYPES, useMetaFilters } from './useMetaFilters';
import { useWorkspaceState } from './useWorkspaceState';
import type { ThreatScoring } from '../lib/pokemonEntry';
import type { PokemonCatalogV1 } from '../lib/pokemonCatalog';
import type { PokemonTypeData } from '../lib/pokedexTypes';

/**
 * The metagame the browser scores against, tracking the cup as it is edited.
 *
 * A scan bakes in its regulation's weighting and then sits in local storage for
 * a day, so it cannot answer the question a cup asks. Everything here is derived
 * instead: catalog plus regulation plus selected types, memoized in
 * `threatPool.ts` and `damageBounds.ts` so a cup costs one derivation however
 * many Pokemon it re-scores.
 *
 * ## What counts as the cup
 *
 * The selected types, and not `requireAllTypes`. Selecting Rock, Ground, Steel
 * and Fighting is a Boulder Cup — a metagame with its own threat profile, and
 * exactly the case this exists for. Turning on "require all" alongside it is a
 * search for one dual typing within that cup, not a narrower metagame, and
 * treating it as one would measure the field as the handful of Pokemon that
 * happen to be both types.
 *
 * A full selection is not a cup at all, so it falls through to the regulation's
 * own weighting and the browser agrees with the scan exactly.
 */

let baseTypeCache: WeakMap<PokemonCatalogV1, PokemonTypeData[]> | undefined;

/** Base types for bounds derivation. Unweighted: only the buckets are read. */
const baseTypesFor = (catalog: PokemonCatalogV1): PokemonTypeData[] => {
  baseTypeCache ??= new WeakMap();
  const cached = baseTypeCache.get(catalog);
  if (cached) return cached;

  const baseTypes = getCatalogBaseTypes(catalog, DEFAULT_BASE_SCORE);
  baseTypeCache.set(catalog, baseTypes);
  return baseTypes;
};

/**
 * Threat weighting and matching bounds for the current regulation and cup.
 *
 * @returns `scoring`, undefined until the catalog has loaded. Undefined is the
 *   safe state and not an error one: flattening without it keeps the scores the
 *   scan already computed, which are correct for the regulation.
 */
export function useThreatScoring() {
  const { regulation } = useWorkspaceState();
  const { selectedTypes } = useMetaFilters();
  const catalog = shallowRef<PokemonCatalogV1 | null>(null);

  // The loader memoizes, so this is a subscription to work the scan already
  // started rather than a second load. A failure leaves scoring undefined and
  // the app on the scan's own numbers; the scan surfaces the error itself.
  loadPokemonCatalog()
    .then((loaded) => { catalog.value = loaded; })
    .catch(() => { catalog.value = null; });

  const scoring = computed<ThreatScoring | undefined>(() => {
    if (!catalog.value) return undefined;

    const cupTypes = selectedTypes.value.length === ALL_TYPES.length ? [] : selectedTypes.value;
    const weights = getThreatWeights(catalog.value, {
      regulation: getRegulation(regulation.value),
      cupTypes,
      baseScore: DEFAULT_BASE_SCORE
    });

    return {
      weights,
      bounds: measureDamageFromBounds(baseTypesFor(catalog.value), DEFAULT_BASE_SCORE, weights)
    };
  });

  return { scoring };
}
