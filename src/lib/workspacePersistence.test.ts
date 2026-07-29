import { describe, expect, it } from 'vitest';
import {
  deleteSavedWorkspace,
  emptyWorkspaceArchive,
  isWorkspaceSnapshot,
  mergeUnresolvedTeamIdentifiers,
  readWorkspaceArchive,
  renameSavedWorkspace,
  saveNamedWorkspace,
  WORKSPACE_STORAGE_KEY,
  writeWorkspaceArchive,
  type WorkspaceSnapshotV1,
  type WorkspaceStorage
} from './workspacePersistence';

const snapshot = (): WorkspaceSnapshotV1 => ({
  version: 1,
  scan: {
    inPokedex: 'national',
    regulation: null,
    minimumStatsTotal: 440,
    minimumAttacks: 80,
    minimumDefenses: 80,
    allowMegas: false,
    includeAbilityImmunities: true,
    includeMoveCoverage: true
  },
  meta: { selectedTypes: ['water', 'grass'], requireAllTypes: false },
  abilityOverrides: { feraligatr: 'torrent' },
  team: {
    format: 'doubles',
    roster: [{ pokemon: 'feraligatr', ability: 'torrent' }],
    bring: null,
    excluded: ['incineroar']
  }
});

const memoryStorage = (): WorkspaceStorage => {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); }
  };
};

describe('workspace persistence', () => {
  it('round trips a versioned archive', () => {
    const storage = memoryStorage();
    const archive = { ...emptyWorkspaceArchive(), draft: snapshot(), draftUpdatedAt: '2026-07-29T10:00:00Z' };

    writeWorkspaceArchive(storage, archive);

    expect(readWorkspaceArchive(storage)).toEqual(archive);
  });

  it('rejects malformed and unsupported snapshots', () => {
    expect(isWorkspaceSnapshot({ ...snapshot(), version: 2 })).toBe(false);
    expect(isWorkspaceSnapshot({ ...snapshot(), team: { ...snapshot().team, format: 'constructor' } })).toBe(false);
    expect(isWorkspaceSnapshot({ ...snapshot(), scan: { ...snapshot().scan, minimumAttacks: NaN } })).toBe(false);
    expect(isWorkspaceSnapshot({
      ...snapshot(),
      team: { ...snapshot().team, bring: ['feraligatr', 'feraligatr'] }
    })).toBe(false);
    expect(isWorkspaceSnapshot({
      ...snapshot(),
      team: { ...snapshot().team, bring: ['missing-pokemon'] }
    })).toBe(false);
  });

  it('reports damaged stored data instead of replacing it', () => {
    const storage = memoryStorage();
    storage.setItem(WORKSPACE_STORAGE_KEY, '{"version":1,"draft":"broken"}');

    expect(() => readWorkspaceArchive(storage)).toThrow('damaged or unsupported');
  });

  it('salvages valid saves when another named record is damaged', () => {
    const storage = memoryStorage();
    const archive = saveNamedWorkspace(
      emptyWorkspaceArchive(), 'Healthy', snapshot(), '2026-07-29T10:00:00Z', () => 'save-1'
    );
    storage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify({
      ...archive,
      saves: [...archive.saves, { id: 'broken', name: 'Broken' }]
    }));

    expect(readWorkspaceArchive(storage).saves.map((save) => save.name)).toEqual(['Healthy']);
  });

  it('creates and case-insensitively overwrites named snapshots', () => {
    const initial = saveNamedWorkspace(
      emptyWorkspaceArchive(), 'Rain Balance', snapshot(), '2026-07-29T10:00:00Z', () => 'save-1'
    );
    const changed = { ...snapshot(), team: { ...snapshot().team, format: 'singles' as const } };

    const overwritten = saveNamedWorkspace(
      initial, ' rain balance ', changed, '2026-07-29T11:00:00Z', () => 'save-2'
    );

    expect(overwritten.saves).toHaveLength(1);
    expect(overwritten.saves[0]).toMatchObject({ id: 'save-1', name: 'rain balance', snapshot: changed });
  });

  it('renames and deletes named saves without changing the draft', () => {
    const first = saveNamedWorkspace(
      { ...emptyWorkspaceArchive(), draft: snapshot() },
      'First', snapshot(), '2026-07-29T10:00:00Z', () => 'save-1'
    );
    const second = saveNamedWorkspace(first, 'Second', snapshot(), '2026-07-29T11:00:00Z', () => 'save-2');

    expect(() => renameSavedWorkspace(second, 'save-1', 'second')).toThrow('already exists');
    const renamed = renameSavedWorkspace(second, 'save-1', 'Renamed');
    const deleted = deleteSavedWorkspace(renamed, 'save-2');

    expect(deleted.saves.map((save) => save.name)).toEqual(['Renamed']);
    expect(deleted.draft).toEqual(snapshot());
  });

  it('rejects colliding generated IDs', () => {
    const first = saveNamedWorkspace(
      emptyWorkspaceArchive(), 'First', snapshot(), '2026-07-29T10:00:00Z', () => 'same-id'
    );

    expect(() => saveNamedWorkspace(
      first, 'Second', snapshot(), '2026-07-29T11:00:00Z', () => 'same-id'
    )).toThrow('unique workspace identifier');
  });

  it('retains unresolved roster identifiers across unrelated draft saves', () => {
    const restored = {
      ...snapshot().team,
      roster: [
        { pokemon: 'feraligatr', ability: 'torrent' },
        { pokemon: 'missing-pokemon', ability: 'missing-ability' }
      ],
      bring: ['feraligatr', 'missing-pokemon']
    };
    const current = {
      ...snapshot().team,
      roster: [{ pokemon: 'feraligatr', ability: 'sheer-force' }],
      bring: null
    };

    expect(mergeUnresolvedTeamIdentifiers(current, restored, new Set(['missing-pokemon']))).toMatchObject({
      roster: [
        { pokemon: 'feraligatr', ability: 'sheer-force' },
        { pokemon: 'missing-pokemon', ability: 'missing-ability' }
      ],
      bring: ['feraligatr', 'missing-pokemon']
    });
    expect(mergeUnresolvedTeamIdentifiers(
      current,
      restored,
      new Set(['missing-pokemon']),
      false
    ).bring).toBeNull();
  });
});
