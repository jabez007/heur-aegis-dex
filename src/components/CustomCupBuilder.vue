<script setup lang="ts">
import { computed } from 'vue';
import MetaControls from './MetaControls.vue';
import TeamWorkbench from './TeamWorkbench.vue';
import MetaAnalysisGrid from './MetaAnalysisGrid.vue';
import { useMetaFilters } from '../composables/useMetaFilters';

const props = defineProps<{
  allDataTypes: any[]
}>();

const { selectedTypes, hideEmptyTypes } = useMetaFilters();

const filteredTypes = computed(() => {
  if (selectedTypes.value.length === 0) return [];
  
  return props.allDataTypes.filter(t => {
    // 1. Check if at least one part of the type combo is selected
    const typeParts = t.name.split('/');
    const isSelected = typeParts.some((part: string) => selectedTypes.value.includes(part));
    if (!isSelected) return false;

    // 2. If hideEmptyTypes is true, filter out types with no eligible pokemon
    if (hideEmptyTypes.value && t.pokemon.length === 0) return false;

    return true;
  });
});
</script>

<template>
  <div class="custom-cup-builder">
    <MetaControls />
    
    <TeamWorkbench :allDataTypes="allDataTypes" />

    <MetaAnalysisGrid :filteredTypes="filteredTypes" />
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
