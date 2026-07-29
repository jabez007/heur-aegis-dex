import { ref } from 'vue';
import { DEFAULT_STATS_FILTERS } from '../lib/pokedex';
import { getActiveRegulation } from '../lib/regulations';
import type { WorkspaceSnapshotV1 } from '../lib/workspacePersistence';
import { createInjectableState } from './injectableState';

const workspaceState = createInjectableState('heur-aegis-dex:workspace', () => ({
  inPokedex: ref<WorkspaceSnapshotV1['scan']['inPokedex']>('national'),
  regulation: ref<string>(getActiveRegulation()?.id ?? ''),
  minStatsTotal: ref<number>(DEFAULT_STATS_FILTERS.minimumStatsTotal),
  minAttacks: ref<number>(DEFAULT_STATS_FILTERS.minimumAttacks),
  minDefenses: ref<number>(DEFAULT_STATS_FILTERS.minimumDefenses),
  allowMegas: ref(false),
  includeAbilityImmunities: ref(true),
  includeMoveCoverage: ref(true),
  selectedAbilityNames: ref<Record<string, string>>({})
}));

export const provideWorkspaceState = workspaceState.provideState;
export const __resetWorkspaceState = workspaceState.resetFallbackState;

export function useWorkspaceState() {
  const state = workspaceState.useState();

  const snapshotScan = (): WorkspaceSnapshotV1['scan'] => ({
    inPokedex: state.inPokedex.value,
    regulation: state.regulation.value || null,
    minimumStatsTotal: state.minStatsTotal.value,
    minimumAttacks: state.minAttacks.value,
    minimumDefenses: state.minDefenses.value,
    allowMegas: state.allowMegas.value,
    includeAbilityImmunities: state.includeAbilityImmunities.value,
    includeMoveCoverage: state.includeMoveCoverage.value
  });

  const restoreScan = (scan: WorkspaceSnapshotV1['scan']) => {
    state.inPokedex.value = scan.inPokedex;
    state.regulation.value = scan.regulation ?? '';
    state.minStatsTotal.value = scan.minimumStatsTotal;
    state.minAttacks.value = scan.minimumAttacks;
    state.minDefenses.value = scan.minimumDefenses;
    state.allowMegas.value = scan.allowMegas;
    state.includeAbilityImmunities.value = scan.includeAbilityImmunities;
    state.includeMoveCoverage.value = scan.includeMoveCoverage;
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
    setSelectedAbilityName,
    restoreAbilityOverrides
  };
}
