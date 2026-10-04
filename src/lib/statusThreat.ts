import type { PokemonStats } from './pokedexTypes';
import { effectiveOffense } from './statMetrics';

/**
 * What a status immunity is worth, derived rather than asserted.
 *
 * Purifying Salt was the last hand-picked constant in the model with a
 * measurable alternative, and it had the same defect the resist abilities did:
 * a single number on the bulk term, for an effect that is not bulk and does not
 * mean the same thing to two different Pokemon. Garganacl is a physical
 * attacker that was never fast, so burn costs it 0.1068 of quality and
 * paralysis 0.0231 — a four-fold difference one multiplier cannot express.
 *
 * ## Where the frequency comes from
 *
 * `statusMoveData.ts`, which is new: until it existed nothing in the repo knew
 * how often status happens, because `coverageMoveData` deliberately drops status
 * moves and abilities alone reach only 11% of the roster.
 *
 * The precedent for using it is Mold Breaker, recorded in `abilityEffects.ts`:
 * an opponent-facing effect is measurable because the pool this tool scores is a
 * legitimate stand-in for the opponent. Note what that does *not* concede.
 * Crediting Purifying Salt assumes nothing about the moveset of the Pokemon
 * being scored — only about what the field it faces can do. That is exactly the
 * line separating this from Prankster, whose worth lives in its own moves, and
 * it is why this is derivable where Prankster is not.
 *
 * ## What the frequency means, and the assumption inside it
 *
 * `STATUS_THREAT` is the share of the legal pool that can *reliably* inflict
 * each condition, and it is used as the probability the condition lands. That
 * equates "can" with "will", which is the Mold Breaker convention — it took
 * 20.7% of species carrying a relevant ability as the probability of the
 * relevant matchup, without further discounting for whether the situation
 * arises.
 *
 * Following it here keeps the two consistent, and it is stated rather than
 * buried because it is the one soft spot in the derivation. It biases the result
 * **upward**: a Pokemon that can learn Will-O-Wisp is not certain to carry it.
 *
 * Pulling the other way, and by more: burn and paralysis are the only two
 * conditions the model can price, because they map onto terms it already
 * computes. Poison reaches 13.9% of the pool and sleep 13.0%, and both cost
 * exactly nothing here — there is no term for chip damage over time or for
 * losing turns. Together those are a larger omission than the "can/will" gap is
 * an overstatement, which is why the result below is best read as a floor.
 */

/**
 * Share of the legal pool that can reliably inflict each condition.
 *
 * Measured 2026-08-13 by `npm run measure:status-threat` over the 208 legal
 * species of Regulation M-B in default form — the same denominator the Mold
 * Breaker measurement used, because a Pokemon faces opponents and an opponent is
 * a species someone registered.
 *
 * Only the two conditions with a term to land on are here. The measurement also
 * reports poison at 0.1394 and sleep at 0.1298; they are recorded in the script
 * output and deliberately unused. Rerun after a regulation changes the roster.
 */
export const STATUS_THREAT = {
  burn: 0.2115,
  paralysis: 0.3269
} as const;

/** Date the roster was measured for the frequencies above. */
export const MEASURED_ON = '2026-08-13';

/**
 * Abilities granting blanket immunity to every non-volatile status.
 *
 * Only Purifying Salt qualifies on the current roster. Good as Gold blocks
 * status *moves* — which is most of where status comes from — but not Toxic
 * Spikes or a Flame Body contact burn, and it is deliberately not here: it is
 * broader in one direction and narrower in another, and folding it in on the
 * grounds of being roughly similar is how a table stops meaning anything.
 * Scoring it is a separate decision with its own measurement.
 */
const STATUS_IMMUNITY_ABILITIES = new Set(['purifying-salt']);

/**
 * Reports whether an ability blocks every non-volatile status condition.
 *
 * @param abilityName PokeAPI ability name.
 * @returns True when the multipliers below apply to its carrier.
 */
export function grantsStatusImmunity(abilityName: string | undefined | null): boolean {
  return !!abilityName && STATUS_IMMUNITY_ABILITIES.has(abilityName);
}

/**
 * Multipliers a full status immunity earns on the terms it protects.
 *
 * Framed as a credit to the immune Pokemon rather than a penalty on everyone
 * else, because every other entry in the ability tables is a credit and one
 * penalty among them would invert the sign of a whole table's reasoning.
 *
 * The arithmetic is an expectation. A Pokemon that can be burned brings, on
 * average, `(1 - p) * full + p * burned` of its offence to a game; an immune one
 * brings `full`. The ratio of those is what the immunity is worth, and it falls
 * out of the stat line with no constant beyond the measured frequency.
 *
 * Burn halves Attack, so `effectiveOffense` does the work and the physical /
 * special split it already models is what makes the answer differ per Pokemon —
 * a special attacker is barely inconvenienced. Paralysis halves Speed, which is
 * proportional, so that multiplier is the same for everyone before rescaling;
 * `OBSERVED_STAT_TERMS` then makes its *effect* differ, giving less to a Pokemon
 * already near the top of the speed range.
 *
 * @param stats Base stats, before any stat-changing ability.
 * @returns Offence and speed multipliers, each at least 1.
 */
export function getStatusImmunityMultipliers(
  stats: PokemonStats
): { offense: number; speed: number } {
  const full = effectiveOffense(stats);
  const burned = effectiveOffense({ ...stats, attack: stats.attack / 2 });
  const expectedOffense = ((1 - STATUS_THREAT.burn) * full) + (STATUS_THREAT.burn * burned);

  // A Pokemon with no attacking stat at all has nothing to protect. Guarding the
  // divide rather than assuming it cannot happen: Ditto's 48/48 is close enough
  // to the floor that a future roster could reach zero here.
  const offense = expectedOffense > 0 ? full / expectedOffense : 1;

  // Paralysis halves Speed outright, so the ratio is 1 / (1 - p/2) and carries
  // no dependence on the stat line.
  const speed = 1 / (1 - (STATUS_THREAT.paralysis / 2));

  return { offense, speed };
}
