import { beforeEach, describe, expect, it } from 'vitest';
import { ALL_TYPES, useMetaFilters } from './useMetaFilters';

describe('useMetaFilters workspace state', () => {
  const filters = useMetaFilters();

  beforeEach(() => {
    filters.selectAll();
    filters.requireAllTypes.value = false;
  });

  it('snapshots filters without exposing the mutable selected array', () => {
    filters.restoreMetaFilters({ selectedTypes: ['water', 'grass'], requireAllTypes: true });
    const snapshot = filters.snapshotMetaFilters();
    filters.selectedTypes.value.push('fire');

    expect(snapshot).toEqual({ selectedTypes: ['water', 'grass'], requireAllTypes: true });
  });

  it('drops unknown and duplicate type identifiers while restoring', () => {
    filters.restoreMetaFilters({
      selectedTypes: ['water', 'unknown', 'water', 'steel'],
      requireAllTypes: false
    });

    expect(filters.selectedTypes.value).toEqual(['water', 'steel']);
    expect(filters.selectedTypes.value.every((type) => ALL_TYPES.includes(type))).toBe(true);
  });
});
