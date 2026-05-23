<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import TypeBadge from './TypeBadge.vue';
import StatBar from './StatBar.vue';
import { useTeamBuilder } from '../composables/useTeamBuilder';
import type { ActiveTypeDataLike } from '../lib/activePokemon';
import type { PokemonListEntry } from '../lib/pokedexTypes';

const props = defineProps<{
  typeData: ActiveTypeDataLike;
}>();

const emit = defineEmits<{
  (e: 'update:selected-pokemon-index', nextIndex: number): void;
  (e: 'update:selected-ability-name', abilityName: string): void;
}>();

const { addToParty, currentParty } = useTeamBuilder();

const selectedPokemonIndex = ref(0);
const selectedAbilityName = ref('');
const showStats = ref(false);
const pokemonList = computed(() => props.typeData.pokemon);
const currentPokemon = computed(() => pokemonList.value[selectedPokemonIndex.value] || null);
const availableAbilities = computed(() => currentPokemon.value?.abilities || []);

watch([pokemonList, () => props.typeData.selected_pokemon_index], ([newList, selectedIndex]) => {
  const maxLength = newList.length;
  if (maxLength > 0) {
    selectedPokemonIndex.value = Math.min(Number(selectedIndex ?? 0), maxLength - 1);
  } else {
    selectedPokemonIndex.value = 0;
  }
}, { immediate: true });

const prevPokemon = () => {
  const maxLength = props.typeData.pokemon.length;
  const nextIndex = (selectedPokemonIndex.value - 1 + maxLength) % maxLength;
  selectedPokemonIndex.value = nextIndex;
  emit('update:selected-pokemon-index', nextIndex);
};

const nextPokemon = () => {
  const maxLength = pokemonList.value.length;
  const nextIndex = (selectedPokemonIndex.value + 1) % maxLength;
  selectedPokemonIndex.value = nextIndex;
  emit('update:selected-pokemon-index', nextIndex);
};

const selectedPokemon = computed<PokemonListEntry | null>(() => currentPokemon.value);

watch([selectedPokemon, () => props.typeData.selected_ability_name], ([pokemon, abilityName]) => {
  if (!pokemon) {
    selectedAbilityName.value = '';
    return;
  }

  selectedAbilityName.value = String(abilityName || pokemon.selected_ability_name || pokemon.abilities?.[0]?.name || '');
}, { immediate: true });

watch(selectedAbilityName, (abilityName) => {
  emit('update:selected-ability-name', abilityName);
});

const selectedAbilityProfile = computed(() => {
  const pokemon = selectedPokemon.value;
  if (!pokemon) return null;
  return pokemon.ability_profiles?.[selectedAbilityName.value] || null;
});

const selectedPokemonName = computed(() => selectedPokemon.value?.pokemon?.name || 'pokemon');
const scoreSummary = computed(() => `Defense score ${displayDamageFromScore.value}, offense score ${props.typeData.damage_to_score}`);

const displayWeaknesses = computed(() => selectedAbilityProfile.value?.weaknesses || selectedPokemon.value?.effective_weaknesses || props.typeData.weaknesses || []);
const displayQuadrupleWeaknesses = computed(() => selectedAbilityProfile.value?.quadruple_weaknesses || selectedPokemon.value?.effective_quadruple_weaknesses || props.typeData.quadruple_weaknesses || []);
const displayCoverages = computed(() => selectedAbilityProfile.value?.coverages || selectedPokemon.value?.effective_coverages || props.typeData.coverages || []);
const displayDamageFromScore = computed(() => selectedAbilityProfile.value?.damage_from_score ?? selectedPokemon.value?.effective_damage_from_score ?? props.typeData.damage_from_score);

const toggleStats = () => {
  showStats.value = !showStats.value;
};

const handleAddToParty = () => {
  addToParty(props.typeData, selectedPokemonIndex.value, selectedAbilityName.value);
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
        <p
          class="score"
          :aria-label="`Defense score ${displayDamageFromScore}`"
        >
          Def: {{ displayDamageFromScore }}
        </p>
        <p
          class="score"
          :aria-label="`Offense score ${typeData.damage_to_score}`"
        >
          Off: {{ typeData.damage_to_score }}
        </p>
      </div>
      <span class="sr-only">{{ scoreSummary }}</span>
      
      <div
        v-if="displayWeaknesses.length - displayQuadrupleWeaknesses.length > 0"
        class="weakness-list"
      >
        <p>Weaknesses:</p>
        <TypeBadge 
          v-for="w in displayWeaknesses.filter((w: string) => !displayQuadrupleWeaknesses.includes(w))" 
          :key="w" 
          :type="w" 
        />
      </div>
      
      <div
        v-if="displayQuadrupleWeaknesses.length > 0"
        class="weakness-list"
      >
        <p>Quad Weaknesses:</p>
        <TypeBadge 
          v-for="w in displayQuadrupleWeaknesses" 
          :key="w" 
          :type="w" 
          is-quad
        />
      </div>

      <div
        v-if="displayCoverages.length > 0"
        class="weakness-list"
      >
        <p>Coverage:</p>
        <TypeBadge 
          v-for="c in displayCoverages" 
          :key="c" 
          :type="c" 
        />
      </div>
    </div>

      <div
        v-if="pokemonList.length > 0 && currentPokemon"
        class="pokemon-list"
      >
      <div class="pokemon-selector">
        <button
          v-if="pokemonList.length > 1"
          class="arrow-btn"
          :aria-label="`Show previous ${typeData.name} Pokemon option`"
          @click="prevPokemon"
        >
          ◀
        </button>
        <img 
          v-if="currentPokemon.sprite"
          :src="currentPokemon.sprite || undefined"
          :alt="currentPokemon.pokemon.name"
          class="pixel-sprite"
        >
        <button
          v-if="pokemonList.length > 1"
          class="arrow-btn"
          :aria-label="`Show next ${typeData.name} Pokemon option`"
          @click="nextPokemon"
        >
          ▶
        </button>
      </div>
      
      <div class="poke-name-wrapper">
        <p class="poke-name">
          {{ currentPokemon.pokemon.name }}
        </p>
      </div>
      
      <div
        v-if="typeData.include_ability_immunities !== false && availableAbilities.length > 1"
        class="ability-panel"
      >
        <div class="ability-panel-header">
          <span class="ability-label">Ability Loadout</span>
          <span class="ability-count">{{ availableAbilities.length }} options</span>
        </div>
        <label class="ability-row">
          <select
            v-model="selectedAbilityName"
            class="ability-select"
            :aria-label="`Select ability for ${selectedPokemonName}`"
          >
            <option
              v-for="ability in availableAbilities"
              :key="ability.name"
              :value="ability.name"
            >
              {{ ability.name }}{{ ability.is_hidden ? ' [Hidden]' : '' }}
            </option>
          </select>
        </label>
      </div>
      
      <div class="poke-actions">
        <button
          class="gba-btn mini-btn"
          :aria-label="`${showStats ? 'Hide' : 'Show'} stats for ${selectedPokemonName}`"
          @click="toggleStats"
        >
          {{ showStats ? 'Hide' : 'Stats' }}
        </button>
        <button 
          class="gba-btn mini-btn party-btn" 
          :disabled="currentParty.length >= 3" 
          :aria-label="`Add ${selectedPokemonName} to party`"
          @click="handleAddToParty"
        >
          + Party
        </button>
      </div>
      
      <p
        v-if="pokemonList.length > 1"
        class="poke-count"
      >
        {{ selectedPokemonIndex + 1 }} / {{ pokemonList.length }}
      </p>

      <Transition name="wipe">
        <div
          v-if="showStats"
          class="stat-bars"
        >
          <StatBar 
            v-for="(val, stat) in currentPokemon.stats" 
            :key="stat"
            :label="(stat as string).replace('special-', 'S').substring(0, 3)"
            :value="val"
          />
        </div>
      </Transition>
    </div>
    <div v-else>
      <p class="poke-name">
        No Pokemon found
      </p>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.type-card {
  border: 2px solid var(--gba-text-dark);
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
  border-bottom: 2px solid var(--gba-text-dark);
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
  font-family: var(--gba-font-heading);
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


.ability-panel {
  width: 100%;
  margin-top: 10px;
  padding: 8px;
  border: 2px solid var(--gba-text-dark);
  background: linear-gradient(180deg, rgba(255,255,255,0.42), rgba(255,255,255,0.18));
  box-sizing: border-box;
}

.ability-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
  padding-bottom: 4px;
  border-bottom: 1px dashed var(--gba-text-dark);
}

.ability-label {
  font-family: var(--gba-font-heading);
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.ability-count {
  font-size: 0.72rem;
  opacity: 0.75;
}

.ability-row {
  display: block;
  width: 100%;
}

.ability-select {
  width: 100%;
  min-height: 34px;
  border: 2px solid var(--gba-text-dark);
  border-radius: 0;
  background: linear-gradient(180deg, rgba(244, 250, 250, 0.98), rgba(198, 222, 222, 0.98));
  color: var(--gba-text-dark);
  font-family: var(--gba-font-heading);
  font-size: 0.82rem;
  line-height: 1.2;
  padding: 6px 28px 6px 8px;
  box-sizing: border-box;
  appearance: none;
  -webkit-appearance: none;
  background-image:
    linear-gradient(45deg, transparent 50%, var(--gba-text-dark) 50%),
    linear-gradient(135deg, var(--gba-text-dark) 50%, transparent 50%),
    linear-gradient(180deg, rgba(255,255,255,0.28), rgba(0,0,0,0));
  background-position:
    calc(100% - 14px) calc(50% - 2px),
    calc(100% - 9px) calc(50% - 2px),
    0 0;
  background-size: 5px 5px, 5px 5px, 100% 100%;
  background-repeat: no-repeat;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.55);
}

.ability-select:focus {
  outline: none;
  border-color: var(--gba-accent-cyan);
  box-shadow: 0 0 0 2px rgba(0, 180, 200, 0.18), inset 0 1px 0 rgba(255,255,255,0.55);
}


.mini-btn {
  font-size: 0.7rem;
  padding: 2px 6px;
  background-color: var(--gba-accent-cyan);
}

.party-btn {
  background-color: var(--gba-accent-yellow);
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
  border-top: 1px dashed var(--gba-text-dark);
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
  border-bottom: 1px dashed var(--gba-text-dark);
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
  color: var(--gba-text-dark);
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0;
  
  &:hover {
    color: var(--gba-accent-magenta);
  }
  
  &:active {
    transform: scale(0.9);
  }
}
</style>
