import { ref } from 'vue';
import type { WorkspaceSnapshotV1 } from '../lib/workspacePersistence';
import { createInjectableState } from './injectableState';

export const ALL_TYPES = [
  'normal', 'fighting', 'flying', 'poison', 'ground', 'rock', 'bug', 'ghost', 'steel',
  'fire', 'water', 'grass', 'electric', 'psychic', 'ice', 'dragon', 'dark', 'fairy'
];

const metaFilterState = createInjectableState('heur-aegis-dex:meta-filters', () => ({
  selectedTypes: ref<string[]>([...ALL_TYPES]),
  /**
   * Require a Pokemon to have *every* selected type rather than any of them.
   * Replaces the old hideEmptyTypes flag, which had no meaning once the grid
   * started listing Pokemon instead of type combinations.
   */
  requireAllTypes: ref(false)
}));

export const provideMetaFilters = metaFilterState.provideState;
export const __resetMetaFiltersState = metaFilterState.resetFallbackState;

/**
 * Provides meta-analysis filters for visible type combinations, scoped to the
 * current Vue app.
 *
 * @returns Type-selection state and filter preset helpers.
 */
export function useMetaFilters() {
  const { selectedTypes, requireAllTypes } = metaFilterState.useState();

  const toggleType = (type: string) => {
    const index = selectedTypes.value.indexOf(type);
    if (index === -1) {
      selectedTypes.value.push(type);
    } else {
      selectedTypes.value.splice(index, 1);
    }
  };

  const clearTypes = () => {
    selectedTypes.value = [];
  };

  const selectAll = () => {
    selectedTypes.value = [...ALL_TYPES];
  };

  const setPreset = (preset: string) => {
    if (preset === 'boulder') {
      selectedTypes.value = ['rock', 'ground', 'steel', 'fighting'];
    } else if (preset === 'twilight') {
      selectedTypes.value = ['fairy', 'dark', 'poison', 'ghost'];
    }
  };

  const snapshotMetaFilters = (): WorkspaceSnapshotV1['meta'] => ({
    selectedTypes: [...selectedTypes.value],
    requireAllTypes: requireAllTypes.value
  });

  const restoreMetaFilters = (meta: WorkspaceSnapshotV1['meta']) => {
    selectedTypes.value = [...new Set(meta.selectedTypes.filter((type) => ALL_TYPES.includes(type)))];
    requireAllTypes.value = meta.requireAllTypes;
  };

  return {
    selectedTypes,
    requireAllTypes,
    toggleType,
    clearTypes,
    selectAll,
    setPreset,
    snapshotMetaFilters,
    restoreMetaFilters
  };
}
