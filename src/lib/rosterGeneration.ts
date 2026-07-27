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
 * `supportRole` is the odd one out: every other term measures typing or stats,
 * which is why the ranking used to be blind to Intimidate, Drizzle and
 * redirection entirely. That blindness had teeth — this ranking decides which
 * DEFAULT_CANDIDATE_LIMIT Pokemon the search ever looks at, so a support
 * Pokemon could be cut before team synergy, which does weigh roles, had any
 * chance to see it.
 *
 * The value is reasoned rather than validated: at 12 a role is worth three
 * resistances and well under a quadruple weakness, which puts Intimidate in the
 * right neighbourhood without letting a single ability outrank a typing.
 * All roles are weighted equally here — the team-level scoring is where their
 * differences and their interactions get resolved.
 */
export const CANDIDATE_WEIGHTS = {
  offensiveTyping: 30,
  defensiveTyping: 30,
  coverage: 4,
  moveCoverage: 1,
  resistance: 4,
  statsTotal: 0.06,
  supportRole: 12,
  weakness: 5,
  quadrupleWeakness: 30
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

  return (entry.normalizedDamageToScore * w.offensiveTyping) +
    ((1 - entry.normalizedDamageFromScore) * w.defensiveTyping) +
    (entry.coverages.length * w.coverage) +
    (entry.moveCoverages.length * w.moveCoverage) +
    (entry.resistances.length * w.resistance) +
    (entry.statsTotal * w.statsTotal) +
    ((hasApplicableRole ? 1 : 0) * w.supportRole) -
    (entry.weaknesses.length * w.weakness) -
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
