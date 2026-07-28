/**
 * Roster generation over Pokemon.
 *
 * The original generator searched *type combinations* and attached whichever
 * Pokemon happened to sort first within each. That made two Pokemon sharing a
 * typing mutually exclusive, and meant the search optimised typings while the
 * user cared about Pokemon.
 *
 * This searches the Pokemon directly. The only identity constraint is the real
 * one: no duplicate species.
 *
 * Like the type search this is a beam, not an exhaustive enumeration, and it
 * prunes twice over:
 *
 * 1. Candidates are ranked individually and only the strongest are considered,
 *    because the eligible pool runs to hundreds of Pokemon.
 * 2. Partial rosters are scored as if they were the whole team, since a
 *    half-built roster has no bring options to evaluate yet.
 *
 * Completed rosters are then re-scored properly with evaluateRoster. Pruning on
 * one metric and ranking on another is a heuristic, not a guarantee — callers
 * must not describe the result as optimal.
 */

import { evaluateRoster, scoreBring, type RosterEvaluation, type RosterMember } from './rosterScoring';
import { scoreMemberQuality } from './teamScoring';
import { DEFAULT_BASE_SCORE } from './pokedexScoring';
import { getAbilityEffect, getApplicableRoles, soloRoleValue } from './abilityRoles';
import type { BattleFormat } from './battleFormats';
import type { PokemonEntry } from './pokemonEntry';

/** Partial rosters kept at each expansion step. */
export const ROSTER_BEAM_WIDTH = 128;

/** How many individually-strongest Pokemon the search will consider. */
export const DEFAULT_CANDIDATE_LIMIT = 160;

/**
 * Weights for ranking a single Pokemon before the search begins.
 *
 * ## Why this is built on scoreMemberQuality
 *
 * The earlier version summed typing and stats as independent terms, and paid
 * for defensive typing three separate times: once as `defensiveTyping`, again
 * per resistance, and again per weakness. But `normalizedDamageFromScore` *is*
 * a summary of resistances and weaknesses — `calculateDamageFromScore` sums
 * exactly those buckets — so all three measured one property. Across a real
 * comparison that came to a 27-point spread on typing against 4 points on
 * stats, a ratio of roughly seven to one that nothing had chosen.
 *
 * Stats were the other half of the problem. `statsTotal` is stat-blind, so
 * Klefki's unusable 80/80 offences counted the same as Lucario's 110/115. The
 * result was a Pokemon with the best defensive typing in the game outranking
 * two that beat it comfortably in practice.
 *
 * `scoreMemberQuality` already solves this, is documented, and is what the team
 * scorer actually uses — so ranking a candidate now means asking the same
 * question the team scorer will ask later, rather than a parallel approximation
 * of it. Typing *modulates* stats there instead of being added beside them, so
 * elite typing multiplies bulk a Pokemon has without inventing offence it does
 * not. Typing stays central to the ranking, which is true to what this tool is
 * for; it simply stops being counted three times.
 *
 * ## The remaining terms, and the budget they share
 *
 * Each covers something member quality genuinely cannot see. Their sizes are
 * set against the *observed* spread of the quality term rather than picked
 * independently, because that is the mistake this file already made once.
 *
 * Across the validation fixture `quality * 100` runs from about 33 to 62 — a
 * span near 30 points. The adjuncts must therefore be able to reorder Pokemon
 * whose quality is close, and must never invert a real quality gap. Their
 * combined swing is held to roughly a third of that span.
 *
 * The first version of this rework failed exactly there: `supportRole` at 12
 * and `quadrupleWeakness` at 15 were carried over from the previous formula,
 * whose terms ran to 44. On the compressed scale they added up to 27 points of
 * adjustment against a 30-point base, and ranked Arbok above Garchomp. The
 * validation fixture caught it; nothing else would have.
 *
 * All of these are still reasoned rather than measured against match outcomes,
 * as with MEMBER_WEIGHTS and MIXED_ATTACKER_RATIO. The fixture constrains them;
 * it does not derive them.
 */
export const CANDIDATE_WEIGHTS = {
  /** scoreMemberQuality is 0..1; this puts it on a 0..100 scale. */
  quality: 100,
  /**
   * Support roles are invisible to a stat-and-typing score, and this ranking
   * decides which DEFAULT_CANDIDATE_LIMIT Pokemon the search ever looks at — so
   * without this a support Pokemon could be cut before team synergy, which does
   * weigh roles, had any chance to see it. Enough to lift a supporter past a
   * near-equal Pokemon without one; nowhere near enough to make Intimidate turn
   * an unusable Pokemon into a good one.
   *
   * Weather and terrain setters earn a fraction of this — see soloRoleValue.
   * Their payoff depends on teammates that want the field changed, which team
   * scoring evaluates and a solo ranking cannot.
   *
   * ## Why this fell from 4 to 2
   *
   * The same calibration defect as the removed quadruple penalty, found by checking
   * this weight's own stated unit. It claimed to be "about three resistances" —
   * but that unit came from an older formula where resistances were explicit
   * terms, and the rework onto `scoreMemberQuality` folded them into the
   * defensive score without anyone restating what a resistance costs. Under the
   * empirical bounds a resistance is worth 0.42 points, so 4 was buying **9.5**
   * of them, and the comment describing it had been wrong for two reworks.
   *
   * 2 is roughly five resistances. Still more than the stale claim, and
   * deliberately so: this ranking's job is to keep supporters from being pruned
   * out of the candidate pool before team synergy — which weighs roles properly —
   * ever sees them. It is not meant to rank them first on its own.
   *
   * The invariant worth holding is that a role never offsets a quadruple
   * weakness. With the flat quadruple penalty removed, that charge is the 2.52
   * the defensive score applies, so this has to stay below 2.52 outright rather
   * than below a combined figure. 2.5 would technically hold it by 0.02, which is
   * a margin no one should rely on; 2 holds it with room to move either weight
   * without silently inverting the guarantee.
   */
  supportRole: 2,
  /** Breadth of STAB coverage, which the offensive score measures as strength rather than spread. */
  coverage: 0.75,
  /** Reachable coverage. A tiebreak: it says "can learn", never "would run". */
  moveCoverage: 0.2
} as const;

// There is deliberately no `quadrupleWeakness` term in CANDIDATE_WEIGHTS.
//
// ## Why it was removed
//
// It was the third charge for one property. A 4x weakness was paid for by
// `calculateDamageFromScore`, which adds 3 against 1 for a double; again by a
// flat penalty in CANDIDATE_WEIGHTS; and again by team scoring, which charges it
// three separate ways — `quadrupleWeakness`, `uncoveredQuadrupleWeakness` and
// `sharedQuadrupleWeakness`. That is the same shape as the defect the previous
// rework of this file removed, where defensive typing was paid for three times
// over; it simply went unnoticed on a different property.
//
// The flat charge was also the worst-placed of the three. Whether a quadruple
// weakness matters is a question about the *team*: is the weakness covered, is
// it shared with another member, does anything switch into it. Team scoring can
// ask all of that. Ranking a Pokemon alone cannot, and the honest charge in
// isolation is the average-case one the defensive score already applies.
//
// It was also the most expensive place to be wrong. This ranking prunes the
// pool to `DEFAULT_CANDIDATE_LIMIT`, so a Pokemon dropped here is never seen by
// the scorer that could have judged the risk properly. Wrongly excluding
// Scizor — nine resistances, one immunity, one weakness — costs more than
// wrongly including it, because the team scorer can still reject it later and
// can never recover it.
//
// The visible symptom was Scizor ranking below Blastoise, Feraligatr and
// Klefki despite beating all three on member quality. Its entire deficit was
// this penalty.
//
// Removing it does not make the model blind to quadruple weaknesses: Dragonite
// and Garchomp still carry a materially worse defensive score than Skarmory for
// exactly this reason, and a roster that stacks the weakness is still penalised
// where the stacking can be seen.


export interface GenerateRostersOptions {
  /** Eligible Pokemon, already filtered by the scan. */
  pokemon: PokemonEntry[];
  format: BattleFormat;
  /** Defaults to the format's maximum roster size. */
  rosterSize?: number;
  /** Pokemon that must appear in every generated roster. */
  seed?: PokemonEntry[];
  /** Number of elemental types in play. */
  typeCount?: number;
  /** Champions forbids duplicate Pokedex numbers, so this defaults to false. */
  allowDuplicateSpecies?: boolean;
  candidateLimit?: number;
}

export interface GeneratedRoster {
  members: PokemonEntry[];
  evaluation: RosterEvaluation;
  /** The roster's blended bring score, in 0..100. */
  score: number;
}

const toRosterMember = (entry: PokemonEntry): RosterMember => ({
  name: entry.name,
  types: entry.types,
  abilityName: entry.abilityName,
  stats: entry.stats,
  weaknesses: entry.weaknesses,
  quadruple_weaknesses: entry.quadrupleWeaknesses,
  resistances: entry.resistances,
  immunities: entry.immunities,
  coverages: entry.coverages,
  moveCoverages: entry.moveCoverages,
  normalizedDamageToScore: entry.normalizedDamageToScore,
  normalizedDamageFromScore: entry.normalizedDamageFromScore
});

/**
 * Ranks one Pokemon on its own merits, to decide what the search looks at.
 *
 * Scores the role of the ability *currently selected*, not every role the
 * Pokemon could theoretically fill. Choosing Blaze over Intimidate on an
 * Incineroar should cost it the credit, and the browser applies the user's
 * ability override before ranking so the order responds to that choice.
 *
 * @param entry Pokemon to rank.
 * @param options Format traits. Redirection and ally protection do nothing without an ally, so singles must not credit them.
 * @returns A score on an arbitrary scale; only the ordering matters.
 */
export function candidatePriority(entry: PokemonEntry, options: { hasAlly?: boolean } = {}): number {
  const { hasAlly = true } = options;
  const w = CANDIDATE_WEIGHTS;

  // Scored in isolation, so a role that needs teammates to pay off earns less
  // than one that works the moment the Pokemon is on the field.
  const effect = getAbilityEffect(entry.abilityName);
  const roleValue = effect && getApplicableRoles(hasAlly).includes(effect.role)
    ? soloRoleValue(effect.role)
    : 0;

  // Stats modulated by typing, on the same terms the team scorer will use.
  // Resistances and weaknesses are not added separately: they are already what
  // normalizedDamageFromScore measures.
  const quality = scoreMemberQuality({
    stats: entry.stats,
    normalizedDamageToScore: entry.normalizedDamageToScore,
    normalizedDamageFromScore: entry.normalizedDamageFromScore,
    abilityName: entry.abilityName
  });

  return (quality * w.quality) +
    (roleValue * w.supportRole) +
    (entry.coverages.length * w.coverage) +
    (entry.moveCoverages.length * w.moveCoverage);
}

/**
 * Builds rosters from a Pokemon pool, ranked by the bring options they offer.
 *
 * @param options Pool, format, roster size, seed and pruning limits.
 * @returns Rosters ordered by score, best first. May be empty.
 */
export function generateRosters(options: GenerateRostersOptions): GeneratedRoster[] {
  const {
    pokemon,
    format,
    rosterSize = format.maxRosterSize,
    seed = [],
    typeCount = DEFAULT_BASE_SCORE,
    allowDuplicateSpecies = false,
    candidateLimit = DEFAULT_CANDIDATE_LIMIT
  } = options;

  if (rosterSize <= 0 || seed.length > rosterSize) return [];

  const scoringOptions = { format, typeCount };
  const seedNames = new Set(seed.map((entry) => entry.name));
  const seedSpecies = new Set(seed.map((entry) => entry.speciesName));

  const candidates = pokemon
    .filter((entry) => !seedNames.has(entry.name))
    .filter((entry) => allowDuplicateSpecies || !seedSpecies.has(entry.speciesName))
    // Pre-pruning is where a support Pokemon is most easily lost, so the format
    // has to reach it: crediting redirection in singles would be as wrong as
    // ignoring it in doubles.
    .sort((a, b) => candidatePriority(b, { hasAlly: format.hasAlly }) - candidatePriority(a, { hasAlly: format.hasAlly }))
    .slice(0, Math.max(candidateLimit, rosterSize));

  if (seed.length + candidates.length < rosterSize) return [];

  // Partial rosters are scored as a team of their current size. Memoized on the
  // member set, since the beam revisits the same partials constantly.
  const partialScores = new Map<string, number>();
  const keyOf = (members: PokemonEntry[]) => members.map((m) => m.name).sort().join('|');
  const scorePartial = (members: PokemonEntry[]): number => {
    const key = keyOf(members);
    const cached = partialScores.get(key);
    if (cached !== undefined) return cached;
    const score = scoreBring(members.map(toRosterMember), scoringOptions);
    partialScores.set(key, score);
    return score;
  };

  const canAdd = (roster: PokemonEntry[], candidate: PokemonEntry): boolean => {
    if (roster.length >= rosterSize) return false;
    if (roster.some((member) => member.name === candidate.name)) return false;
    if (!allowDuplicateSpecies && roster.some((member) => member.speciesName === candidate.speciesName)) return false;
    return true;
  };

  let partials: PokemonEntry[][] = [[...seed]];

  candidates.forEach((candidate, index) => {
    const remaining = candidates.length - index - 1;
    const expanded = partials.flatMap((roster) => {
      const branches = [roster];
      if (canAdd(roster, candidate)) branches.push([...roster, candidate]);
      return branches;
    });

    const seen = new Set<string>();
    partials = expanded
      // Drop branches that can no longer reach a full roster.
      .filter((roster) => roster.length + remaining >= rosterSize)
      .filter((roster) => {
        const key = keyOf(roster);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => scorePartial(b) - scorePartial(a))
      .slice(0, ROSTER_BEAM_WIDTH);
  });

  return partials
    .filter((roster) => roster.length === rosterSize)
    .map((members) => {
      const evaluation = evaluateRoster(members.map(toRosterMember), scoringOptions);
      return { members, evaluation, score: evaluation.score };
    })
    .sort((a, b) => b.score - a.score);
}
