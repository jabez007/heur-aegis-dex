<script setup lang="ts">
import { ALL_TYPES, useMetaFilters } from '../composables/useMetaFilters';

const { 
  selectedTypes, 
  hideEmptyTypes, 
  toggleType, 
  clearTypes, 
  selectAll, 
  setPreset 
} = useMetaFilters();
</script>

<template>
  <section class="gba-container">
    <h2>Dynamic Cup Builder</h2>
    <p>Select allowed types to define a custom cup meta.</p>
    
    <div class="type-selectors">
      <button 
        v-for="type in ALL_TYPES" 
        :key="type"
        type="button"
        class="gba-btn type-btn"
        :class="{ active: selectedTypes.includes(type) }"
        :aria-pressed="selectedTypes.includes(type)"
        @click="toggleType(type)"
      >
        {{ type }}
      </button>
    </div>

    <div class="cup-actions">
      <button
        type="button"
        class="gba-btn action-btn"
        @click="selectAll"
      >
        Select All
      </button>
      <button
        type="button"
        class="gba-btn action-btn"
        @click="clearTypes"
      >
        Clear All
      </button>
      <button
        type="button"
        class="gba-btn action-btn"
        @click="setPreset('boulder')"
      >
        Boulder Cup Preset
      </button>
      <button
        type="button"
        class="gba-btn action-btn"
        @click="setPreset('twilight')"
      >
        Twilight Cup Preset
      </button>
      
      <label class="gba-checkbox">
        <input
          v-model="hideEmptyTypes"
          type="checkbox"
        >
        Hide Empty Types
      </label>
    </div>
  </section>
</template>

<style lang="scss" scoped>
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
  
  &.active {
    background-color: var(--gba-accent-yellow);
  }
}

.cup-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 2px dashed var(--gba-text-dark);
}

.gba-checkbox {
  font-family: var(--gba-font-heading);
  font-size: 1.2rem;
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  
  input {
    width: 18px;
    height: 18px;
    cursor: pointer;
    accent-color: var(--gba-accent-magenta);
  }
}

.action-btn {
  background-color: var(--gba-accent-magenta);
  color: var(--gba-text-light);
  border-color: var(--gba-text-dark);
}
</style>
