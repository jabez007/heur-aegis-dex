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
import { getAbilityEffect, getApplicableRoles } from './abilityRoles';
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
   */
  supportRole: 4,
  /** Breadth of STAB coverage, which the offensive score measures as strength rather than spread. */
  coverage: 0.75,
  /** Reachable coverage. A tiebreak: it says "can learn", never "would run". */
  moveCoverage: 0.2,
  /**
   * A 4x weakness is a discrete build risk rather than a worse average: one
   * common attacking type removes the Pokemon from the game.
   *
   * The defensive score does charge for it — `calculateDamageFromScore` adds 3
   * for a quadruple against 1 for a double — but measured through normalization
   * and the bulk term that difference is worth **0.35 points** on this scale.
   * So this is not the reinforcement of an existing charge, which an earlier
   * version of this comment claimed; it is very nearly the whole charge, and
   * should be read that way when tuning it.
   *
   * Kept just above `supportRole`, so a role can never offset one.
   */
  quadrupleWeakness: 5
} as const;

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

  const effect = getAbilityEffect(entry.abilityName);
  const hasApplicableRole = !!effect && getApplicableRoles(hasAlly).includes(effect.role);

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
    ((hasApplicableRole ? 1 : 0) * w.supportRole) +
    (entry.coverages.length * w.coverage) +
    (entry.moveCoverages.length * w.moveCoverage) -
    (entry.quadrupleWeaknesses.length * w.quadrupleWeakness);
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
