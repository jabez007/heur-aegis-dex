<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import TypeBadge from './TypeBadge.vue';
import StatBar from './StatBar.vue';
import { useTeamBuilder } from '../composables/useTeamBuilder';
import type { PokemonEntry } from '../lib/pokemonEntry';

const props = defineProps<{
  pokemon: PokemonEntry;
}>();

const emit = defineEmits<{
  (e: 'update:selected-ability-name', abilityName: string): void;
}>();

const {
  addPokemon,
  hasSpecies,
  roster,
  maxRosterSize,
  isExcludedFromGeneration,
  toggleGenerationExclusion
} = useTeamBuilder();

const selectedAbilityName = ref(props.pokemon.abilityName);
const showStats = ref(false);

// The card is keyed by Pokemon name in the grid, but a filter change can swap
// the entry under a reused card, so the ability follows the current Pokemon.
watch(() => props.pokemon, (pokemon) => {
  selectedAbilityName.value = pokemon.abilityName || pokemon.abilities[0]?.name || '';
}, { immediate: true });

watch(selectedAbilityName, (abilityName) => {
  if (abilityName && abilityName !== props.pokemon.abilityName) {
    emit('update:selected-ability-name', abilityName);
  }
});

const availableAbilities = computed(() => props.pokemon.abilities);

// A stat line that does not match the Pokedex has to explain itself, or it just
// reads as wrong.
const statAbilityNote = computed(() => {
  const ability = props.pokemon.statAbilityName;
  if (!ability) return null;

  const changed = Object.keys(props.pokemon.stats)
    .filter((stat) => props.pokemon.stats[stat] !== props.pokemon.baseStats[stat])
    .map((stat) => `${stat} ${props.pokemon.baseStats[stat]} to ${props.pokemon.stats[stat]}`);

  return {
    label: `${ability} applied`,
    title: changed.length > 0
      ? `Stats shown include ${ability}: ${changed.join(', ')}.`
      : `Stats shown include ${ability}.`
  };
});
const isOnRoster = computed(() => hasSpecies(props.pokemon.speciesName));
const rosterIsFull = computed(() => roster.value.length >= maxRosterSize.value);
const isExcluded = computed(() => isExcludedFromGeneration(props.pokemon.name));

const displayWeaknesses = computed(() => props.pokemon.weaknesses);
const displayQuadrupleWeaknesses = computed(() => props.pokemon.quadrupleWeaknesses);
const displayCoverages = computed(() => props.pokemon.coverages);
const displayMoveCoverages = computed(() =>
  props.pokemon.moveCoverages.filter((type) => !props.pokemon.coverages.includes(type))
);

const defenseScore = computed(() => props.pokemon.normalizedDamageFromScore.toFixed(2));
const offenseScore = computed(() => props.pokemon.normalizedDamageToScore.toFixed(2));
const defenseHint = computed(() => [
  `Defense ${defenseScore.value} out of 1 // lower is better`,
  '',
  'Measures this typing and selected ability against all 18 attacking types.',
  'Weaknesses raise the score; 4x weaknesses raise it further.',
  'Resistances and immunities lower it.',
  '',
  'Normalized across real defensive profiles: 0 is strongest, 1 is weakest.'
].join('\n'));
const offenseHint = computed(() => [
  `Offense ${offenseScore.value} out of 1 // higher is better`,
  '',
  'Measures this Pokemon\'s STAB typing against all 18 defending types.',
  'Super-effective targets raise the score; resisted and immune targets lower it.',
  '',
  'Reachable move coverage is shown separately below and does not change this score.',
  'Normalized across real offensive typings: 0 is narrowest, 1 is broadest.'
].join('\n'));
const toggleStats = () => {
  showStats.value = !showStats.value;
};

const handleAddToRoster = () => {
  addPokemon(props.pokemon, selectedAbilityName.value);
};

const handleToggleExclusion = () => {
  toggleGenerationExclusion(props.pokemon.name);
};
</script>

<template>
  <div
    class="type-card"
    :class="{ rostered: isOnRoster, excluded: isExcluded }"
  >
    <div class="card-header">
      <img
        v-if="pokemon.sprite"
        :src="pokemon.sprite"
        :alt="pokemon.name"
        class="pixel-sprite"
      >
      <div class="card-title">
        <p class="poke-name">
          {{ pokemon.name }}
        </p>
        <p
          v-if="pokemon.battleFormName"
          class="battle-form-note"
          :title="`Registered as ${pokemon.name}, but it spends the battle as ${pokemon.battleFormName}, so the stats below are that form's.`"
        >
          rated as {{ pokemon.battleFormName }}
        </p>
        <p
          v-if="statAbilityNote"
          class="battle-form-note"
          :title="statAbilityNote.title"
        >
          {{ statAbilityNote.label }}
        </p>
        <h3 class="type-header">
          <TypeBadge
            v-for="part in pokemon.types"
            :key="part"
            :type="part"
            size="header"
          />
        </h3>
      </div>
    </div>

    <div class="stats">
      <div class="score-grid">
        <p
          class="score"
          tabindex="0"
          :title="defenseHint"
          :aria-label="defenseHint"
        >
          Def: {{ defenseScore }}
        </p>
        <p
          class="score"
          tabindex="0"
          :title="offenseHint"
          :aria-label="offenseHint"
        >
          Off: {{ offenseScore }}
        </p>
      </div>

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
        <p>STAB Coverage:</p>
        <TypeBadge
          v-for="c in displayCoverages"
          :key="c"
          :type="c"
        />
      </div>

      <div
        v-if="displayMoveCoverages.length > 0"
        class="weakness-list move-coverage"
      >
        <p>Reachable:</p>
        <TypeBadge
          v-for="c in displayMoveCoverages"
          :key="c"
          :type="c"
        />
      </div>
    </div>

    <div class="pokemon-list">
      <div
        v-if="availableAbilities.length > 1"
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
            :aria-label="`Select ability for ${pokemon.name}`"
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
      <p
        v-else-if="pokemon.abilityName"
        class="ability-single"
      >
        Ability: {{ pokemon.abilityName }}
      </p>

      <div class="poke-actions">
        <button
          class="gba-btn mini-btn"
          :aria-label="`${showStats ? 'Hide' : 'Show'} stats for ${pokemon.name}`"
          @click="toggleStats"
        >
          {{ showStats ? 'Hide' : 'Stats' }}
        </button>
        <button
          class="gba-btn mini-btn exclude-btn"
          :class="{ active: isExcluded }"
          :aria-pressed="isExcluded"
          :aria-label="isExcluded
            ? `Allow ${pokemon.name} in generated rosters`
            : `Exclude ${pokemon.name} from generated rosters`"
          @click="handleToggleExclusion"
        >
          {{ isExcluded ? 'Excluded' : 'Exclude' }}
        </button>
        <button
          class="gba-btn mini-btn party-btn"
          :disabled="rosterIsFull || isOnRoster"
          :aria-label="isOnRoster ? `${pokemon.name} is already on the roster` : `Add ${pokemon.name} to roster`"
          @click="handleAddToRoster"
        >
          {{ isOnRoster ? 'On Roster' : '+ Roster' }}
        </button>
      </div>

      <Transition name="wipe">
        <div
          v-if="showStats"
          class="stat-bars"
        >
          <StatBar
            v-for="(val, stat) in pokemon.stats"
            :key="stat"
            :label="(stat as string).replace('special-', 'S').substring(0, 3)"
            :value="val"
          />
        </div>
      </Transition>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.card-title {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.card-title .poke-name {
  margin: 0;
  word-break: break-word;
}

/* Reachable coverage recedes: it is what the Pokemon *can* do with a moveslot,
   not what it threatens off STAB. */
.move-coverage {
  opacity: 0.7;
}

.type-card.rostered {
  outline: 3px solid var(--gba-accent-cyan);
  outline-offset: 2px;
}

.type-card.excluded {
  border-color: var(--gba-accent-magenta);
  background:
    repeating-linear-gradient(
      -45deg,
      rgba(255,255,255,0.1) 0,
      rgba(255,255,255,0.1) 8px,
      rgba(255,0,128,0.06) 8px,
      rgba(255,0,128,0.06) 16px
    );
}

.ability-single {
  font-family: var(--gba-font-body);
  font-size: 0.75rem;
  opacity: 0.8;
  margin: 4px 0;
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

.score[tabindex] {
  cursor: help;
  text-decoration: underline dotted;
  text-underline-offset: 3px;
}

.score[tabindex]:focus-visible {
  outline: 3px solid var(--gba-accent-cyan);
  outline-offset: 2px;
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

// The stats below are not the registered form's, and the card has to say so.
.battle-form-note {
  font-family: var(--gba-font-body);
  font-size: 0.85rem;
  text-transform: uppercase;
  color: var(--gba-accent-magenta);
  margin: 2px 0 0;
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

.exclude-btn {
  background-color: rgba(255,255,255,0.45);
}

.exclude-btn.active {
  color: white;
  background-color: var(--gba-accent-magenta);
}

.poke-actions {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
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
