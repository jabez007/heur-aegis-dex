import { ref } from 'vue';

export const ALL_TYPES = [
  'normal', 'fighting', 'flying', 'poison', 'ground', 'rock', 'bug', 'ghost', 'steel',
  'fire', 'water', 'grass', 'electric', 'psychic', 'ice', 'dragon', 'dark', 'fairy'
];

const selectedTypes = ref<string[]>([...ALL_TYPES]);
const hideEmptyTypes = ref(true);

/**
 * Provides shared meta-analysis filters for visible type combinations.
 *
 * @returns Shared type-selection state and filter preset helpers.
 */
export function useMetaFilters() {

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
