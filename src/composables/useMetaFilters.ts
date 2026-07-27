import { ref } from 'vue';
import { createInjectableState } from './injectableState';

export const ALL_TYPES = [
  'normal', 'fighting', 'flying', 'poison', 'ground', 'rock', 'bug', 'ghost', 'steel',
  'fire', 'water', 'grass', 'electric', 'psychic', 'ice', 'dragon', 'dark', 'fairy'
];

const metaFilterState = createInjectableState('heur-aegis-dex:meta-filters', () => ({
  selectedTypes: ref<string[]>([...ALL_TYPES]),
  hideEmptyTypes: ref(true)
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
  const { selectedTypes, hideEmptyTypes } = metaFilterState.useState();

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

  return {
    selectedTypes,
    hideEmptyTypes,
    toggleType,
    clearTypes,
    selectAll,
    setPreset
  };
}
