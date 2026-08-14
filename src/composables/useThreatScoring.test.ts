import { beforeEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import { DEFAULT_BASE_SCORE, damageFromScoreBounds } from '../lib/pokedexScoring';
import { loadPokemonCatalog } from '../lib/pokemonCatalogLoader';
import { isUniformTypeThreat } from '../lib/typeThreat';
import { ALL_TYPES, __resetMetaFiltersState, useMetaFilters } from './useMetaFilters';
import { __resetWorkspaceState, useWorkspaceState } from './useWorkspaceState';
import { useThreatScoring } from './useThreatScoring';

/**
 * The catalog loads asynchronously — a dynamic import plus hash verification —
 * so scoring is undefined until it lands. Waiting on the loader's own memoized
 * promise first means the composable only needs a tick after that.
 */
const untilResolved = async (read: () => unknown) => {
  await loadPokemonCatalog();
  for (let attempt = 0; attempt < 20 && read() === undefined; attempt++) {
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return read();
};

describe('useThreatScoring', () => {
  beforeEach(() => {
    __resetMetaFiltersState();
    __resetWorkspaceState();
  });

  it('resolves to a weighting once the catalog loads', async () => {
    const { scoring } = useThreatScoring();

    // Undefined is the safe state, not an error one: flattening without it keeps
    // the scores the scan already computed.
    expect(scoring.value).toBeUndefined();

    await untilResolved(() => scoring.value);
    expect(scoring.value).toBeDefined();
    expect(isUniformTypeThreat(scoring.value!.weights!)).toBe(false);
    // Weighted bounds close in on the neutral line from both sides.
    const flat = damageFromScoreBounds(DEFAULT_BASE_SCORE);
    expect(scoring.value!.bounds.min).toBeGreaterThan(flat.min);
    expect(scoring.value!.bounds.max).toBeLessThan(flat.max);
    expect(scoring.value!.bounds.min).toBeLessThan(DEFAULT_BASE_SCORE);
    expect(scoring.value!.bounds.max).toBeGreaterThan(DEFAULT_BASE_SCORE);
  });

  it('re-prices when the cup changes and returns to the regulation on a full selection', async () => {
    const { selectedTypes } = useMetaFilters();
    const { scoring } = useThreatScoring();
    await untilResolved(() => scoring.value);

    const openFormat = scoring.value!;
    expect(selectedTypes.value).toHaveLength(ALL_TYPES.length);

    selectedTypes.value = ['rock', 'ground', 'steel', 'fighting'];
    await nextTick();
    const boulder = scoring.value!;

    expect(boulder.weights).not.toBe(openFormat.weights);
    // A cup made of Fighting and Ground raises exactly those.
    expect(boulder.weights!.fighting).toBeGreaterThan(openFormat.weights!.fighting);
    expect(boulder.weights!.ground).toBeGreaterThan(openFormat.weights!.ground);

    selectedTypes.value = [...ALL_TYPES];
    await nextTick();
    // Identity, so the browser and the scan agree rather than merely matching.
    expect(scoring.value!.weights).toBe(openFormat.weights);
  });

  it('follows the regulation, so two formats are not scored as one metagame', async () => {
    const { regulation } = useWorkspaceState();
    const { scoring } = useThreatScoring();
    await untilResolved(() => scoring.value);

    regulation.value = 'M-B';
    await nextTick();
    const restricted = scoring.value!;

    regulation.value = '';
    await nextTick();
    expect(scoring.value!.weights).not.toBe(restricted.weights);
  });
});
