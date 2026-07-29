import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceState } from './useWorkspaceState';

describe('useWorkspaceState', () => {
  const workspace = useWorkspaceState();

  beforeEach(() => {
    workspace.restoreScan({
      inPokedex: 'national',
      regulation: null,
      minimumStatsTotal: 440,
      minimumAttacks: 80,
      minimumDefenses: 80,
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
      minimumStatsTotal: 500,
      minimumAttacks: 90,
      minimumDefenses: 95,
      allowMegas: true,
      includeAbilityImmunities: false,
      includeMoveCoverage: false
    });

    expect(workspace.snapshotScan()).toEqual({
      inPokedex: 'paldea',
      regulation: null,
      minimumStatsTotal: 500,
      minimumAttacks: 90,
      minimumDefenses: 95,
      allowMegas: true,
      includeAbilityImmunities: false,
      includeMoveCoverage: false
    });
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
