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
        <p class="status-regulation">
          {{ regulationSelectionRequired
            ? 'Regulation selection required // scan blocked'
            : selectedRegulation
              ? `${selectedRegulation.label} // ${selectedRegulation.legalSpecies.size} legal species`
              : 'Explicit unrestricted scan // all breedable species' }}
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
              @click="handleScanAction"
            >
              {{ loading ? 'Loading...' : (scanRequiresReload ? 'Reload App' : 'Scan Types') }}
            </button>

            <WorkspaceSavesDialog
              :saves="workspaceArchive.saves"
              :draft-updated-at="workspaceArchive.draftUpdatedAt"
              :disabled="!workspaceStorageAvailable"
              :busy="loading"
              :current-ready="workspaceReady"
              :storage-error="workspaceStorageError"
              @save="saveWorkspace"
              @load="loadWorkspace"
              @rename="renameWorkspace"
              @delete="deleteWorkspace"
            />
            
            <label class="gba-label">
              Regulation:
              <select
                v-model="regulationChoice"
                class="gba-select regulation-select"
                @change="fetchTypesImmediate"
              >
                <option
                  v-if="regulationSelectionRequired"
                  :value="REGULATION_SELECTION_REQUIRED"
                  disabled
                >
                  No active regulation // choose explicitly
                </option>
                <option :value="UNRESTRICTED_REGULATION">Any (no legality filter)</option>
                <option
                  v-for="reg in REGULATIONS"
                  :key="reg.id"
                  :value="reg.id"
                >
                  {{ reg.id }}{{ reg.id === activeRegulationId ? ' (current)' : '' }}
                </option>
              </select>
            </label>

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
                v-model="includeMoveCoverage"
                type="checkbox"
                class="gba-checkbox"
                @change="fetchTypesDebounced"
              >
              Include Move Coverage
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
              Min Effective Bulk:
              <input
                v-model.number="minBulk"
                type="number"
                class="gba-input"
                step="5"
                @change="fetchTypesImmediate"
              >
            </label>
            <p class="filter-hint">
              Both floors are required. Attack uses the higher of Attack and Special Attack.
              Effective Bulk averages sqrt(HP x Defense) and sqrt(HP x Special Defense).
            </p>
          </div>
        </section>

        <CustomCupBuilder
          v-if="types.length > 0"
          :all-data-types="types"
        />
        <section
          v-else-if="regulationSelectionRequired"
          class="gba-container state-panel"
          aria-labelledby="regulation-required-title"
        >
          <h2 id="regulation-required-title">
            Regulation Selection Required
          </h2>
          <p>Select a known regulation or explicitly choose Any before scanning.</p>
        </section>
        <section
          v-else-if="fetchError"
          class="gba-container state-panel"
          aria-labelledby="scan-error-title"
        >
          <h2 id="scan-error-title">
            Scan Interrupted
          </h2>
          <p>The verified Pokemon catalog could not be loaded.</p>
          <button
            class="gba-btn action-btn"
            @click="handleScanAction"
          >
            Reload App
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
              VERIFIED LOCAL CATALOG_
            </div>
          </div>
        </div>
      </Transition>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch, onBeforeUnmount, onMounted } from 'vue';
import lscache from 'lscache';
import { REGULATIONS, getActiveRegulation, getResistantTypes } from './lib/pokedex';
import CustomCupBuilder from './components/CustomCupBuilder.vue';
import GbaNotification from './components/GbaNotification.vue';
import WorkspaceSavesDialog from './components/WorkspaceSavesDialog.vue';
import { useMetaFilters } from './composables/useMetaFilters';
import { useNotifications } from './composables/useNotifications';
import { useTeamBuilder } from './composables/useTeamBuilder';
import { useWorkspaceState } from './composables/useWorkspaceState';
import { useGuidedPlans } from './composables/useGuidedPlans';
import { flattenToPokemon } from './lib/pokemonEntry';
import {
  WORKSPACE_STORAGE_KEY,
  WORKSPACE_VERSION,
  deleteSavedWorkspace,
  emptyWorkspaceArchive,
  mergeUnresolvedTeamIdentifiers,
  readWorkspaceArchive,
  renameSavedWorkspace,
  saveNamedWorkspace,
  writeWorkspaceArchive,
  type WorkspaceArchiveV1,
  type WorkspaceSnapshotV1,
  type WorkspaceStorage
} from './lib/workspacePersistence';
import { isResistantTypeResultList, type ResistantTypeResult } from './lib/pokedexTypes';
import { POKEMON_SCAN_CACHE_REVISION } from './lib/pokemonCatalog';

const loading = ref(false);
const types = ref<ResistantTypeResult[]>([]);
const fetchError = ref('');
const scanRequiresReload = ref(false);
const workspace = useWorkspaceState();
const {
  inPokedex,
  regulation,
  minAttacks,
  minBulk,
  allowMegas,
  includeAbilityImmunities,
  includeMoveCoverage,
  selectedAbilityNames,
  regulationSelectionRequired,
  snapshotScan,
  restoreScan,
  restoreAbilityOverrides,
  confirmRegulationSelection,
  requireRegulationSelection
} = workspace;
const metaFilters = useMetaFilters();
const teamBuilder = useTeamBuilder();
const guidedPlans = useGuidedPlans();
const { notify } = useNotifications();
// Default to whichever regulation is in force today so the tool is correct for
// the format being played without the user having to know which one that is.
const activeRegulationId = getActiveRegulation()?.id ?? '';
const selectedRegulation = computed(() => REGULATIONS.find(reg => reg.id === regulation.value));
const REGULATION_SELECTION_REQUIRED = '__selection_required__';
const UNRESTRICTED_REGULATION = '__unrestricted__';
const regulationChoice = computed({
  get: () => regulationSelectionRequired.value
    ? REGULATION_SELECTION_REQUIRED
    : (regulation.value || UNRESTRICTED_REGULATION),
  set: (choice: string) => {
    regulation.value = choice === UNRESTRICTED_REGULATION ? '' : choice;
    confirmRegulationSelection();
  }
});
let fetchTypesDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let draftSaveTimer: ReturnType<typeof setTimeout> | null = null;
let retainedUnresolvedTeam: {
  team: WorkspaceSnapshotV1['team'];
  pokemonNames: Set<string>;
  teamEditRevision: number;
  rosterEditRevision: number;
} | null = null;

const workspaceArchive = ref<WorkspaceArchiveV1>(emptyWorkspaceArchive());
const workspaceStorageError = ref('');
const workspaceStorageAvailable = ref(false);
const workspaceReady = ref(false);
const pendingWorkspace = ref<WorkspaceSnapshotV1 | null>(null);
const saveDraftAfterRestore = ref(false);
let saveDraftWhenReady = false;
let browserStorage: WorkspaceStorage | null = null;

const applyWorkspaceSettings = (snapshot: WorkspaceSnapshotV1) => {
  const regulationExists = snapshot.scan.regulation === null ||
    REGULATIONS.some((entry) => entry.id === snapshot.scan.regulation);
  restoreScan({
    ...snapshot.scan,
    regulation: regulationExists ? snapshot.scan.regulation : null
  });
  if (!regulationExists) requireRegulationSelection();
  metaFilters.restoreMetaFilters(snapshot.meta);
  restoreAbilityOverrides(snapshot.abilityOverrides);
  return regulationExists ? [] : [`Regulation ${snapshot.scan.regulation} is no longer available.`];
};

let pendingSettingWarnings: string[] = [];
if (typeof window !== 'undefined') {
  try {
    browserStorage = window.localStorage;
    workspaceArchive.value = readWorkspaceArchive(browserStorage);
    workspaceStorageAvailable.value = true;
    if (workspaceArchive.value.draft) {
      pendingWorkspace.value = workspaceArchive.value.draft;
      pendingSettingWarnings = applyWorkspaceSettings(workspaceArchive.value.draft);
    }
  } catch (error) {
    workspaceStorageError.value = error instanceof Error
      ? error.message
      : 'Local workspace storage is unavailable.';
  }
}

// Scans cannot be aborted mid-flight, so each one claims a token and only the
// most recent claim is allowed to write back. Without this a slow scan that was
// superseded by a newer one can resolve last and overwrite the current results.
let latestScanToken = 0;
const scansInFlight = new Map<string, Promise<ResistantTypeResult[]>>();

const fetchTypes = async (): Promise<boolean> => {
  const scanToken = ++latestScanToken;
  const isCurrentScan = () => scanToken === latestScanToken;

  loading.value = true;
  fetchError.value = '';

  if (regulationSelectionRequired.value) {
    types.value = [];
    loading.value = false;
    fetchError.value = 'No active regulation is recorded. Select a known regulation or explicitly choose Any.';
    return false;
  }

  const filters = {
    maxDamageFromScore: true,
    allowQuadrupleDamage: true,
    limitQuadrupleDamage: true,
  };
  const statsFilters = {
    minimumAttacks: minAttacks.value,
    minimumBulk: minBulk.value,
  };
  const pokedexFilter = {
    inPokedex: inPokedex.value,
    allowMegas: allowMegas.value,
    includeAbilityImmunities: includeAbilityImmunities.value,
    includeMoveCoverage: includeMoveCoverage.value,
    regulation: regulation.value || null
  };

  // Every filter that changes the result must appear in the key. The prefix
  // covers result shape; the scan revision covers catalog, regulation and rule
  // changes that leave the shape intact.
  const key = `heur_aegis_dex_v21_${POKEMON_SCAN_CACHE_REVISION}_types_${inPokedex.value}_${minAttacks.value}_${minBulk.value}_${allowMegas.value}_${includeAbilityImmunities.value}_${includeMoveCoverage.value}_${regulation.value || 'any'}`;

  const cached: unknown = lscache.get(key);
  if (isResistantTypeResultList(cached)) {
    types.value = cached;
    scanRequiresReload.value = false;
    loading.value = false;
    return true;
  } else {
    try {
      let scan = scansInFlight.get(key);
      if (!scan) {
        scan = getResistantTypes({
          typeFilters: filters,
          pokemonFilters: pokedexFilter,
          statsFilters: statsFilters
        });
        scansInFlight.set(key, scan);
        scan.then(
          () => scansInFlight.delete(key),
          () => scansInFlight.delete(key)
        );
      }
      const data = await scan;
      // The cache key encodes the filters this scan ran with, so the result is
      // worth keeping even when a newer scan has already superseded the view.
      lscache.set(key, data, 60 * 24);
      if (!isCurrentScan()) return false;
      types.value = data;
      scanRequiresReload.value = false;
      loading.value = false;
      return true;
    } catch (error) {
      console.error(error);
      if (!isCurrentScan()) return false;
      types.value = [];
      fetchError.value = error instanceof Error && error.message.includes('requires Web Crypto')
        ? 'Catalog verification requires a secure, modern browser.'
        : 'Catalog scan failed. Reload the app and try again.';
      scanRequiresReload.value = true;
      notify(fetchError.value, 'error');
      loading.value = false;
      return false;
    }
  }
};

const captureWorkspace = (): WorkspaceSnapshotV1 => {
  const currentTeam = teamBuilder.snapshotTeam();
  const retained = retainedUnresolvedTeam;
  let team = currentTeam;
  if (retained && retained.rosterEditRevision === teamBuilder.rosterEditRevision.value) {
    team = mergeUnresolvedTeamIdentifiers(
      currentTeam,
      retained.team,
      retained.pokemonNames,
      retained.teamEditRevision === teamBuilder.teamEditRevision.value
    );
  }

  return {
    version: WORKSPACE_VERSION,
    scan: snapshotScan(),
    meta: metaFilters.snapshotMetaFilters(),
    abilityOverrides: { ...selectedAbilityNames.value },
    team
  };
};

const persistArchive = (next: WorkspaceArchiveV1): boolean => {
  if (!browserStorage || !workspaceStorageAvailable.value) return false;
  try {
    writeWorkspaceArchive(browserStorage, next);
    workspaceArchive.value = next;
    return true;
  } catch {
    workspaceStorageError.value = 'Local save failed. Browser storage may be full or unavailable.';
    return false;
  }
};

const latestWorkspaceArchive = (): WorkspaceArchiveV1 | null => {
  if (!browserStorage) return workspaceArchive.value;
  try {
    return readWorkspaceArchive(browserStorage);
  } catch {
    workspaceStorageAvailable.value = false;
    workspaceStorageError.value = 'Saved workspace data changed or became unreadable. Reload before saving.';
    return null;
  }
};

const saveDraftNow = (snapshot: WorkspaceSnapshotV1 = captureWorkspace()) => {
  const latest = latestWorkspaceArchive();
  if (!latest) return;
  const now = new Date().toISOString();
  persistArchive({ ...latest, draft: snapshot, draftUpdatedAt: now });
};

const queueDraftSave = () => {
  if (!workspaceReady.value || !workspaceStorageAvailable.value) return;
  if (draftSaveTimer) clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(() => {
    draftSaveTimer = null;
    if (!workspaceReady.value) return;
    saveDraftNow();
  }, 500);
};

const completeWorkspaceRestore = async (snapshot: WorkspaceSnapshotV1) => {
  const result = teamBuilder.restoreTeam(snapshot.team, flattenToPokemon(types.value));
  const unavailableAbilityPokemon = result.unavailableAbilities.map((entry) => entry.split(':', 1)[0]);
  const unresolvedNames = new Set([...result.unavailablePokemon, ...unavailableAbilityPokemon]);
  retainedUnresolvedTeam = unresolvedNames.size > 0
    ? {
        team: snapshot.team,
        pokemonNames: unresolvedNames,
        teamEditRevision: teamBuilder.teamEditRevision.value,
        rosterEditRevision: teamBuilder.rosterEditRevision.value
      }
    : null;
  const warnings = [
    ...pendingSettingWarnings,
    ...result.unavailablePokemon.map((name) => `${name} is outside the restored scan.`),
    ...result.unavailableAbilities.map((ability) => `${ability} is unavailable.`)
  ];
  pendingSettingWarnings = [];
  pendingWorkspace.value = null;
  // Let restore-triggered watchers flush while autosave is still suspended.
  // Otherwise an unresolved roster can overwrite the intact saved snapshot.
  await nextTick();
  workspaceReady.value = true;

  if (saveDraftAfterRestore.value) {
    saveDraftAfterRestore.value = false;
    // Keep unresolved identifiers in the recovery draft rather than replacing
    // them with a partial roster assembled from the current scan.
    saveDraftNow(warnings.length > 0 ? snapshot : captureWorkspace());
  } else if (saveDraftWhenReady) {
    saveDraftNow();
  }
  saveDraftWhenReady = false;

  notify(
    warnings.length > 0
      ? `Workspace restored with ${warnings.length} warning${warnings.length === 1 ? '' : 's'}: ${warnings.join(' ')}`
      : 'Workspace restored.',
    warnings.length > 0 ? 'error' : 'success'
  );
};

const fetchTypesAndRestore = async () => {
  const success = await fetchTypes();
  if (success && pendingWorkspace.value) {
    await completeWorkspaceRestore(pendingWorkspace.value);
  } else if (!pendingWorkspace.value) {
    workspaceReady.value = true;
    if (saveDraftWhenReady) {
      saveDraftWhenReady = false;
      saveDraftNow();
    }
  }
  return success;
};

const fetchTypesImmediate = async () => {
  if (fetchTypesDebounceTimer) {
    clearTimeout(fetchTypesDebounceTimer);
    fetchTypesDebounceTimer = null;
  }
  return fetchTypesAndRestore();
};

const handleScanAction = () => {
  if (scanRequiresReload.value) {
    window.location.reload();
    return;
  }
  void fetchTypesImmediate();
};

const fetchTypesDebounced = () => {
  if (fetchTypesDebounceTimer) {
    clearTimeout(fetchTypesDebounceTimer);
  }

  fetchTypesDebounceTimer = setTimeout(() => {
    fetchTypesDebounceTimer = null;
    void fetchTypesAndRestore();
  }, 400);
};

const saveWorkspace = (name: string) => {
  try {
    const latest = latestWorkspaceArchive();
    if (!latest) return;
    const next = saveNamedWorkspace(
      latest,
      name,
      captureWorkspace(),
      new Date().toISOString(),
      () => typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`
    );
    if (persistArchive(next)) notify(`Saved workspace ${name}.`, 'success');
  } catch (error) {
    notify(error instanceof Error ? error.message : 'Workspace save failed.', 'error');
  }
};

const loadWorkspace = async (id: string) => {
  const saved = workspaceArchive.value.saves.find((entry) => entry.id === id);
  if (!saved) return;
  if (draftSaveTimer) {
    clearTimeout(draftSaveTimer);
    draftSaveTimer = null;
  }
  workspaceReady.value = false;
  pendingWorkspace.value = saved.snapshot;
  saveDraftAfterRestore.value = true;
  pendingSettingWarnings = applyWorkspaceSettings(saved.snapshot);
  await fetchTypesImmediate();
};

const renameWorkspace = (id: string, name: string) => {
  try {
    const latest = latestWorkspaceArchive();
    if (!latest) return;
    const next = renameSavedWorkspace(latest, id, name);
    if (persistArchive(next)) notify(`Workspace renamed to ${name}.`, 'success');
  } catch (error) {
    notify(error instanceof Error ? error.message : 'Workspace rename failed.', 'error');
  }
};

const deleteWorkspace = (id: string) => {
  const latest = latestWorkspaceArchive();
  if (!latest) return;
  const saved = latest.saves.find((entry) => entry.id === id);
  if (!saved) return;
  if (persistArchive(deleteSavedWorkspace(latest, id))) {
    notify(`Deleted workspace ${saved.name}.`, 'success');
  }
};

watch(captureWorkspace, queueDraftSave, { deep: true, flush: 'sync' });

const flushDraft = () => {
  if (!workspaceReady.value || !workspaceStorageAvailable.value || !draftSaveTimer) return;
  clearTimeout(draftSaveTimer);
  draftSaveTimer = null;
  saveDraftNow();
};

const refreshWorkspaceArchive = (event: StorageEvent) => {
  if (event.key !== WORKSPACE_STORAGE_KEY || !browserStorage) return;
  try {
    workspaceArchive.value = readWorkspaceArchive(browserStorage);
    workspaceStorageAvailable.value = true;
    workspaceStorageError.value = '';
    if (workspaceReady.value) {
      saveDraftNow();
    } else {
      saveDraftWhenReady = true;
    }
  } catch {
    // Keep the last valid in-memory archive. The other tab may be midway
    // through recovery; a later valid storage event will refresh this list.
  }
};

const refreshGuidedPlanArchive = (event: StorageEvent) => {
  guidedPlans.handleStorageEvent(event);
};

onMounted(() => {
  guidedPlans.initialize();
  window.addEventListener('pagehide', flushDraft);
  window.addEventListener('storage', refreshWorkspaceArchive);
  window.addEventListener('storage', refreshGuidedPlanArchive);
  void fetchTypesAndRestore();
});

onBeforeUnmount(() => {
  if (fetchTypesDebounceTimer) {
    clearTimeout(fetchTypesDebounceTimer);
  }
  flushDraft();
  if (typeof window !== 'undefined') {
    window.removeEventListener('pagehide', flushDraft);
    window.removeEventListener('storage', refreshWorkspaceArchive);
    window.removeEventListener('storage', refreshGuidedPlanArchive);
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

.status-regulation {
  margin-top: 8px;
  font-family: var(--gba-font-body);
  font-size: 0.9rem;
  opacity: 0.85;
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

.filter-hint {
  grid-column: 1 / -1;
  margin: 0;
  font-size: 0.9rem;
  opacity: 0.75;
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

@media (max-width: 600px) {
  .stat-controls {
    grid-template-columns: 1fr;
  }
}

// The shared control styles live in assets/scss/main.scss so every component
// gets them. Only the App-specific overrides stay here.
.regulation-select {
  width: auto;
  min-width: 100px;
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
