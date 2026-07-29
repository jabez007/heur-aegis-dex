<script setup lang="ts">
import { ref, watch } from 'vue';
import PokemonCard from './PokemonCard.vue';
import type { PokemonEntry } from '../lib/pokemonEntry';

const props = defineProps<{
  pokemon: PokemonEntry[];
  selectedTypesCount: number;
}>();

const emit = defineEmits<{
  (e: 'update:selected-ability-name', pokemonName: string, abilityName: string): void;
}>();

const visibleCount = ref(20);

watch(() => props.pokemon, () => {
  visibleCount.value = 20;
});

const showMore = () => {
  visibleCount.value += 20;
};
</script>

<template>
  <section class="gba-container">
    <h2>Pokemon Browser</h2>
    
    <Transition
      name="state-fade"
      mode="out-in"
    >
      <div
        v-if="selectedTypesCount === 0"
        key="no-types"
        class="empty-state"
      >
        <p class="status-msg">
          No types selected.
        </p>
        <p>Please select at least one type in the Cup Builder to begin the scan.</p>
      </div>
      
      <div
        v-else-if="pokemon.length === 0"
        key="no-pokemon"
        class="empty-state"
      >
        <p class="status-msg">
          No compatible Pokemon found.
        </p>
        <p>Try adjusting your stat filters or region, or uncheck "Require All Types".</p>
      </div>

      <div
        v-else
        key="results"
        class="results-container"
      >
        <p>{{ pokemon.length }} Pokemon, ranked by balance (high coverage vs. low weaknesses).</p>

        <TransitionGroup
          name="grid-fade"
          tag="div"
          class="type-grid"
        >
          <PokemonCard
            v-for="entry in pokemon.slice(0, visibleCount)"
            :key="entry.name"
            :pokemon="entry"
            @update:selected-ability-name="(abilityName) => emit('update:selected-ability-name', entry.name, abilityName)"
          />
        </TransitionGroup>

        <div
          v-if="pokemon.length > visibleCount"
          class="grid-actions"
        >
          <button
            class="gba-btn action-btn show-more-btn"
            @click="showMore"
          >
            Show More ({{ pokemon.length - visibleCount }} Left)
          </button>
        </div>
      </div>
    </Transition>
  </section>
</template>

<style lang="scss" scoped>
.state-fade-enter-active,
.state-fade-leave-active {
  transition: all 0.25s steps(4);
}
.state-fade-enter-from,
.state-fade-leave-to {
  opacity: 0;
  transform: scale(0.98);
}

.results-container {
  width: 100%;
}

.empty-state {
  text-align: center;
  padding: 32px 16px;
  border: 2px dashed var(--gba-text-dark);
  background: rgba(0,0,0,0.05);
  margin-top: 16px;
  
  .status-msg {
    font-family: var(--gba-font-heading);
    font-size: 1.5rem;
    color: var(--gba-accent-magenta);
    margin-bottom: 8px;
  }
  
  p {
    margin: 0;
    opacity: 0.8;
  }
}

.grid-fade-move,
.grid-fade-enter-active,
.grid-fade-leave-active {
  transition: transform 0.3s steps(5), opacity 0.3s steps(5);
}

.grid-fade-leave-active {
  position: absolute;
}

.grid-fade-enter-from,
.grid-fade-leave-to {
  opacity: 0;
  transform: translateY(20px) scale(0.95);
}

.type-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 16px;
  margin-top: 16px;
}

.grid-actions {
  display: flex;
  justify-content: center;
  margin-top: 24px;
  padding-top: 16px;
  border-top: 2px dashed var(--gba-text-dark);
}

.show-more-btn {
  width: 100%;
  max-width: 400px;
}

.action-btn {
  background-color: var(--gba-accent-magenta);
  color: var(--gba-text-light);
  border-color: var(--gba-text-dark);
}
</style>
