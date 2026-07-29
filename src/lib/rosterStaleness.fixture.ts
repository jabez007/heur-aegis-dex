/**
 * Shared staleness guard for the tables that were built by walking the roster.
 *
 * `battleForms.ts` and `unbreedableForms.ts` are both whitelists produced by
 * enumerating the varieties of every legal species at a point in time. That
 * makes them correct on the day they are written and quietly wrong afterwards:
 * a later regulation adds species, those species bring varieties, and a variety
 * that should have been recorded is instead simply absent. Absence is the one
 * failure mode neither table can express — it looks exactly like a considered
 * decision not to record something.
 *
 * So the guard is not on the tables' contents, which no test can know, but on
 * whether anyone has looked recently enough. Two assertions, because they catch
 * different mistakes and either alone leaves a way through:
 *
 * 1. **The walk is no older than the roster data.** Catches a roster re-verified
 *    against PokeAPI with no matching re-walk. That is a real alarm rather than
 *    a nuisance: PokeAPI gains varieties for species already on the roster, so a
 *    fresh look at the roster is a reason to look again at its forms.
 * 2. **The walk covered the species the roster now holds.** Catches the commoner
 *    mistake — species added while nobody touches dates — which the date check
 *    cannot see, since a new regulation copied in with an old `verifiedOn` slides
 *    straight past it.
 *
 * Lives in one file rather than being copied into each test because a duplicated
 * rule drifts, which is the same failure this guard exists to prevent.
 *
 * This is test infrastructure. The `.fixture.ts` suffix keeps it out of the
 * published type declarations, matching how the other test-only sources in
 * `src/` are excluded (see `vite.config.ts`).
 */

import { describe, expect, it } from 'vitest';
import { REGULATIONS } from './regulations';

export interface RosterWalk {
  /** Module name, used in failure messages so the alarm names its own table. */
  readonly table: string;
  /** `VERIFIED_ON` from that module: when the roster was last walked. */
  readonly verifiedOn: string;
  /** `VERIFIED_SPECIES_COUNT`: how many species that walk covered. */
  readonly speciesCount: number;
  /** What to re-walk when the guard fires, phrased as an instruction. */
  readonly rewalk: string;
}

/**
 * Declares the staleness tests for a table built by walking the roster.
 *
 * Call once per table from its own test file. Declares its own `describe` block,
 * and one `it` per assertion so a failure names which drift occurred rather than
 * collapsing both into a single red test.
 *
 * @param walk The table's recorded walk, and how to redo it.
 * @returns Nothing. Declares tests as a side effect, like `describe` itself.
 */
export function describeRosterStaleness(walk: RosterWalk): void {
  describe(`${walk.table} staleness against the regulation roster`, () => {
    it('has been walked no earlier than every regulation roster was verified', () => {
      const rosterVerifiedOn = REGULATIONS.map((regulation) => regulation.verifiedOn);

      // Both sides are ISO dates, so string ordering is date ordering — but only
      // while that holds, so it is asserted rather than assumed. A malformed date
      // would otherwise make the comparison below quietly meaningless, which is
      // the same class of silent failure this whole guard exists to remove.
      expect(walk.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      rosterVerifiedOn.forEach((date) => expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/));

      const newest = rosterVerifiedOn.reduce((a, b) => (a > b ? a : b));
      expect(
        walk.verifiedOn >= newest,
        `${walk.table} was walked on ${walk.verifiedOn}, but a regulation roster was verified on ${newest}. `
        + `${walk.rewalk} Then update VERIFIED_ON and VERIFIED_SPECIES_COUNT.`
      ).toBe(true);
    });

    it('has been walked against the current roster size', () => {
      const walked = new Set(REGULATIONS.flatMap((regulation) => [...regulation.legalSpecies]));

      expect(
        walked.size,
        `The regulations now cover ${walked.size} species, but ${walk.table} was walked against `
        + `${walk.speciesCount}. ${walk.rewalk} Then update VERIFIED_SPECIES_COUNT and VERIFIED_ON.`
      ).toBe(walk.speciesCount);
    });
  });
}
