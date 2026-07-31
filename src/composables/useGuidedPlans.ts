import { ref } from 'vue';
import {
  createGuidedPlanRecord,
  deleteGuidedPlanRecord,
  emptyGuidedPlanArchive,
  GUIDED_PLAN_STORAGE_KEY,
  readGuidedPlanArchive,
  setActiveGuidedPlanId,
  setDraftGuidedPlanId,
  updateGuidedPlanRecord,
  writeGuidedPlanArchive,
  type GuidedPlanArchiveV1,
  type GuidedPlanRecordV1,
  type GuidedPlanStorage
} from '../lib/guidedPlanPersistence';
import { createInjectableState } from './injectableState';

export const GUIDED_METRICS_STORAGE_KEY = 'heur-aegis-dex:guided-metrics:v1';

export interface GuidedBrowserStorage extends GuidedPlanStorage {
  removeItem(key: string): void;
}

export interface GuidedPlanStoreDependencies {
  readonly storage: GuidedBrowserStorage | null;
  readonly createId: () => string;
}

export interface ClearGuidedDataResult {
  readonly ok: boolean;
  readonly plansCleared: boolean;
  readonly metricsCleared: boolean;
}

export function createGuidedPlanStore(dependencies: GuidedPlanStoreDependencies) {
  const { storage, createId } = dependencies;
  const archive = ref<GuidedPlanArchiveV1>(emptyGuidedPlanArchive());
  const initialized = ref(false);
  const storageAvailable = ref(false);
  const storageError = ref('');

  const fail = (message: string) => {
    storageAvailable.value = false;
    storageError.value = message;
  };

  const recover = (next: GuidedPlanArchiveV1) => {
    archive.value = next;
    storageAvailable.value = true;
    storageError.value = '';
  };

  const latestArchive = (): GuidedPlanArchiveV1 | null => {
    if (!storage) {
      fail('Local guided plan storage is unavailable.');
      return null;
    }
    try {
      return readGuidedPlanArchive(storage);
    } catch {
      fail('Saved guided plan data changed or became unreadable.');
      return null;
    }
  };

  const persist = (next: GuidedPlanArchiveV1, currentStored: GuidedPlanArchiveV1): boolean => {
    if (!storage) {
      fail('Local guided plan storage is unavailable.');
      return false;
    }
    try {
      writeGuidedPlanArchive(storage, next);
      recover(next);
      return true;
    } catch {
      archive.value = currentStored;
      fail('Local guided plan save failed. Browser storage may be full or unavailable.');
      return false;
    }
  };

  const initialize = (): boolean => {
    initialized.value = true;
    const latest = latestArchive();
    if (!latest) return false;
    recover(latest);
    return true;
  };

  const createPlan = (record: GuidedPlanRecordV1): string | null => {
    const latest = latestArchive();
    if (!latest) return null;
    try {
      const created = createGuidedPlanRecord(latest, record, createId);
      const selected = setDraftGuidedPlanId(
        setActiveGuidedPlanId(created.archive, created.planId),
        created.planId
      );
      return persist(selected, latest) ? created.planId : null;
    } catch (error) {
      storageError.value = error instanceof Error ? error.message : 'Guided plan creation failed.';
      return null;
    }
  };

  const updatePlan = (planId: string, record: GuidedPlanRecordV1): boolean => {
    const latest = latestArchive();
    if (!latest) return false;
    try {
      return persist(updateGuidedPlanRecord(latest, planId, record), latest);
    } catch (error) {
      storageError.value = error instanceof Error ? error.message : 'Guided plan update failed.';
      return false;
    }
  };

  const selectActivePlan = (planId: string | null): boolean => {
    const latest = latestArchive();
    if (!latest) return false;
    try {
      return persist(setActiveGuidedPlanId(latest, planId), latest);
    } catch (error) {
      storageError.value = error instanceof Error ? error.message : 'Guided plan selection failed.';
      return false;
    }
  };

  const selectDraftPlan = (planId: string | null): boolean => {
    const latest = latestArchive();
    if (!latest) return false;
    try {
      return persist(setDraftGuidedPlanId(latest, planId), latest);
    } catch (error) {
      storageError.value = error instanceof Error ? error.message : 'Guided draft selection failed.';
      return false;
    }
  };

  const deletePlan = (planId: string): boolean => {
    const latest = latestArchive();
    return latest ? persist(deleteGuidedPlanRecord(latest, planId), latest) : false;
  };

  const handleStorageEvent = (event: {
    readonly key: string | null;
    readonly storageArea?: GuidedBrowserStorage | null;
  }): boolean => {
    if (event.key !== null && event.key !== GUIDED_PLAN_STORAGE_KEY) return false;
    if (event.storageArea && event.storageArea !== storage) return false;
    const latest = latestArchive();
    if (!latest) return false;
    recover(latest);
    return true;
  };

  const clearGuidedData = (): ClearGuidedDataResult => {
    if (!storage) {
      fail('Local guided plan storage is unavailable.');
      return { ok: false, plansCleared: false, metricsCleared: false };
    }
    try {
      storage.removeItem(GUIDED_METRICS_STORAGE_KEY);
    } catch {
      storageError.value = 'Could not clear all local guided data.';
      return { ok: false, plansCleared: false, metricsCleared: false };
    }
    try {
      storage.removeItem(GUIDED_PLAN_STORAGE_KEY);
      const latest = readGuidedPlanArchive(storage);
      recover(latest);
      return { ok: true, plansCleared: true, metricsCleared: true };
    } catch {
      const latest = latestArchive();
      if (latest) archive.value = latest;
      storageError.value = 'Guided metrics were cleared, but saved guided plans could not be cleared.';
      return { ok: false, plansCleared: false, metricsCleared: true };
    }
  };

  return {
    archive,
    initialized,
    storageAvailable,
    storageError,
    initialize,
    createPlan,
    updatePlan,
    selectActivePlan,
    selectDraftPlan,
    deletePlan,
    handleStorageEvent,
    clearGuidedData
  };
}

function browserStorage(): GuidedBrowserStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const guidedPlans = createInjectableState('heur-aegis-dex:guided-plans', () => createGuidedPlanStore({
  storage: browserStorage(),
  createId: () => typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
}));

export const provideGuidedPlans = guidedPlans.provideState;
export const __resetGuidedPlans = guidedPlans.resetFallbackState;
export const useGuidedPlans = guidedPlans.useState;
