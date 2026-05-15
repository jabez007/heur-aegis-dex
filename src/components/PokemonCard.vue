<script setup lang="ts">
import { ref } from 'vue';
import TypeBadge from './TypeBadge.vue';
import StatBar from './StatBar.vue';
import { useTeamBuilder } from '../composables/useTeamBuilder';

const props = defineProps<{
  typeData: any;
}>();

const { addToParty, currentParty } = useTeamBuilder();

const selectedPokemonIndex = ref(0);
const showStats = ref(false);

const prevPokemon = () => {
  const maxLength = props.typeData.pokemon.length;
  selectedPokemonIndex.value = (selectedPokemonIndex.value - 1 + maxLength) % maxLength;
};

const nextPokemon = () => {
  const maxLength = props.typeData.pokemon.length;
  selectedPokemonIndex.value = (selectedPokemonIndex.value + 1) % maxLength;
};

const toggleStats = () => {
  showStats.value = !showStats.value;
};

const handleAddToParty = () => {
  addToParty(props.typeData, selectedPokemonIndex.value);
};
</script>

<template>
  <div class="type-card">
    <h3 class="type-header">
      <TypeBadge 
        v-for="part in typeData.name.split('/')" 
        :key="part" 
        :type="part" 
        size="header"
      />
    </h3>
    
    <div class="stats">
      <div class="score-grid">
        <p class="score">Def: {{ typeData.damage_from_score }}</p>
        <p class="score">Off: {{ typeData.damage_to_score }}</p>
      </div>
      
      <div class="weakness-list" v-if="typeData.weaknesses.length - (typeData.quadruple_weaknesses ? typeData.quadruple_weaknesses.length : 0) > 0">
        <p>Weaknesses:</p>
        <TypeBadge 
          v-for="w in typeData.weaknesses.filter((w: string) => !(typeData.quadruple_weaknesses || []).includes(w))" 
          :key="w" 
          :type="w" 
        />
      </div>
      
      <div class="weakness-list" v-if="typeData.quadruple_weaknesses && typeData.quadruple_weaknesses.length > 0">
        <p>Quad Weaknesses:</p>
        <TypeBadge 
          v-for="w in typeData.quadruple_weaknesses" 
          :key="w" 
          :type="w" 
          is-quad
        />
      </div>

      <div class="weakness-list" v-if="typeData.coverages.length > 0">
        <p>Coverage:</p>
        <TypeBadge 
          v-for="c in typeData.coverages" 
          :key="c" 
          :type="c" 
        />
      </div>
    </div>

    <div class="pokemon-list" v-if="typeData.pokemon.length > 0">
      <div class="pokemon-selector">
        <button class="arrow-btn" @click="prevPokemon" v-if="typeData.pokemon.length > 1">◀</button>
        <img 
          v-if="typeData.pokemon[selectedPokemonIndex].sprite" 
          :src="typeData.pokemon[selectedPokemonIndex].sprite" 
          :alt="typeData.pokemon[selectedPokemonIndex].pokemon.name" 
          class="pixel-sprite"
        />
        <button class="arrow-btn" @click="nextPokemon" v-if="typeData.pokemon.length > 1">▶</button>
      </div>
      
      <div class="poke-name-wrapper">
        <p class="poke-name">{{ typeData.pokemon[selectedPokemonIndex].pokemon.name }}</p>
      </div>
      
      <div class="poke-actions">
        <button class="gba-btn mini-btn" @click="toggleStats">
          {{ showStats ? 'Hide' : 'Stats' }}
        </button>
        <button 
          class="gba-btn mini-btn party-btn" 
          @click="handleAddToParty" 
          :disabled="currentParty.length >= 3"
        >
          + Party
        </button>
      </div>
      
      <p class="poke-count" v-if="typeData.pokemon.length > 1">
        {{ selectedPokemonIndex + 1 }} / {{ typeData.pokemon.length }}
      </p>

      <Transition name="wipe">
        <div v-if="showStats" class="stat-bars">
          <StatBar 
            v-for="(val, stat) in typeData.pokemon[selectedPokemonIndex].stats" 
            :key="stat"
            :label="(stat as string).replace('special-', 'S').substring(0, 3)"
            :value="val"
          />
        </div>
      </Transition>
    </div>
    <div v-else>
      <p class="poke-name">No Pokemon found</p>
    </div>
  </div>
</template>

<style lang="scss" scoped>
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

.party-btn {
  background-color: var(--accent-yellow);
}

.poke-actions {
  display: flex;
  justify-content: center;
  gap: 4px;
  margin-top: 8px;
}

.wipe-enter-active,
.wipe-leave-active {
  transition: max-height 0.2s steps(4);
  overflow: hidden;
}
.wipe-enter-from,
.wipe-leave-to {
  max-height: 0;
}
.wipe-enter-to,
.wipe-leave-from {
  max-height: 200px;
}

.stat-bars {
  width: 100%;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--text-dark);
  text-align: left;
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

.pokemon-selector {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.arrow-btn {
  background: transparent;
  border: none;
  color: var(--text-dark);
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0;
  
  &:hover {
    color: var(--accent-magenta);
  }
  
  &:active {
    transform: scale(0.9);
  }
}
</style>
