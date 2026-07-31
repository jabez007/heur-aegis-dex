import { describe, expect, it } from 'vitest';
import { createGuidedPlan, type GuidedPlanState } from './guidedPlanReducer';
import {
  createGuidedPlanRecord,
  deleteGuidedPlanRecord,
  emptyGuidedPlanArchive,
  GUIDED_PLAN_STORAGE_KEY,
  isGuidedPlanRecord,
  readGuidedPlanArchive,
  setActiveGuidedPlanId,
  setDraftGuidedPlanId,
  updateGuidedPlanRecord,
  writeGuidedPlanArchive,
  type GuidedPlanArchiveV1,
  type GuidedPlanRecordV1,
  type GuidedPlanStorage
} from './guidedPlanPersistence';
import { WORKSPACE_STORAGE_KEY } from './workspacePersistence';

const planState = (): GuidedPlanState => {
  const created = createGuidedPlan({
    format: 'doubles',
    lockedFavorites: [{
      varietyName: 'favorite-form',
      speciesName: 'favorite',
      abilityName: 'favorite-ability'
    }]
  });
  if (!created.ok) throw new Error('fixture plan creation failed');
  return created.state;
};

const planRecord = (): GuidedPlanRecordV1 => ({
  updatedAt: '2026-07-31T12:00:00Z',
  lastCompletedStep: 'favorites-locked',
  scan: {
    regulation: 'regulation-i',
    region: 'national',
    minimumAttacks: 80,
    minimumBulk: 70,
    allowMegas: false,
    includeAbilityImmunities: true,
    includeMoveCoverage: true,
    scanRevision: 'scan-revision-1'
  },
  state: planState()
});

const memoryStorage = (): GuidedPlanStorage => {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); }
  };
};

describe('guided plan persistence', () => {
  it('round trips a separate versioned archive keyed by plan ID', () => {
    const storage = memoryStorage();
    const archive: GuidedPlanArchiveV1 = {
      ...emptyGuidedPlanArchive(),
      activePlanId: 'plan-1',
      draftPlanId: 'plan-1',
      plans: { 'plan-1': planRecord() }
    };

    writeGuidedPlanArchive(storage, archive);

    expect(readGuidedPlanArchive(storage)).toEqual(archive);
    expect(readGuidedPlanArchive(storage).plans['plan-1']).not.toHaveProperty('recommendations');
  });

  it('rejects malformed scan, step, and reducer state records', () => {
    const record = planRecord();
    expect(isGuidedPlanRecord({ ...record, lastCompletedStep: 'invented-step' })).toBe(false);
    expect(isGuidedPlanRecord({ ...record, recommendations: [] })).toBe(false);
    expect(isGuidedPlanRecord({ ...record, lastCompletedStep: 'partner-added' })).toBe(false);
    expect(isGuidedPlanRecord({ ...record, lastCompletedStep: 'path-forked' })).toBe(false);
    expect(isGuidedPlanRecord({ ...record, scan: { ...record.scan, minimumBulk: NaN } })).toBe(false);
    expect(isGuidedPlanRecord({ ...record, scan: { ...record.scan, derivedNeed: 'fire' } })).toBe(false);
    expect(isGuidedPlanRecord({
      ...record,
      state: {
        ...record.state,
        branch: {
          ...record.state.branch,
          paths: { A: { ...record.state.branch.paths.A, status: 'limit-reached' } }
        }
      }
    })).toBe(false);
    expect(isGuidedPlanRecord({
      ...record,
      state: { ...record.state, excludedSpecies: ['z-species', 'a-species'] }
    })).toBe(false);
    expect(isGuidedPlanRecord({
      ...record,
      state: {
        ...record.state,
        branch: {
          ...record.state.branch,
          paths: { ...record.state.branch.paths, C: record.state.branch.paths.A }
        }
      }
    })).toBe(false);
    expect(isGuidedPlanRecord({
      ...record,
      scan: { ...record.scan, scanRevision: '', minimumAttacks: -1 }
    })).toBe(false);
  });

  it('salvages healthy plans and clears pointers to damaged plans', () => {
    const storage = memoryStorage();
    storage.setItem(GUIDED_PLAN_STORAGE_KEY, JSON.stringify({
      version: 1,
      activePlanId: 'broken',
      draftPlanId: 'healthy',
      plans: {
        healthy: planRecord(),
        broken: { updatedAt: 'not-a-date' }
      }
    }));

    expect(readGuidedPlanArchive(storage)).toEqual({
      version: 1,
      activePlanId: null,
      draftPlanId: 'healthy',
      plans: { healthy: planRecord() }
    });
  });

  it('fails closed for malformed envelopes and unknown versions', () => {
    const storage = memoryStorage();
    storage.setItem(GUIDED_PLAN_STORAGE_KEY, JSON.stringify({ version: 2, plans: {} }));
    expect(() => readGuidedPlanArchive(storage)).toThrow('damaged or unsupported');

    storage.setItem(GUIDED_PLAN_STORAGE_KEY, JSON.stringify({ version: 1, plans: [] }));
    expect(() => readGuidedPlanArchive(storage)).toThrow('damaged or unsupported');
  });

  it('retains unresolved Pokemon and abilities as authoritative references', () => {
    const storage = memoryStorage();
    const unresolved: GuidedPlanRecordV1 = {
      ...planRecord(),
      state: {
        ...planState(),
        lockedFavorites: [{
          varietyName: 'missing-variety',
          speciesName: 'missing-species',
          abilityName: 'missing-ability'
        }]
      }
    };
    const archive: GuidedPlanArchiveV1 = {
      ...emptyGuidedPlanArchive(),
      plans: { unresolved }
    };

    writeGuidedPlanArchive(storage, archive);

    expect(readGuidedPlanArchive(storage).plans.unresolved.state.lockedFavorites[0])
      .toEqual(unresolved.state.lockedFavorites[0]);
  });

  it('creates, updates, selects, and deletes independently keyed records', () => {
    const created = createGuidedPlanRecord(emptyGuidedPlanArchive(), planRecord(), () => 'plan-1');
    expect(created.planId).toBe('plan-1');
    expect(() => createGuidedPlanRecord(created.archive, planRecord(), () => 'plan-1'))
      .toThrow('unique guided plan identifier');

    const changed = { ...planRecord(), updatedAt: '2026-07-31T13:00:00Z' };
    const updated = updateGuidedPlanRecord(created.archive, 'plan-1', changed);
    const selected = setDraftGuidedPlanId(setActiveGuidedPlanId(updated, 'plan-1'), 'plan-1');
    expect(selected).toMatchObject({
      activePlanId: 'plan-1',
      draftPlanId: 'plan-1',
      plans: { 'plan-1': changed }
    });
    expect(deleteGuidedPlanRecord(selected, 'plan-1')).toEqual(emptyGuidedPlanArchive());
    expect(() => setActiveGuidedPlanId(created.archive, 'missing')).toThrow('does not exist');
    expect(() => updateGuidedPlanRecord(created.archive, 'missing', changed)).toThrow('does not exist');
  });

  it('snapshots caller-owned records when creating and updating plans', () => {
    const mutable = {
      ...planRecord(),
      scan: { ...planRecord().scan }
    };
    const created = createGuidedPlanRecord(emptyGuidedPlanArchive(), mutable, () => 'plan-1');
    mutable.scan.minimumBulk = 999;

    expect(created.archive.plans['plan-1'].scan.minimumBulk).toBe(70);
    expect(created.archive.plans['plan-1']).not.toBe(mutable);

    const replacement = { ...planRecord(), scan: { ...planRecord().scan, minimumBulk: 60 } };
    const updated = updateGuidedPlanRecord(created.archive, 'plan-1', replacement);
    replacement.scan.minimumBulk = 999;
    expect(updated.plans['plan-1'].scan.minimumBulk).toBe(60);
  });

  it('leaves prior guided and advanced data intact when a write fails', () => {
    const values = new Map<string, string>([
      [GUIDED_PLAN_STORAGE_KEY, JSON.stringify(emptyGuidedPlanArchive())],
      [WORKSPACE_STORAGE_KEY, 'advanced-workspace-data']
    ]);
    const storage: GuidedPlanStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: () => { throw new Error('quota exceeded'); }
    };
    const archive: GuidedPlanArchiveV1 = {
      ...emptyGuidedPlanArchive(),
      plans: { 'plan-1': planRecord() }
    };

    expect(() => writeGuidedPlanArchive(storage, archive)).toThrow('quota exceeded');
    expect(storage.getItem(GUIDED_PLAN_STORAGE_KEY)).toBe(JSON.stringify(emptyGuidedPlanArchive()));
    expect(storage.getItem(WORKSPACE_STORAGE_KEY)).toBe('advanced-workspace-data');
  });

  it('cannot damage advanced workspaces when guided data is corrupt', () => {
    const storage = memoryStorage();
    storage.setItem(WORKSPACE_STORAGE_KEY, 'advanced-workspace-data');
    storage.setItem(GUIDED_PLAN_STORAGE_KEY, JSON.stringify({ version: 99, plans: {} }));

    expect(() => readGuidedPlanArchive(storage)).toThrow('damaged or unsupported');
    expect(storage.getItem(WORKSPACE_STORAGE_KEY)).toBe('advanced-workspace-data');
  });
});
