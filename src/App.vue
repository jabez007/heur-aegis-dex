<template>
  <div class="gba-app">
    <header class="gba-header gba-container">
      <h1>Heur-Aegis Dex</h1>
      <p v-if="loading">System Online // Loading Pokedex Data...</p>
      <p v-else-if="types.length > 0" class="status-ready">System Online // Pokedex Database Ready</p>
      <p v-else>System Online // Waiting for Scan...</p>
    </header>

    <main class="gba-main">
      <section class="gba-container">
        <h2>System Settings</h2>
        <div class="controls">
          <button class="gba-btn" :class="{ active: loading }" @click="fetchTypes">
            {{ loading ? 'Loading...' : 'Scan Types' }}
          </button>
          
          <label class="gba-label">
            Pokedex Region:
            <select v-model="inPokedex" @change="fetchTypes" class="gba-select">
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
          <label class="gba-label">
            Min Total Stats:
            <input type="number" v-model.number="minStatsTotal" @change="fetchTypes" class="gba-input" step="10" />
          </label>
          <label class="gba-label">
            Min Attacks:
            <input type="number" v-model.number="minAttacks" @change="fetchTypes" class="gba-input" step="5" />
          </label>
          <label class="gba-label">
            Min Defenses:
            <input type="number" v-model.number="minDefenses" @change="fetchTypes" class="gba-input" step="5" />
          </label>
        </div>
      </section>

      <CustomCupBuilder v-if="types.length > 0" :allDataTypes="types" />
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import lscache from 'lscache';
import { getResistantTypes } from './lib/pokedex';
import CustomCupBuilder from './components/CustomCupBuilder.vue';

const loading = ref(false);
const types = ref<any[]>([]);
const inPokedex = ref('national');
const minStatsTotal = ref(480);
const minAttacks = ref(80);
const minDefenses = ref(80);

const fetchTypes = () => {
  loading.value = true;
  
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
    allowMegas: false
  };

  const key = `heur_aegis_dex_types_${inPokedex.value}_${minStatsTotal.value}_${minAttacks.value}_${minDefenses.value}`;

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
      loading.value = false;
    });
  }
};

onMounted(() => {
  fetchTypes();
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
    color: var(--accent-magenta);
    text-shadow: 2px 2px 0px var(--text-dark);
  }
}

.gba-main {
  width: 100%;
  max-width: 1200px;
}

.controls {
  display: flex;
  gap: 16px;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 16px;
}

.stat-controls {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  padding-top: 16px;
  border-top: 2px dashed var(--text-dark);
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

@media (max-width: 600px) {
  .stat-controls {
    grid-template-columns: 1fr;
  }
}

.gba-label {
  font-family: var(--font-heading);
  font-size: 1.2rem;
  display: flex;
  gap: 8px;
  align-items: center;
}

.gba-select, .gba-input {
  font-family: var(--font-body);
  background: var(--text-light);
  border: 2px solid var(--text-dark);
  padding: 4px 8px;
  text-transform: uppercase;
  width: 100px;
}

.status-ready {
  color: var(--text-dark);
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
</style>
