<script setup lang="ts">
import { useTeamBuilder } from '../composables/useTeamBuilder';
import TypeBadge from './TypeBadge.vue';

const props = defineProps<{
  allDataTypes: any[];
}>();

const { 
  currentParty, 
  isGenerating, 
  teamWeaknessSummary, 
  teamCoverageSummary,
  removeFromParty,
  clearParty,
  fillRemainingSlots
} = useTeamBuilder();
</script>

<template>
  <section class="gba-container team-workbench">
    <div class="workbench-header">
      <h2>Team Workbench</h2>
      <div class="workbench-actions">
        <button 
          class="gba-btn action-btn mini" 
          @click="fillRemainingSlots(allDataTypes)" 
          :disabled="currentParty.length >= 3 || isGenerating"
        >
          {{ isGenerating ? '...' : (currentParty.length === 0 ? 'Generate Team' : 'Auto-Fill Slot') }}
        </button>
        <button 
          class="gba-btn action-btn mini" 
          @click="clearParty" 
          :disabled="currentParty.length === 0 || isGenerating"
        >
          Clear Party
        </button>
      </div>
    </div>
    
    <div class="party-grid">
      <div v-for="(_, index) in 3" :key="index" class="party-slot" :class="{ empty: !currentParty[index] }">
        <template v-if="currentParty[index]">
          <div class="slot-info">
            <img :src="currentParty[index].sprite" :alt="currentParty[index].name" class="pixel-sprite mini"/>
            <div class="slot-text">
              <p class="slot-name">{{ currentParty[index].name }}</p>
              <div class="slot-types">
                <TypeBadge 
                  v-for="type in currentParty[index].types" 
                  :key="type" 
                  :type="type" 
                  size="mini"
                />
              </div>
            </div>
          </div>
          <button class="remove-btn" @click="removeFromParty(index)">×</button>
        </template>
        <template v-else>
          <p class="empty-text">Slot {{ index + 1 }} Empty</p>
        </template>
      </div>
    </div>

    <div class="team-analysis" v-if="currentParty.length > 0">
      <div class="analysis-grid">
        <div class="analysis-col">
          <p class="analysis-label">Team Weaknesses:</p>
          <div class="type-badge-list">
            <TypeBadge 
              v-for="(count, type) in teamWeaknessSummary" 
              :key="type" 
              :type="type" 
              size="mini"
            >
              {{ type }} {{ count > 1 ? 'x' + count : '' }}
            </TypeBadge>
            <p v-if="Object.keys(teamWeaknessSummary).length === 0" class="none-text">None! Excellent.</p>
          </div>
        </div>
        <div class="analysis-col">
          <p class="analysis-label">Team Coverage:</p>
          <div class="type-badge-list">
            <TypeBadge 
              v-for="(count, type) in teamCoverageSummary" 
              :key="type" 
              :type="type" 
              size="mini"
            >
              {{ type }} {{ count > 1 ? 'x' + count : '' }}
            </TypeBadge>
            <p v-if="Object.keys(teamCoverageSummary).length === 0" class="none-text">None yet.</p>
          </div>
        </div>
      </div>
    </div>
    <div class="team-analysis" v-else>
      <p class="hint-text">Add Pokemon from the Meta Analysis below to build your team.</p>
    </div>
  </section>
</template>

<style lang="scss" scoped>
.team-workbench {
  background-color: var(--gba-screen-bg);
  border: 4px solid var(--gba-screen-border);
  margin-bottom: 24px;
  
  .workbench-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 2px solid var(--text-dark);
    padding-bottom: 8px;
    margin-bottom: 16px;
    
    h2 { margin: 0; }
  }
}

.party-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.party-slot {
  border: 2px solid var(--text-dark);
  background: rgba(255,255,255,0.2);
  min-height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  padding: 8px;
  
  &.empty {
    border: 2px dashed rgba(0,0,0,0.2);
    background: rgba(0,0,0,0.05);
  }
}

.slot-info {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.pixel-sprite.mini {
  width: 64px;
  height: 64px;
  image-rendering: pixelated;
}

.slot-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.slot-name {
  font-family: var(--font-heading);
  font-size: 1.1rem;
  text-transform: capitalize;
  margin: 0;
}

.slot-types {
  display: flex;
  gap: 4px;
}

.remove-btn {
  position: absolute;
  top: -10px;
  right: -10px;
  background: var(--accent-magenta);
  color: white;
  border: 2px solid var(--text-dark);
  border-radius: 50%;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-weight: bold;
  
  &:hover {
    transform: scale(1.1);
  }
}

.empty-text {
  font-family: var(--font-heading);
  opacity: 0.5;
  margin: 0;
}

.team-analysis {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 2px dashed var(--text-dark);
}

.analysis-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}

.analysis-label {
  font-family: var(--font-heading);
  font-weight: bold;
  margin-bottom: 8px;
  border-bottom: 1px solid var(--text-dark);
}

.type-badge-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.none-text {
  font-size: 0.85rem;
  opacity: 0.6;
}

.hint-text {
  font-style: italic;
  font-size: 0.9rem;
  text-align: center;
  margin: 0;
}

.action-btn {
  background-color: var(--accent-magenta);
  color: var(--text-light);
  border-color: var(--text-dark);
}
</style>
