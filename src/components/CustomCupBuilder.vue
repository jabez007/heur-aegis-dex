<script setup lang="ts">
import { computed, ref } from 'vue';
import MetaControls from './MetaControls.vue';
import TeamWorkbench from './TeamWorkbench.vue';
import MetaAnalysisGrid from './MetaAnalysisGrid.vue';
import { useMetaFilters } from '../composables/useMetaFilters';
import { buildActiveTypeData } from '../lib/activePokemon';
import type { ActiveTypeDataLike, TypeDataLike } from '../lib/activePokemon';

const props = defineProps<{
  allDataTypes: TypeDataLike[]
}>();

const { selectedTypes, hideEmptyTypes } = useMetaFilters();
const selectedPokemonIndices = ref<Record<string, number>>({});
const selectedAbilityNames = ref<Record<string, string>>({});

const getSelectedPokemonIndex = (typeData: TypeDataLike) => {
  const maxIndex = Math.max((typeData.pokemon?.length || 1) - 1, 0);
  return Math.min(selectedPokemonIndices.value[typeData.name] ?? 0, maxIndex);
};

const getActiveDamageFromScore = (typeData: ActiveTypeDataLike) => typeData.selectedPokemon?.effective_damage_from_score ?? typeData.damage_from_score ?? Number.POSITIVE_INFINITY;
const getActiveDamageToScore = (typeData: ActiveTypeDataLike) => typeData.selectedPokemon?.effective_damage_to_score ?? typeData.damage_to_score ?? 1;

const filteredTypes = computed(() => {
  if (selectedTypes.value.length === 0) return [];
  
  return props.allDataTypes
    .filter(t => {
      const typeParts = t.name.split('/');
      const isSelected = typeParts.some((part: string) => selectedTypes.value.includes(part));
      if (!isSelected) return false;

      if (hideEmptyTypes.value && t.pokemon.length === 0) return false;

      return true;
    })
    .map(typeData => buildActiveTypeData(
      typeData,
      getSelectedPokemonIndex(typeData),
      selectedAbilityNames.value[typeData.name]
    ))
    .sort((t1, t2) => {
      const t1From = getActiveDamageFromScore(t1);
      const t2From = getActiveDamageFromScore(t2);
      const t1To = getActiveDamageToScore(t1);
      const t2To = getActiveDamageToScore(t2);
      const t1Quotient = t1From / t1To;
      const t2Quotient = t2From / t2To;
      return t2Quotient === t1Quotient ? t1From - t2From : t1Quotient - t2Quotient;
    });
});

const updateSelectedPokemonIndex = (typeName: string, nextIndex: number) => {
  selectedPokemonIndices.value = {
    ...selectedPokemonIndices.value,
    [typeName]: nextIndex
  };
};

const updateSelectedAbilityName = (typeName: string, abilityName: string) => {
  selectedAbilityNames.value = {
    ...selectedAbilityNames.value,
    [typeName]: abilityName
  };
};
</script>

<template>
  <div class="custom-cup-builder">
    <MetaControls />
    
    <TeamWorkbench 
      :all-data-types="allDataTypes" 
      :filtered-types="filteredTypes"
    />

    <MetaAnalysisGrid 
      :filtered-types="filteredTypes" 
      :selected-types-count="selectedTypes.length"
      @update:selected-pokemon-index="updateSelectedPokemonIndex"
      @update:selected-ability-name="updateSelectedAbilityName"
    />
  </div>
</template>

<style lang="scss" scoped>
.custom-cup-builder {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 24px;
}
</style>
