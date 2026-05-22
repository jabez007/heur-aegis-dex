<script setup lang="ts">
import { computed, ref } from 'vue';
import MetaControls from './MetaControls.vue';
import TeamWorkbench from './TeamWorkbench.vue';
import MetaAnalysisGrid from './MetaAnalysisGrid.vue';
import { useMetaFilters } from '../composables/useMetaFilters';

const props = defineProps<{
  allDataTypes: any[]
}>();

const { selectedTypes, hideEmptyTypes } = useMetaFilters();
const selectedPokemonIndices = ref<Record<string, number>>({});
const selectedAbilityNames = ref<Record<string, string>>({});

const getSelectedPokemonIndex = (typeData: any) => {
  const maxIndex = Math.max((typeData.pokemon?.length || 1) - 1, 0);
  return Math.min(selectedPokemonIndices.value[typeData.name] ?? 0, maxIndex);
};

const buildActiveTypeData = (typeData: any) => {
  const pokemonIndex = getSelectedPokemonIndex(typeData);
  const selectedPokemon = typeData.pokemon?.[pokemonIndex];

  if (!selectedPokemon) {
    return {
      ...typeData,
      selected_pokemon_index: pokemonIndex,
      selectedPokemon: null,
      selected_ability_name: ''
    };
  }

  const abilityName = selectedAbilityNames.value[typeData.name]
    || selectedPokemon.selected_ability_name
    || selectedPokemon.abilities?.[0]?.name
    || '';
  const abilityProfile = selectedPokemon.ability_profiles?.[abilityName] || null;
  const activePokemon = {
    ...selectedPokemon,
    selected_ability_name: abilityName,
    effective_damage_relations: abilityProfile?.damage_relations || selectedPokemon.effective_damage_relations,
    effective_weaknesses: abilityProfile?.weaknesses || selectedPokemon.effective_weaknesses || typeData.weaknesses || [],
    effective_quadruple_weaknesses: abilityProfile?.quadruple_weaknesses || selectedPokemon.effective_quadruple_weaknesses || typeData.quadruple_weaknesses || [],
    effective_resistances: abilityProfile?.resistances || selectedPokemon.effective_resistances || typeData.resistances || [],
    effective_ineffectives: abilityProfile?.ineffectives || selectedPokemon.effective_ineffectives || typeData.ineffectives || [],
    effective_coverages: abilityProfile?.coverages || selectedPokemon.effective_coverages || typeData.coverages || [],
    effective_damage_from_score: abilityProfile?.damage_from_score ?? selectedPokemon.effective_damage_from_score ?? typeData.damage_from_score,
    effective_damage_to_score: abilityProfile?.damage_to_score ?? selectedPokemon.effective_damage_to_score ?? typeData.damage_to_score
  };

  return {
    ...typeData,
    selected_pokemon_index: pokemonIndex,
    selectedPokemon: activePokemon,
    selected_ability_name: abilityName,
    weaknesses: activePokemon.effective_weaknesses,
    quadruple_weaknesses: activePokemon.effective_quadruple_weaknesses,
    resistances: activePokemon.effective_resistances,
    ineffectives: activePokemon.effective_ineffectives,
    coverages: activePokemon.effective_coverages,
    damage_from_score: activePokemon.effective_damage_from_score,
    damage_to_score: activePokemon.effective_damage_to_score
  };
};

const getActiveDamageFromScore = (typeData: any) => typeData.selectedPokemon?.effective_damage_from_score ?? typeData.damage_from_score ?? Number.POSITIVE_INFINITY;
const getActiveDamageToScore = (typeData: any) => typeData.selectedPokemon?.effective_damage_to_score ?? typeData.damage_to_score ?? 1;

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
    .map(buildActiveTypeData)
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
