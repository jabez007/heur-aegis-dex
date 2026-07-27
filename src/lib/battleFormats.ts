/**
 * Battle formats.
 *
 * Play! Pokémon runs a roster-and-selection structure: you register up to six
 * Pokemon (the "show"), your opponent sees all of them under open team list,
 * and you pick a subset to actually battle with (the "bring"). Singles brings
 * three, doubles brings four.
 *
 * That distinction matters for more than slot count. A six-Pokemon roster is
 * not a team that fights together — only the brought subset does. A roster is
 * good when it *contains* strong subsets across the matchups you expect, which
 * is a different question from whether all six work as a unit.
 *
 * Format also decides which synergy applies. Spread-move safety only exists in
 * doubles, where an ally shares the field and eats your Earthquake. Scoring it
 * in singles would reward a property that cannot occur.
 */

export type BattleFormatId = 'singles' | 'doubles';

export interface BattleFormat {
  id: BattleFormatId;
  label: string;
  /** Largest registerable roster. */
  maxRosterSize: number;
  /** Smallest registerable roster. */
  minRosterSize: number;
  /** How many of the roster enter a battle. */
  broughtToBattle: number;
  /** Pokemon on the field per side at once. */
  activePerSide: number;
  /** Whether an ally shares the field, making spread-move safety meaningful. */
  hasAlly: boolean;
}

export const BATTLE_FORMATS: Readonly<Record<BattleFormatId, BattleFormat>> = {
  singles: {
    id: 'singles',
    label: 'Singles (bring 3)',
    minRosterSize: 3,
    maxRosterSize: 6,
    broughtToBattle: 3,
    activePerSide: 1,
    hasAlly: false
  },
  doubles: {
    id: 'doubles',
    label: 'Doubles (bring 4)',
    minRosterSize: 4,
    maxRosterSize: 6,
    broughtToBattle: 4,
    activePerSide: 2,
    hasAlly: true
  }
};

export const BATTLE_FORMAT_LIST: readonly BattleFormat[] = [
  BATTLE_FORMATS.singles,
  BATTLE_FORMATS.doubles
];

/** VGC is played in doubles, so it is the default everywhere a format is optional. */
export const DEFAULT_BATTLE_FORMAT: BattleFormatId = 'doubles';

/**
 * Looks up a battle format, falling back to the default for unknown ids.
 *
 * @param id Format identifier.
 * @returns The matching format, or the default when unrecognised.
 */
export function getBattleFormat(id: string | null | undefined): BattleFormat {
  if (id && id in BATTLE_FORMATS) return BATTLE_FORMATS[id as BattleFormatId];
  return BATTLE_FORMATS[DEFAULT_BATTLE_FORMAT];
}

/**
 * Enumerates every way to bring `size` members from a roster.
 *
 * Roster sizes are capped at six, so the largest result is 20 subsets and
 * enumerating them exhaustively is cheaper than any cleverness.
 *
 * @param items Roster to draw from.
 * @param size How many to bring.
 * @returns Every distinct subset of exactly `size` items, or empty when impossible.
 */
export function combinationsOf<T>(items: T[], size: number): T[][] {
  if (size <= 0 || size > items.length) return [];
  if (size === items.length) return [[...items]];

  const results: T[][] = [];
  const current: T[] = [];

  const walk = (start: number) => {
    if (current.length === size) {
      results.push([...current]);
      return;
    }
    // Stop when too few items remain to ever fill the subset.
    for (let i = start; i <= items.length - (size - current.length); i++) {
      current.push(items[i]);
      walk(i + 1);
      current.pop();
    }
  };

  walk(0);
  return results;
}
