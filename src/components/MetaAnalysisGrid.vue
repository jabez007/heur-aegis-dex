<script setup lang="ts">
import { ref } from 'vue';
import PokemonCard from './PokemonCard.vue';

const props = defineProps<{
  filteredTypes: any[];
}>();

const visibleCount = ref(20);
const showMore = () => {
  visibleCount.value += 20;
};
</script>

<template>
  <section class="gba-container" v-if="filteredTypes.length > 0">
    <h2>Meta Analysis: Top Typing</h2>
    <p>Ranked by Balance (High Coverage vs. Low Weaknesses).</p>
    
    <div class="type-grid">
      <PokemonCard 
        v-for="t in filteredTypes.slice(0, visibleCount)" 
        :key="t.name" 
        :type-data="t"
      />
    </div>

    <div class="grid-actions" v-if="filteredTypes.length > visibleCount">
      <button class="gba-btn action-btn show-more-btn" @click="showMore">
        Show More ({{ filteredTypes.length - visibleCount }} Left)
      </button>
    </div>
  </section>
</template>

<style lang="scss" scoped>
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
  border-top: 2px dashed var(--text-dark);
}

.show-more-btn {
  width: 100%;
  max-width: 400px;
}

.action-btn {
  background-color: var(--accent-magenta);
  color: var(--text-light);
  border-color: var(--text-dark);
}
</style>
