import { ref } from 'vue';
import { DEFAULT_STATS_FILTERS } from '../lib/pokedex';
import { getActiveRegulation } from '../lib/regulations';
import type { WorkspaceSnapshotV1 } from '../lib/workspacePersistence';
import { createInjectableState } from './injectableState';

export function getInitialRegulationSelection(at: Date = new Date()) {
  const active = getActiveRegulation(at);
  return {
    regulationId: active?.id ?? '',
    selectionRequired: !active
  };
}

const workspaceState = createInjectableState('heur-aegis-dex:workspace', () => {
  const initialRegulation = getInitialRegulationSelection();
  return {
    inPokedex: ref<WorkspaceSnapshotV1['scan']['inPokedex']>('national'),
    regulation: ref<string>(initialRegulation.regulationId),
    regulationSelectionRequired: ref(initialRegulation.selectionRequired),
    minAttacks: ref<number>(DEFAULT_STATS_FILTERS.minimumAttacks),
    minBulk: ref<number>(DEFAULT_STATS_FILTERS.minimumBulk),
    allowMegas: ref(false),
    includeAbilityImmunities: ref(true),
    includeMoveCoverage: ref(true),
    selectedAbilityNames: ref<Record<string, string>>({})
  };
});

export const provideWorkspaceState = workspaceState.provideState;
export const __resetWorkspaceState = workspaceState.resetFallbackState;

export function useWorkspaceState() {
  const state = workspaceState.useState();

  const snapshotScan = (): WorkspaceSnapshotV1['scan'] => ({
    inPokedex: state.inPokedex.value,
    regulation: state.regulation.value || null,
    minimumAttacks: state.minAttacks.value,
    minimumBulk: state.minBulk.value,
    allowMegas: state.allowMegas.value,
    includeAbilityImmunities: state.includeAbilityImmunities.value,
    includeMoveCoverage: state.includeMoveCoverage.value
  });

  const restoreScan = (scan: WorkspaceSnapshotV1['scan']) => {
    state.inPokedex.value = scan.inPokedex;
    state.regulation.value = scan.regulation ?? '';
    state.regulationSelectionRequired.value = false;
    state.minAttacks.value = scan.minimumAttacks;
    // The old defense average is not numerically equivalent to HP-adjusted
    // bulk, so legacy workspaces move to the calibrated default rather than
    // carrying an 80-point threshold into a different metric.
    state.minBulk.value = scan.minimumBulk ?? DEFAULT_STATS_FILTERS.minimumBulk;
    state.allowMegas.value = scan.allowMegas;
    state.includeAbilityImmunities.value = scan.includeAbilityImmunities;
    state.includeMoveCoverage.value = scan.includeMoveCoverage;
  };

  const confirmRegulationSelection = () => {
    state.regulationSelectionRequired.value = false;
  };

  const requireRegulationSelection = () => {
    state.regulationSelectionRequired.value = true;
  };

  const setSelectedAbilityName = (pokemonName: string, abilityName: string) => {
    state.selectedAbilityNames.value = {
      ...state.selectedAbilityNames.value,
      [pokemonName]: abilityName
    };
  };

  const restoreAbilityOverrides = (overrides: Record<string, string>) => {
    state.selectedAbilityNames.value = { ...overrides };
  };

  return {
    ...state,
    snapshotScan,
    restoreScan,
    confirmRegulationSelection,
    requireRegulationSelection,
    setSelectedAbilityName,
    restoreAbilityOverrides
  };
}
