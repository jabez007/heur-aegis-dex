<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue';
import PokemonCard from './PokemonCard.vue';
import type { PokemonEntry } from '../lib/pokemonEntry';

const props = defineProps<{
  pokemon: PokemonEntry[];
  selectedTypesCount: number;
}>();

const emit = defineEmits<{
  (e: 'update:selected-ability-name', pokemonName: string, abilityName: string): void;
}>();

/** Cards revealed per page, and the count a new result set starts at. */
const PAGE_SIZE = 20;

const visibleCount = ref(PAGE_SIZE);
const searchQuery = ref('');
const searchInputId = `pokemon-browser-search-${useId().replace(/:/g, '')}`;

const searchTerms = computed(() =>
  searchQuery.value.toLocaleLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
);

const filteredPokemon = computed(() => {
  if (searchTerms.value.length === 0) return props.pokemon;

  return props.pokemon.filter((entry) => {
    const searchable = `${entry.name} ${entry.speciesName}`.toLocaleLowerCase();
    return searchTerms.value.every((term) => searchable.includes(term));
  });
});

/**
 * Which Pokemon are on the list, deliberately blind to what order they are in.
 *
 * The list arrives already ranked, and it is re-ranked live: picking an ability
 * on a card re-scores that Pokemon and re-sorts everything around it. Watching
 * the array identity treated that as a new result set and sent the user back to
 * the first twenty cards — so changing an ability on card 70 scrolled the card
 * being edited out of existence. Sorting the names makes a re-rank invisible
 * here while a genuine change of pool still resets the page.
 */
const membershipKey = computed(() => {
  const names = props.pokemon.map((entry) => entry.name);
  names.sort();
  return names.join('|');
});

watch([membershipKey, searchQuery], () => {
  visibleCount.value = PAGE_SIZE;
});

const showMore = () => {
  visibleCount.value += PAGE_SIZE;
};

const clearSearch = () => {
  searchQuery.value = '';
};

const updateSelectedAbilityName = (pokemonName: string, abilityName: string) => {
  emit('update:selected-ability-name', pokemonName, abilityName);
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
        <div class="browser-search">
          <label
            class="gba-label"
            :for="searchInputId"
          >Find a Pokemon</label>
          <div class="search-row">
            <input
              :id="searchInputId"
              v-model="searchQuery"
              class="gba-input search-input"
              type="search"
              autocomplete="off"
              placeholder="Feraligatr"
            >
            <button
              v-if="searchQuery"
              class="gba-btn clear-search"
              type="button"
              @click="clearSearch"
            >
              Clear
            </button>
          </div>
        </div>

        <p>
          <template v-if="searchTerms.length">
            {{ filteredPokemon.length }} of {{ pokemon.length }} Pokemon match.
          </template>
          <template v-else>
            {{ pokemon.length }} Pokemon.
          </template>
          Ranked by overall candidate quality:
          offense, effective bulk, Speed, typing, abilities, and usable coverage.
        </p>

        <div
          v-if="filteredPokemon.length === 0"
          class="empty-state search-empty"
        >
          <p class="status-msg">
            No Pokemon match "{{ searchQuery.trim() }}".
          </p>
          <p>Try a species, form, or shorter name.</p>
        </div>

        <TransitionGroup
          v-else
          name="grid-fade"
          tag="div"
          class="type-grid"
        >
          <PokemonCard
            v-for="entry in filteredPokemon.slice(0, visibleCount)"
            :key="entry.name"
            :pokemon="entry"
            @update:selected-ability-name="updateSelectedAbilityName(entry.name, $event)"
          />
        </TransitionGroup>

        <div
          v-if="filteredPokemon.length > visibleCount"
          class="grid-actions"
        >
          <button
            class="gba-btn action-btn show-more-btn"
            @click="showMore"
          >
            Show More ({{ filteredPokemon.length - visibleCount }} Left)
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

.browser-search {
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 2px dashed var(--gba-text-dark);
}

.search-row {
  display: flex;
  align-items: stretch;
  gap: 8px;
  margin-top: 6px;
}

.search-input {
  width: min(100%, 420px);
  min-height: 40px;
  box-sizing: border-box;
}

.clear-search {
  font-size: 0.85rem;
  padding: 4px 10px;
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

.search-empty {
  margin-bottom: 16px;
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

@media (max-width: 560px) {
  .search-row {
    flex-direction: column;
  }

  .search-input,
  .clear-search {
    width: 100%;
    min-height: 44px;
  }
}
</style>
