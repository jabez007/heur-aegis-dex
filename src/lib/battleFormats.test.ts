import { describe, expect, it } from 'vitest';
import {
  BATTLE_FORMATS,
  BATTLE_FORMAT_LIST,
  combinationsOf,
  getBattleFormat
} from './battleFormats';

describe('battle formats', () => {
  it('brings three in singles and four in doubles', () => {
    expect(BATTLE_FORMATS.singles.broughtToBattle).toBe(3);
    expect(BATTLE_FORMATS.doubles.broughtToBattle).toBe(4);
  });

  it('registers up to six in both formats', () => {
    BATTLE_FORMAT_LIST.forEach((format) => {
      expect(format.maxRosterSize).toBe(6);
      expect(format.minRosterSize).toBe(format.broughtToBattle);
    });
  });

  it('only doubles puts an ally on the field', () => {
    // Spread-move safety keys on this: with no ally there is nobody to hit.
    expect(BATTLE_FORMATS.singles.hasAlly).toBe(false);
    expect(BATTLE_FORMATS.doubles.hasAlly).toBe(true);
  });

  it('falls back to doubles for unknown ids, since VGC is doubles', () => {
    expect(getBattleFormat('singles').id).toBe('singles');
    expect(getBattleFormat('nonsense').id).toBe('doubles');
    expect(getBattleFormat(null).id).toBe('doubles');
    expect(getBattleFormat(undefined).id).toBe('doubles');
  });
});

describe('combinationsOf', () => {
  it('enumerates every bring-4 option from a roster of 6', () => {
    const roster = [1, 2, 3, 4, 5, 6];
    const subsets = combinationsOf(roster, 4);

    expect(subsets).toHaveLength(15);
    subsets.forEach((subset) => expect(subset).toHaveLength(4));
  });

  it('enumerates every bring-3 option from a roster of 6', () => {
    expect(combinationsOf([1, 2, 3, 4, 5, 6], 3)).toHaveLength(20);
  });

  it('returns the whole roster when it exactly fills the bring', () => {
    expect(combinationsOf([1, 2, 3], 3)).toEqual([[1, 2, 3]]);
  });

  it('returns nothing when the roster cannot fill the bring', () => {
    expect(combinationsOf([1, 2], 4)).toEqual([]);
    expect(combinationsOf([1, 2, 3], 0)).toEqual([]);
    expect(combinationsOf([], 3)).toEqual([]);
  });

  it('produces distinct subsets', () => {
    const keys = combinationsOf([1, 2, 3, 4, 5], 3).map((s) => s.join(','));
    expect(new Set(keys).size).toBe(keys.length);
  });
});
