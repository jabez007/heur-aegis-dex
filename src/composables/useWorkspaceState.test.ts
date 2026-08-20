import { beforeEach, describe, expect, it } from 'vitest';
import { getInitialRegulationSelection, useWorkspaceState } from './useWorkspaceState';

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
      includeMoveCoverage: false,
      limitQuadrupleDamage: false
    });

    expect(workspace.snapshotScan()).toEqual({
      inPokedex: 'paldea',
      regulation: null,
      minimumAttacks: 90,
      minimumBulk: 75,
      allowMegas: true,
      includeAbilityImmunities: false,
      includeMoveCoverage: false,
      limitQuadrupleDamage: false
    });
    expect(workspace.regulationSelectionRequired.value).toBe(false);
  });

  it('restores the quadruple-weakness filter to on when a workspace predates it', () => {
    // Workspaces saved while the filter was hardcoded carry no opinion on it.
    // Defaulting to on reopens them showing what they were saved showing.
    workspace.restoreScan({
      inPokedex: 'national',
      regulation: null,
      minimumAttacks: 80,
      minimumBulk: 70,
      allowMegas: false,
      includeAbilityImmunities: true,
      includeMoveCoverage: true
    });

    expect(workspace.limitQuadrupleDamage.value).toBe(true);
  });

  it('requires an explicit choice when no regulation is active', () => {
    expect(getInitialRegulationSelection(new Date('2027-01-01T00:00:00Z'))).toEqual({
      regulationId: '',
      selectionRequired: true
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
