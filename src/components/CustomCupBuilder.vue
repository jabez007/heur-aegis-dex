<template>
  <div class="custom-cup-builder">
    <section class="gba-container">
      <h2>Dynamic Cup Builder</h2>
      <p>Select allowed types to define a custom cup meta.</p>
      
      <div class="type-selectors">
        <button 
          v-for="type in ALL_TYPES" 
          :key="type"
          class="gba-btn type-btn"
          :class="{ active: selectedTypes.includes(type) }"
          @click="toggleType(type)"
        >
          {{ type }}
        </button>
      </div>

      <div class="cup-actions">
        <button class="gba-btn action-btn" @click="selectAll">Select All</button>
        <button class="gba-btn action-btn" @click="clearTypes">Clear All</button>
        <button class="gba-btn action-btn" @click="setPreset('boulder')">Boulder Cup Preset</button>
        <button class="gba-btn action-btn" @click="setPreset('twilight')">Twilight Cup Preset</button>
        
        <label class="gba-checkbox">
          <input type="checkbox" v-model="hideEmptyTypes" />
          Hide Empty Types
        </label>
      </div>
    </section>

    <section class="gba-container" v-if="filteredTypes.length > 0">
      <h2>Meta Analysis: Top Typing</h2>
      <p>Ranked by Balance (High Coverage vs. Low Weaknesses).</p>
      
      <div class="type-grid">
        <div v-for="t in filteredTypes.slice(0, visibleCount)" :key="t.name" class="type-card">
          <h3 class="type-header">
            <span v-for="part in t.name.split('/')" :key="part" class="header-type-tag" :class="'bg-' + part">
              {{ part }}
            </span>
          </h3>
          <div class="stats">
            <div class="score-grid">
              <p class="score">Def: {{ t.damage_from_score }}</p>
              <p class="score">Off: {{ t.damage_to_score }}</p>
            </div>
            
            <div class="weakness-list" v-if="t.weaknesses.length - (t.quadruple_weaknesses ? t.quadruple_weaknesses.length : 0) > 0">
              <p>Weaknesses:</p>
              <span v-for="w in t.weaknesses.filter((w: string) => !(t.quadruple_weaknesses || []).includes(w))" :key="w" class="type-tag" :class="'bg-' + w">
                {{ w }}
              </span>
            </div>
            
            <div class="weakness-list" v-if="t.quadruple_weaknesses && t.quadruple_weaknesses.length > 0">
              <p>Quad Weaknesses:</p>
              <span v-for="w in t.quadruple_weaknesses" :key="w" class="type-tag quad" :class="'bg-' + w">
                {{ w }}
              </span>
            </div>

            <div class="weakness-list" v-if="t.coverages.length > 0">
              <p>Coverage:</p>
              <span v-for="c in t.coverages" :key="c" class="type-tag" :class="'bg-' + c">
                {{ c }}
              </span>
            </div>
          </div>
          <div class="pokemon-list" v-if="t.pokemon.length > 0">
            <div class="pokemon-selector">
              <button class="arrow-btn" @click="prevPokemon(t.name, t.pokemon.length)" v-if="t.pokemon.length > 1">◀</button>
              <img v-if="t.pokemon[getPokemonIndex(t.name)].sprite" :src="t.pokemon[getPokemonIndex(t.name)].sprite" :alt="t.pokemon[getPokemonIndex(t.name)].pokemon.name" class="pixel-sprite"/>
              <button class="arrow-btn" @click="nextPokemon(t.name, t.pokemon.length)" v-if="t.pokemon.length > 1">▶</button>
            </div>
            <div class="poke-name-wrapper">
              <p class="poke-name">{{ t.pokemon[getPokemonIndex(t.name)].pokemon.name }}</p>
              <button class="gba-btn mini-btn" @click="toggleStats(t.name)">
                {{ showStats[t.name] ? 'Hide' : 'Stats' }}
              </button>
            </div>
            
            <p class="poke-count" v-if="t.pokemon.length > 1">{{ getPokemonIndex(t.name) + 1 }} / {{ t.pokemon.length }}</p>

            <div v-if="showStats[t.name]" class="stat-bars">
              <div v-for="(val, stat) in t.pokemon[getPokemonIndex(t.name)].stats" :key="stat" class="stat-row">
                <span class="stat-label">{{ (stat as string).replace('special-', 'S').substring(0, 3).toUpperCase() }}:</span>
                <div class="bar-container">
                  <div class="bar" :style="{ width: Math.min(100, (val / 150 * 100)) + '%', backgroundColor: getStatColor(val) }"></div>
                </div>
                <span class="stat-val">{{ val }}</span>
              </div>
            </div>
          </div>
          <div v-else>
            <p class="poke-name">No Pokemon found</p>
          </div>
        </div>
      </div>

      <div class="grid-actions" v-if="filteredTypes.length > visibleCount">
        <button class="gba-btn action-btn show-more-btn" @click="showMore">
          Show More ({{ filteredTypes.length - visibleCount }} Left)
        </button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

const props = defineProps<{
  allDataTypes: any[]
}>();

const ALL_TYPES = [
  'normal', 'fighting', 'flying', 'poison', 'ground', 'rock', 'bug', 'ghost', 'steel',
  'fire', 'water', 'grass', 'electric', 'psychic', 'ice', 'dragon', 'dark', 'fairy'
];

const selectedTypes = ref<string[]>([...ALL_TYPES]);

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

const hideEmptyTypes = ref(true);

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

const selectedPokemonIndexes = ref<Record<string, number>>({});

const getPokemonIndex = (typeName: string) => selectedPokemonIndexes.value[typeName] || 0;

const prevPokemon = (typeName: string, maxLength: number) => {
  const currentIndex = getPokemonIndex(typeName);
  selectedPokemonIndexes.value[typeName] = (currentIndex - 1 + maxLength) % maxLength;
};

const nextPokemon = (typeName: string, maxLength: number) => {
  const currentIndex = getPokemonIndex(typeName);
  selectedPokemonIndexes.value[typeName] = (currentIndex + 1) % maxLength;
};

const showStats = ref<Record<string, boolean>>({});
const toggleStats = (typeName: string) => {
  showStats.value[typeName] = !showStats.value[typeName];
};

const getStatColor = (value: number) => {
  if (value < 60) return '#f34444'; // Red
  if (value < 90) return '#ffdd57'; // Yellow
  if (value < 120) return '#a0e515'; // Light Green
  return '#23cd5e'; // Deep Green
};

const visibleCount = ref(20);
const showMore = () => {
  visibleCount.value += 20;
};
</script>

<style lang="scss" scoped>
.custom-cup-builder {
  width: 100%;
}

.type-selectors {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
  margin-bottom: 16px;
}

.type-btn {
  font-size: 1rem;
  padding: 4px 8px;
}

.cup-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 2px dashed var(--text-dark);
}

.gba-checkbox {
  font-family: var(--font-heading);
  font-size: 1.2rem;
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  
  input {
    width: 18px;
    height: 18px;
    cursor: pointer;
    accent-color: var(--accent-magenta);
  }
}

.action-btn {
  background-color: var(--accent-magenta);
  color: var(--text-light);
  border-color: var(--text-dark);
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
  border-top: 2px dashed var(--text-dark);
}

.show-more-btn {
  width: 100%;
  max-width: 400px;
}

.type-card {
  border: 2px solid var(--text-dark);
  padding: 8px;
  background: rgba(255,255,255,0.1);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.type-header {
  margin: 0;
  width: 100%;
  border-bottom: 2px solid var(--text-dark);
  padding-bottom: 8px;
  margin-bottom: 8px;
  display: flex;
  justify-content: center;
  gap: 4px;
  flex-wrap: wrap;
}

.header-type-tag {
  padding: 4px 12px;
  font-size: 1rem;
  text-transform: uppercase;
  color: #fff;
  text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
  border: 3px solid var(--text-dark);
  box-shadow: 2px 2px 0px var(--text-dark);
  font-family: var(--font-heading);
}

.pixel-sprite {
  image-rendering: pixelated;
  width: 96px;
  height: 96px;
}

.poke-name {
  text-transform: capitalize;
  font-family: var(--font-heading);
  font-size: 1.2rem;
  margin: 0;
}

.poke-name-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 4px;
}

.poke-count {
  font-size: 0.8rem;
  margin: 2px 0 0 0;
  opacity: 0.8;
}

.mini-btn {
  font-size: 0.7rem;
  padding: 2px 6px;
  background-color: var(--accent-cyan);
}

.stat-bars {
  width: 100%;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--text-dark);
  text-align: left;
}

.stat-row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 2px;
}

.stat-label {
  font-family: var(--font-heading);
  font-size: 0.8rem;
  width: 35px;
  text-align: right;
}

.bar-container {
  flex-grow: 1;
  height: 8px;
  background: rgba(0,0,0,0.1);
  border: 1px solid var(--text-dark);
}

.bar {
  height: 100%;
  transition: width 0.3s ease;
}

.stat-val {
  font-family: var(--font-body);
  font-size: 0.7rem;
  width: 25px;
}

.score {
  font-weight: bold;
  margin: 0;
}

.score-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  width: 100%;
  gap: 8px;
  margin-bottom: 8px;
  border-bottom: 1px dashed var(--text-dark);
  padding-bottom: 4px;
}

.weakness-list {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 4px;
  margin-bottom: 8px;
  
  p {
    width: 100%;
    margin: 0 0 4px 0;
    font-size: 0.9rem;
  }
}

.type-tag {
  padding: 2px 8px;
  font-size: 0.8rem;
  text-transform: uppercase;
  color: #fff;
  text-shadow: 1px 1px 0px rgba(0,0,0,0.8);
  border: 2px solid var(--text-dark);
  box-shadow: 1px 1px 0px var(--text-dark);
  margin: 2px;
  
  &.quad {
    border: 2px dashed var(--accent-yellow);
    box-shadow: 2px 2px 0px var(--accent-magenta);
    transform: scale(1.05);
    animation: quad-pulse 1s infinite alternate;
  }
}

@keyframes quad-pulse {
  from { transform: scale(1.05) rotate(-2deg); }
  to { transform: scale(1.1) rotate(2deg); }
}
</style>
