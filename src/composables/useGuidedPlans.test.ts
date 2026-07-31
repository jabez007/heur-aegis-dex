import { describe, expect, it } from 'vitest';
import { createGuidedPlan } from '../lib/guidedPlanReducer';
import {
  emptyGuidedPlanArchive,
  GUIDED_PLAN_STORAGE_KEY,
  type GuidedPlanRecordV1
} from '../lib/guidedPlanPersistence';
import { WORKSPACE_STORAGE_KEY } from '../lib/workspacePersistence';
import {
  createGuidedPlanStore,
  GUIDED_METRICS_STORAGE_KEY,
  type GuidedBrowserStorage
} from './useGuidedPlans';

const planRecord = (): GuidedPlanRecordV1 => {
  const created = createGuidedPlan({
    format: 'singles',
    lockedFavorites: [{ varietyName: 'favorite', speciesName: 'favorite', abilityName: 'ability' }]
  });
  if (!created.ok) throw new Error('fixture creation failed');
  return {
    updatedAt: '2026-07-31T12:00:00Z',
    lastCompletedStep: 'favorites-locked',
    scan: {
      regulation: null,
      region: 'national',
      minimumAttacks: 80,
      minimumBulk: 70,
      allowMegas: false,
      includeAbilityImmunities: true,
      includeMoveCoverage: true,
      scanRevision: 'scan-revision-1'
    },
    state: created.state
  };
};

const memoryStorage = (): GuidedBrowserStorage => {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); }
  };
};

describe('guided plan browser store', () => {
  it('initializes and persists a newly identified active draft plan', () => {
    const storage = memoryStorage();
    const store = createGuidedPlanStore({ storage, createId: () => 'plan-1' });

    expect(store.initialize()).toBe(true);
    expect(store.createPlan(planRecord())).toBe('plan-1');

    expect(store.archive.value).toMatchObject({
      activePlanId: 'plan-1',
      draftPlanId: 'plan-1',
      plans: { 'plan-1': planRecord() }
    });
    expect(JSON.parse(storage.getItem(GUIDED_PLAN_STORAGE_KEY)!)).toEqual(store.archive.value);
  });

  it('rereads the latest archive before mutation instead of overwriting another tab', () => {
    const storage = memoryStorage();
    const store = createGuidedPlanStore({ storage, createId: () => 'local-plan' });
    expect(store.initialize()).toBe(true);
    const external = {
      ...emptyGuidedPlanArchive(),
      activePlanId: 'external-plan',
      plans: { 'external-plan': planRecord() }
    };
    storage.setItem(GUIDED_PLAN_STORAGE_KEY, JSON.stringify(external));

    expect(store.createPlan(planRecord())).toBe('local-plan');

    expect(Object.keys(store.archive.value.plans).sort()).toEqual(['external-plan', 'local-plan']);
    expect(store.archive.value.activePlanId).toBe('local-plan');
  });

  it('keeps the prior in-memory archive when a write fails', () => {
    const values = new Map<string, string>();
    let failWrites = false;
    const storage: GuidedBrowserStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        if (failWrites) throw new Error('quota exceeded');
        values.set(key, value);
      },
      removeItem: (key) => { values.delete(key); }
    };
    const store = createGuidedPlanStore({ storage, createId: () => 'plan-1' });
    expect(store.initialize()).toBe(true);
    const before = store.archive.value;
    failWrites = true;

    expect(store.createPlan(planRecord())).toBeNull();
    expect(store.archive.value).toEqual(before);
    expect(store.storageAvailable.value).toBe(false);
    expect(store.storageError.value).toContain('save failed');
  });

  it('adopts a newer stored archive when merging it fails to write', () => {
    const values = new Map<string, string>();
    let failWrites = false;
    const storage: GuidedBrowserStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        if (failWrites) throw new Error('quota exceeded');
        values.set(key, value);
      },
      removeItem: (key) => { values.delete(key); }
    };
    const store = createGuidedPlanStore({ storage, createId: () => 'local-plan' });
    expect(store.initialize()).toBe(true);
    const external = {
      ...emptyGuidedPlanArchive(),
      plans: { 'external-plan': planRecord() }
    };
    storage.setItem(GUIDED_PLAN_STORAGE_KEY, JSON.stringify(external));
    failWrites = true;

    expect(store.createPlan(planRecord())).toBeNull();
    expect(store.archive.value).toEqual(external);
    expect(store.storageError.value).toContain('save failed');
  });

  it('keeps the last valid archive on a damaged storage event and recovers on a later event', () => {
    const storage = memoryStorage();
    const store = createGuidedPlanStore({ storage, createId: () => 'plan-1' });
    expect(store.initialize()).toBe(true);
    expect(store.createPlan(planRecord())).toBe('plan-1');
    const before = store.archive.value;
    storage.setItem(GUIDED_PLAN_STORAGE_KEY, '{broken-json');

    expect(store.handleStorageEvent({ key: GUIDED_PLAN_STORAGE_KEY })).toBe(false);
    expect(store.archive.value).toBe(before);
    expect(store.storageAvailable.value).toBe(false);

    const repaired = emptyGuidedPlanArchive();
    storage.setItem(GUIDED_PLAN_STORAGE_KEY, JSON.stringify(repaired));
    expect(store.handleStorageEvent({ key: GUIDED_PLAN_STORAGE_KEY })).toBe(true);
    expect(store.archive.value).toEqual(repaired);
    expect(store.storageAvailable.value).toBe(true);
    expect(store.storageError.value).toBe('');
  });

  it('ignores unrelated storage events', () => {
    const storage = memoryStorage();
    const store = createGuidedPlanStore({ storage, createId: () => 'plan-1' });
    expect(store.initialize()).toBe(true);

    expect(store.handleStorageEvent({ key: WORKSPACE_STORAGE_KEY })).toBe(false);
    expect(store.handleStorageEvent({
      key: GUIDED_PLAN_STORAGE_KEY,
      storageArea: memoryStorage()
    })).toBe(false);
    expect(store.storageAvailable.value).toBe(true);
  });

  it('clears guided plans and metrics without deleting advanced workspaces', () => {
    const storage = memoryStorage();
    storage.setItem(WORKSPACE_STORAGE_KEY, 'advanced-data');
    storage.setItem(GUIDED_METRICS_STORAGE_KEY, 'guided-metrics');
    const store = createGuidedPlanStore({ storage, createId: () => 'plan-1' });
    expect(store.initialize()).toBe(true);
    expect(store.createPlan(planRecord())).toBe('plan-1');

    expect(store.clearGuidedData()).toEqual({ ok: true, plansCleared: true, metricsCleared: true });

    expect(storage.getItem(GUIDED_PLAN_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(GUIDED_METRICS_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(WORKSPACE_STORAGE_KEY)).toBe('advanced-data');
    expect(store.archive.value).toEqual(emptyGuidedPlanArchive());
  });

  it('retains plans when clearing metrics fails and reports partial clearing when plans fail', () => {
    const values = new Map<string, string>();
    let failingKey = GUIDED_METRICS_STORAGE_KEY;
    const storage: GuidedBrowserStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value); },
      removeItem: (key) => {
        if (key === failingKey) throw new Error('blocked');
        values.delete(key);
      }
    };
    const store = createGuidedPlanStore({ storage, createId: () => 'plan-1' });
    expect(store.initialize()).toBe(true);
    expect(store.createPlan(planRecord())).toBe('plan-1');
    storage.setItem(GUIDED_METRICS_STORAGE_KEY, 'metrics');

    expect(store.clearGuidedData()).toEqual({ ok: false, plansCleared: false, metricsCleared: false });
    expect(storage.getItem(GUIDED_PLAN_STORAGE_KEY)).not.toBeNull();
    expect(storage.getItem(GUIDED_METRICS_STORAGE_KEY)).toBe('metrics');

    failingKey = GUIDED_PLAN_STORAGE_KEY;
    expect(store.clearGuidedData()).toEqual({ ok: false, plansCleared: false, metricsCleared: true });
    expect(storage.getItem(GUIDED_PLAN_STORAGE_KEY)).not.toBeNull();
    expect(storage.getItem(GUIDED_METRICS_STORAGE_KEY)).toBeNull();
    expect(store.archive.value.plans['plan-1']).toBeDefined();
  });

  it('reports unavailable browser storage without creating in-memory-only plans', () => {
    const store = createGuidedPlanStore({ storage: null, createId: () => 'plan-1' });

    expect(store.initialize()).toBe(false);
    expect(store.createPlan(planRecord())).toBeNull();
    expect(store.archive.value).toEqual(emptyGuidedPlanArchive());
    expect(store.storageError.value).toContain('unavailable');
  });
});
