/**
 * Roster evaluation for bring-6-pick-N formats.
 *
 * A registered roster of six is not a team. Only the brought subset shares a
 * battle, so scoring all six as one unit answers a question nobody asks: it
 * rewards six Pokemon that cover each other, when what you need is a roster
 * that *contains* strong subsets.
 *
 * Under open team list the opponent sees all six and picks against them, so
 * having several viable brings matters as much as having one great one. The
 * aggregate below blends both: the best option the roster offers, and how deep
 * the next-best options run behind it.
 */

import { analyzeTeamCoverage, type TeamCoverageProfile } from './teamCoverage';
import { analyzeTeamRoles, isImmuneToAllyMoves } from './abilityRoles';
import { composeTeamScore, scoreMemberQuality, scoreTeamSynergy } from './teamScoring';
import { combinationsOf, type BattleFormat } from './battleFormats';
import { DEFAULT_BASE_SCORE } from './pokedexScoring';
import type { PokemonStats } from './pokedexTypes';

export interface RosterMember extends TeamCoverageProfile {
  name: string;
  abilityName?: string;
  stats?: PokemonStats;
  /** Normalized 0..1 offensive score. Treated as neutral when absent. */
  normalizedDamageToScore?: number;
  /** Normalized 0..1 defensive score. Treated as neutral when absent. */
  normalizedDamageFromScore?: number;
}

export interface BringOption {
  /** Roster positions making up this option, ascending. */
  indices: number[];
  /** Member names, in roster order. */
  names: string[];
  score: number;
}

export interface RosterEvaluation {
  /** Every legal bring, best first. Empty when the roster cannot fill one. */
  bringOptions: BringOption[];
  /** The highest scoring option, or null when none exists. */
  best: BringOption | null;
  /** Aggregate roster score in 0..100, blending peak and depth. */
  score: number;
  /** How many distinct brings the roster can field. */
  optionCount: number;
}

/**
 * How many of the best options count towards depth.
 *
 * Depth asks "if the matchup takes my best bring away, what is left". Three is
 * enough to distinguish a roster with real alternatives from one built around a
 * single line, without demanding that every subset be playable.
 */
export const ROSTER_DEPTH_OPTIONS = 3;

/**
 * Split between the roster's best bring and the depth behind it. Sums to 1.
 */
export const ROSTER_WEIGHTS = {
  best: 0.6,
  depth: 0.4
} as const;

export interface RosterScoringOptions {
  format: BattleFormat;
  /** Number of elemental types in play. Defaults to the standard eighteen. */
  typeCount?: number;
}

/**
 * Scores one brought subset exactly as a team.
 *
 * @param members The Pokemon actually entering the battle.
 * @param options Format and type-count context.
 * @returns A score in 0..100.
 */
export function scoreBring(members: RosterMember[], options: RosterScoringOptions): number {
  const { format, typeCount = DEFAULT_BASE_SCORE } = options;
  if (members.length === 0) return 0;

  const coverage = analyzeTeamCoverage(members.map((member) => ({
    ...member,
    immuneToAllyMoves: format.hasAlly && isImmuneToAllyMoves(member.abilityName)
  })));

  const roles = analyzeTeamRoles(
    members.map((member) => ({ abilityName: member.abilityName })),
    { hasAlly: format.hasAlly }
  );
  const typesTotal = new Set(members.flatMap((member) => member.types || [])).size;

  const memberQualities = members
    .filter((member): member is RosterMember & { stats: PokemonStats } => !!member.stats)
    .map((member) => scoreMemberQuality({
      stats: member.stats,
      normalizedDamageToScore: member.normalizedDamageToScore ?? 0.5,
      normalizedDamageFromScore: member.normalizedDamageFromScore ?? 0.5
    }));

  const synergy = scoreTeamSynergy({
    coverage,
    roles,
    format,
    typesTotal,
    teamSize: members.length,
    typeCount
  });

  return composeTeamScore(memberQualities, synergy);
}

/**
 * Evaluates every way a roster can be brought and aggregates the result.
 *
 * @param roster The registered Pokemon, up to the format's maximum.
 * @param options Format and type-count context.
 * @returns Ranked bring options and the blended roster score.
 */
export function evaluateRoster(roster: RosterMember[], options: RosterScoringOptions): RosterEvaluation {
  const { format } = options;
  const indices = roster.map((_, index) => index);
  const subsets = combinationsOf(indices, format.broughtToBattle);

  if (subsets.length === 0) {
    return { bringOptions: [], best: null, score: 0, optionCount: 0 };
  }

  const bringOptions: BringOption[] = subsets
    .map((subsetIndices) => ({
      indices: subsetIndices,
      names: subsetIndices.map((index) => roster[index].name),
      score: scoreBring(subsetIndices.map((index) => roster[index]), options)
    }))
    .sort((a, b) => b.score - a.score);

  const best = bringOptions[0];
  const depthPool = bringOptions.slice(0, ROSTER_DEPTH_OPTIONS);
  const depth = depthPool.reduce((total, option) => total + option.score, 0) / depthPool.length;

  return {
    bringOptions,
    best,
    score: (ROSTER_WEIGHTS.best * best.score) + (ROSTER_WEIGHTS.depth * depth),
    optionCount: bringOptions.length
  };
}
