import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceState } from './useWorkspaceState';

describe('useWorkspaceState', () => {
  const workspace = useWorkspaceState();

  beforeEach(() => {
    workspace.restoreScan({
      inPokedex: 'national',
      regulation: null,
      minimumAttacks: 80,
      minimumBulk: 70,
      allowMegas: false,
      includeAbilityImmunities: true,
      includeMoveCoverage: true
    });
    workspace.restoreAbilityOverrides({});
  });

  it('round trips scan settings without replacing an explicit Any regulation', () => {
    workspace.restoreScan({
      inPokedex: 'paldea',
      regulation: null,
      minimumAttacks: 90,
      minimumBulk: 75,
      allowMegas: true,
      includeAbilityImmunities: false,
      includeMoveCoverage: false
    });

    expect(workspace.snapshotScan()).toEqual({
      inPokedex: 'paldea',
      regulation: null,
      minimumAttacks: 90,
      minimumBulk: 75,
      allowMegas: true,
      includeAbilityImmunities: false,
      includeMoveCoverage: false
    });
  });

  it('migrates the old defense metric to the new effective-bulk default', () => {
    workspace.restoreScan({
      inPokedex: 'national',
      regulation: null,
      minimumStatsTotal: 440,
      minimumAttacks: 80,
      minimumDefenses: 82,
      allowMegas: false,
      includeAbilityImmunities: true,
      includeMoveCoverage: true
    });

    expect(workspace.minBulk.value).toBe(70);
    expect(workspace.snapshotScan()).not.toHaveProperty('minimumStatsTotal');
    expect(workspace.snapshotScan()).not.toHaveProperty('minimumDefenses');
  });

  it('replaces and updates ability overrides by Pokemon name', () => {
    workspace.restoreAbilityOverrides({ feraligatr: 'torrent' });
    workspace.setSelectedAbilityName('incineroar', 'intimidate');

    expect(workspace.selectedAbilityNames.value).toEqual({
      feraligatr: 'torrent',
      incineroar: 'intimidate'
    });
  });
});
