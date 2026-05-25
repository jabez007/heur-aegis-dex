<template>
  <div class="heur-aegis-dex">
    <div class="gba-app">
      <header class="gba-header gba-container">
        <h1>Heur-Aegis Dex</h1>
        <p v-if="loading">
          System Online // Loading Pokedex Data...
        </p>
        <p
          v-else-if="types.length > 0"
          class="status-ready"
        >
          System Online // Pokedex Database Ready
        </p>
        <p v-else>
          System Online // Waiting for Scan...
        </p>
        <p
          v-if="fetchError"
          class="status-error"
          role="alert"
        >
          {{ fetchError }}
        </p>
      </header>

      <main class="gba-main">
        <section class="gba-container">
          <h2>System Settings</h2>
          <div class="controls">
            <button
              class="gba-btn"
              :class="{ active: loading }"
              :disabled="loading"
              @click="fetchTypesImmediate"
            >
              {{ loading ? 'Loading...' : (fetchError ? 'Retry Scan' : 'Scan Types') }}
            </button>
            
            <label class="gba-label">
              Pokedex Region:
              <select
                v-model="inPokedex"
                class="gba-select"
                @change="fetchTypesImmediate"
              >
                <option value="national">National</option>
                <option value="kanto">Kanto</option>
                <option value="galar">Galar</option>
                <option value="sinnoh">Sinnoh</option>
                <option value="hisui">Hisui</option>
                <option value="paldea">Paldea</option>
              </select>
            </label>
          </div>

          <div class="stat-controls">
            <label class="gba-label checkbox-label">
              <input
                v-model="includeAbilityImmunities"
                type="checkbox"
                class="gba-checkbox"
                @change="fetchTypesDebounced"
              >
              Include Ability Immunities
            </label>
            <label class="gba-label checkbox-label">
              <input
                v-model="allowMegas"
                type="checkbox"
                class="gba-checkbox"
                @change="fetchTypesDebounced"
              >
              Include Mega Evolutions
            </label>
            <label class="gba-label">
              Min Total Stats:
              <input
                v-model.number="minStatsTotal"
                type="number"
                class="gba-input"
                step="10"
                @change="fetchTypesImmediate"
              >
            </label>
            <label class="gba-label">
              Min Attacks:
              <input
                v-model.number="minAttacks"
                type="number"
                class="gba-input"
                step="5"
                @change="fetchTypesImmediate"
              >
            </label>
            <label class="gba-label">
              Min Defenses:
              <input
                v-model.number="minDefenses"
                type="number"
                class="gba-input"
                step="5"
                @change="fetchTypesImmediate"
              >
            </label>
          </div>
        </section>

        <CustomCupBuilder
          v-if="types.length > 0"
          :all-data-types="types"
        />
        <section
          v-else-if="fetchError"
          class="gba-container state-panel"
          aria-labelledby="scan-error-title"
        >
          <h2 id="scan-error-title">
            Scan Interrupted
          </h2>
          <p>The Pokedex database could not be loaded.</p>
          <button
            class="gba-btn action-btn"
            @click="fetchTypesImmediate"
          >
            Retry Scan
          </button>
        </section>
        <section
          v-else-if="!loading"
          class="gba-container state-panel"
          aria-labelledby="scan-idle-title"
        >
          <h2 id="scan-idle-title">
            Awaiting Scan
          </h2>
          <p>Run a scan to load available typings and team options.</p>
        </section>
      </main>

      <GbaNotification />

      <Transition name="fade">
        <div
          v-if="loading"
          class="loading-overlay"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="loading-title"
        >
          <div class="loading-content">
            <div class="scanner-line" />
            <div
              id="loading-title"
              class="loading-text"
            >
              SCANNING DATABASE
            </div>
            <div class="loading-subtext">
              CONNECTED TO POKEAPI_
            </div>
          </div>
        </div>
      </Transition>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onBeforeUnmount, onMounted } from 'vue';
import lscache from 'lscache';
import { getResistantTypes } from './lib/pokedex';
import CustomCupBuilder from './components/CustomCupBuilder.vue';
import GbaNotification from './components/GbaNotification.vue';
import { useNotifications } from './composables/useNotifications';
import type { TypeDataLike } from './lib/activePokemon';

const loading = ref(false);
const types = ref<TypeDataLike[]>([]);
const fetchError = ref('');
const inPokedex = ref('national');
const minStatsTotal = ref(480);
const minAttacks = ref(80);
const minDefenses = ref(80);
const allowMegas = ref(false);
const includeAbilityImmunities = ref(true);
const { notify } = useNotifications();
let fetchTypesDebounceTimer: ReturnType<typeof setTimeout> | null = null;

const fetchTypes = () => {
  loading.value = true;
  fetchError.value = '';
  
  const filters = {
    maxDamageFromScore: true,
    allowQuadrupleDamage: true,
    limitQuadrupleDamage: true,
  };
  const statsFilters = {
    minimumStatsTotal: minStatsTotal.value,
    minimumAttacks: minAttacks.value,
    minimumDefenses: minDefenses.value,
  };
  const pokedexFilter = {
    inPokedex: inPokedex.value,
    allowMegas: allowMegas.value,
    includeAbilityImmunities: includeAbilityImmunities.value
  };

  const key = `heur_aegis_dex_v3_types_${inPokedex.value}_${minStatsTotal.value}_${minAttacks.value}_${minDefenses.value}_${allowMegas.value}_${includeAbilityImmunities.value}`;

  const cached = lscache.get(key);
  if (cached) {
    types.value = cached;
    loading.value = false;
  } else {
    getResistantTypes({
      typeFilters: filters,
      pokemonFilters: pokedexFilter,
      statsFilters: statsFilters
    }).then(data => {
      lscache.set(key, data, 60 * 24);
      types.value = data;
      loading.value = false;
    }).catch(err => {
      console.error(err);
      types.value = [];
      fetchError.value = 'Pokedex scan failed. Check your connection and try again.';
      notify(fetchError.value, 'error');
      loading.value = false;
    });
  }
};

const fetchTypesImmediate = () => {
  if (fetchTypesDebounceTimer) {
    clearTimeout(fetchTypesDebounceTimer);
    fetchTypesDebounceTimer = null;
  }
  fetchTypes();
};

const fetchTypesDebounced = () => {
  if (fetchTypesDebounceTimer) {
    clearTimeout(fetchTypesDebounceTimer);
  }

  fetchTypesDebounceTimer = setTimeout(() => {
    fetchTypesDebounceTimer = null;
    fetchTypes();
  }, 400);
};

onMounted(() => {
  fetchTypes();
});

onBeforeUnmount(() => {
  if (fetchTypesDebounceTimer) {
    clearTimeout(fetchTypesDebounceTimer);
  }
});
</script>

<style lang="scss" scoped>
.gba-app {
  min-height: 100vh;
  padding: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.gba-header {
  text-align: center;
  width: 100%;
  max-width: 1200px;
  
  h1 {
    font-size: 3rem;
    color: var(--gba-accent-magenta);
    text-shadow: 2px 2px 0px var(--gba-text-dark);
  }
}

.status-error {
  margin-top: 12px;
  color: #ffdce0;
  font-family: var(--gba-font-heading);
}

.gba-main {
  width: 100%;
  max-width: 1200px;
}

.state-panel {
  text-align: center;
}

.action-btn {
  background-color: var(--gba-accent-magenta);
  color: var(--gba-text-light);
  border-color: var(--gba-text-dark);
}

.controls {
  display: flex;
  gap: 16px;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 16px;
}

.controls .gba-btn:disabled {
  opacity: 0.7;
  cursor: wait;
}

.stat-controls {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  padding-top: 16px;
  border-top: 2px dashed var(--gba-text-dark);
}

.stat-controls .gba-label {
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}

.stat-controls .gba-input {
  width: 100%;
  box-sizing: border-box;
}

.stat-controls .checkbox-label {
  flex-direction: row;
  align-items: center;
  justify-self: start;
  align-self: center;
  grid-column: 1 / -1;
  gap: 8px;
  white-space: nowrap;
}

.gba-checkbox {
  width: 18px;
  height: 18px;
  accent-color: var(--gba-accent-cyan);
}

@media (max-width: 600px) {
  .stat-controls {
    grid-template-columns: 1fr;
  }
}

.gba-label {
  font-family: var(--gba-font-heading);
  font-size: 1.2rem;
  display: flex;
  gap: 8px;
  align-items: center;
}

.gba-select, .gba-input {
  font-family: var(--gba-font-body);
  background: var(--gba-text-light);
  border: 2px solid var(--gba-text-dark);
  padding: 4px 8px;
  text-transform: uppercase;
  width: 100px;
}

.status-ready {
  color: var(--gba-text-dark);
  font-weight: bold;
  position: relative;
}

.status-ready::after {
  content: '_';
  animation: blink 1s steps(2, start) infinite;
  margin-left: 4px;
}

@keyframes blink {
  to { visibility: hidden; }
}

.loading-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.85);
  z-index: 10000;
  display: flex;
  justify-content: center;
  align-items: center;
  -webkit-backdrop-filter: blur(4px);
  backdrop-filter: blur(4px);
}

.loading-content {
  position: relative;
  border: 4px solid var(--gba-accent-magenta);
  padding: 40px 60px;
  background: var(--gba-text-dark);
  text-align: center;
  box-shadow: 8px 8px 0px rgba(0, 0, 0, 0.5);
  overflow: hidden;
  
  &::after {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
    background: repeating-linear-gradient(
      0deg,
      rgba(0, 0, 0, 0.15) 0px,
      rgba(0, 0, 0, 0.15) 1px,
      transparent 1px,
      transparent 2px
    );
    pointer-events: none;
  }
}

.scanner-line {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 2px;
  background: var(--gba-accent-cyan);
  box-shadow: 0 0 15px var(--gba-accent-cyan);
  animation: scan 2s linear infinite;
  opacity: 0.7;
}

@keyframes scan {
  0% { top: 0; }
  100% { top: 100%; }
}

.loading-text {
  font-family: var(--gba-font-heading);
  font-size: 2.5rem;
  color: var(--gba-accent-magenta);
  margin-bottom: 8px;
  letter-spacing: 2px;
}

.loading-subtext {
  font-family: var(--gba-font-body);
  color: var(--gba-accent-cyan);
  font-size: 1rem;
  opacity: 0.8;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.4s steps(4);
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
