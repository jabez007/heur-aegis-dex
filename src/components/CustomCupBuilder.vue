<script setup lang="ts">
import { computed, ref } from 'vue';
import MetaControls from './MetaControls.vue';
import TeamWorkbench from './TeamWorkbench.vue';
import MetaAnalysisGrid from './MetaAnalysisGrid.vue';
import { useMetaFilters } from '../composables/useMetaFilters';
import { useTeamBuilder } from '../composables/useTeamBuilder';
import { flattenToPokemon, withAbility } from '../lib/pokemonEntry';
import { candidatePriority } from '../lib/rosterGeneration';
import type { ResistantTypeResult } from '../lib/pokedexTypes';

const props = defineProps<{
  allDataTypes: ResistantTypeResult[]
}>();

const { selectedTypes, requireAllTypes } = useMetaFilters();
// The browser ranks with the format the workbench is set to, so switching
// format re-orders the browser the same way it re-scores the roster.
const { format } = useTeamBuilder();

/** Ability overrides, keyed by Pokemon rather than by typing. */
const selectedAbilityNames = ref<Record<string, string>>({});

// The scan is still organised by type combination, so it is flattened once into
// Pokemon. Everything downstream browses Pokemon; typings are just a filter.
const allPokemon = computed(() => flattenToPokemon(props.allDataTypes));

const filteredPokemon = computed(() => {
  if (selectedTypes.value.length === 0) return [];

  return allPokemon.value
    .filter((pokemon) => {
      const matches = pokemon.types.filter((type) => selectedTypes.value.includes(type));
      // "Require all" asks for Pokemon carrying every selected type, which is
      // how you search for a specific dual typing.
      return requireAllTypes.value
        ? matches.length === selectedTypes.value.length
        : matches.length > 0;
    })
    .map((pokemon) => withAbility(pokemon, selectedAbilityNames.value[pokemon.name]))
    // Ranked by the same priority the roster generator uses, so the browser
    // shows what generation would reach for first — including the format, since
    // redirection and ally protection are worth nothing in singles.
    .sort((a, b) =>
      candidatePriority(b, { hasAlly: format.value.hasAlly })
      - candidatePriority(a, { hasAlly: format.value.hasAlly })
    );
});

const updateSelectedAbilityName = (pokemonName: string, abilityName: string) => {
  selectedAbilityNames.value = {
    ...selectedAbilityNames.value,
    [pokemonName]: abilityName
  };
};
</script>

<template>
  <div class="custom-cup-builder">
    <MetaControls />

    <TeamWorkbench
      :all-pokemon="allPokemon"
      :filtered-pokemon="filteredPokemon"
    />

    <MetaAnalysisGrid
      :pokemon="filteredPokemon"
      :selected-types-count="selectedTypes.length"
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
