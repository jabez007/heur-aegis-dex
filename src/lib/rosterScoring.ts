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
 * aggregate below blends both: the best option the roster offers, and how many
 * genuinely *different* teams it can field behind that one.
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
  /**
   * Meaningfully different teams the roster can field, best first, always
   * beginning with `best`. See `selectDistinctLines`.
   */
  lines: BringOption[];
  /** How many of those lines hold up against the best. See VIABLE_LINE_MARGIN. */
  viableLines: number;
  /** How many lines a full roster of this shape could offer. */
  targetLines: number;
  /** Aggregate roster score in 0..100, blending peak and depth. */
  score: number;
  /** How many bring subsets exist at all. Mostly a constant of the shape. */
  optionCount: number;
}

/**
 * How many members two brings may share and still count as different teams.
 *
 * ## Why counting raw options did not work
 *
 * Depth used to be the mean of the three highest-scoring bring options. From a
 * roster of six bringing four there are fifteen options, and the top three are
 * always the same team with one Pokemon swapped — they overlap the best bring in
 * three of four members. Averaging them measures the peak three times.
 *
 * Measured on the validation fixture, a roster of Dragonite / Metagross /
 * Incineroar / Milotic / Skarmory / Whimsicott scored 64.62, and the same four
 * with Watchog and Audino in the last two slots scored 64.52. Two slots of
 * outright junk cost **a tenth of a point**, because the junk never had to
 * appear in more than one of the three counted options. The term was reported as
 * depth and behaved as peak.
 *
 * ## What distinctness means
 *
 * A real alternative is not a substitution. If a matchup takes your best bring
 * away it is usually because one or two *Pokemon* are bad into it, and swapping
 * a single slot leaves you playing the same game plan with a worse piece. So two
 * brings count as different teams only when they differ by at least two members.
 *
 * That threshold is also what makes the spares carry weight: it forces every
 * counted line beyond the first to actually field the Pokemon in the back half of
 * the roster, which is exactly the property "register six good ones" is about.
 *
 * @param bringSize How many Pokemon enter a battle.
 * @returns The largest overlap two brings may have while still counting separately.
 */
export function maxSharedMembers(bringSize: number): number {
  return bringSize - 2;
}

/**
 * Picks the roster's meaningfully different teams, best first.
 *
 * Greedy on the ranked options: take the best, then take the best remaining that
 * differs from everything already taken. This deliberately does **not** search
 * for the set of lines with the highest total. Doing so could return a portfolio
 * whose peak is lower than the roster's actual best bring, which contradicts
 * `ROSTER_WEIGHTS.best` — you play your strongest line whenever the matchup lets
 * you, and the others are what you fall back on. Greedy keeps the first line
 * identical to `best` by construction.
 *
 * @param options Bring options, already sorted best first.
 * @param bringSize How many Pokemon enter a battle.
 * @returns The chosen lines, in descending score order.
 */
export function selectDistinctLines(options: BringOption[], bringSize: number): BringOption[] {
  const limit = maxSharedMembers(bringSize);
  const lines: BringOption[] = [];

  options.forEach((option) => {
    const shared = (line: BringOption) =>
      line.indices.filter((index) => option.indices.includes(index)).length;
    if (lines.every((line) => shared(line) <= limit)) lines.push(option);
  });

  return lines;
}

const targetLineCache = new Map<string, number>();

/**
 * How many distinct lines a roster of a given shape can offer at best.
 *
 * Derived by running `selectDistinctLines` over the bare index sets rather than
 * stated as a constant, so the target is by construction reachable by the same
 * algorithm that scores against it. A hand-written number could quietly become
 * unattainable if the distinctness rule moved, and every roster would then be
 * marked short of a target none could reach.
 *
 * Comes to 3 for doubles (six registered, four brought) and 4 for singles.
 *
 * @param rosterSize Registered Pokemon.
 * @param bringSize How many enter a battle.
 * @returns The reachable line count, at least 1 whenever a bring is possible.
 */
export function countTargetLines(rosterSize: number, bringSize: number): number {
  const key = `${rosterSize}:${bringSize}`;
  const cached = targetLineCache.get(key);
  if (cached !== undefined) return cached;

  const indices = Array.from({ length: rosterSize }, (_, index) => index);
  const shapes = combinationsOf(indices, bringSize).map((subset) => ({
    indices: subset,
    names: [],
    score: 0
  }));
  const target = selectDistinctLines(shapes, bringSize).length;

  targetLineCache.set(key, target);
  return target;
}

/**
 * How far below the best bring a line can score and still count as viable.
 *
 * ## Why a count needs a threshold at all
 *
 * `selectDistinctLines` returns `targetLines` for essentially every full roster,
 * good or bad — from six Pokemon there are always three bring-fours that pairwise
 * share only two members, whatever those Pokemon are, so the raw count is a
 * property of the roster's *shape* rather than of the Pokemon in it. Reporting it
 * would repeat the mistake `optionCount` already made: a number that looks like a
 * measurement and is really a constant.
 *
 * Measured over the generated rosters at various margins, the viable count runs
 * 1-3 at five points and collapses to a constant 3 by twelve.
 *
 * Five points is set against the observed spread: line scores across generated
 * rosters run 59.4 to 70.9, so five is roughly forty percent of the range that
 * separates competitive brings from each other. A line further below your best
 * than that is one you would rather not be forced into.
 *
 * Reasoned, not validated against match outcomes — the same standing as
 * MEMBER_WEIGHTS and TYPE_MODULATION.
 *
 * ## Why this does not enter the score
 *
 * It is a readout, not a term. The depth half of the score sums the lines' actual
 * scores, so a weak alternative is already discounted smoothly and in proportion.
 * Adding a threshold on top would charge the same shortfall twice, and would hand
 * a roster of six weak-but-tidy Pokemon full marks for breadth — every line
 * equally mediocre is still three viable lines. Keeping the count out of the
 * score is what stops it being gameable.
 */
export const VIABLE_LINE_MARGIN = 5;

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
      normalizedDamageFromScore: member.normalizedDamageFromScore ?? 0.5,
      abilityName: member.abilityName
    }));

  const synergy = scoreTeamSynergy({
    coverage,
    roles,
    format,
    typesTotal,
    teamSize: members.length,
    typeCount
  });

  return composeTeamScore(memberQualities, synergy, format);
}

/**
 * Evaluates every way a roster can be brought and aggregates the result.
 *
 * ## Why the target comes from the format, not the roster
 *
 * Depth is the total of the roster's distinct lines over the number a *full*
 * registration could offer, so a roster short of the maximum is short of the
 * target and scores below its own peak.
 *
 * Measuring against the roster's own size instead would make the target 1 for
 * any roster of five — from five, every pair of bring-four subsets shares three
 * members — so a roster of five would earn full depth credit for its single
 * line while a roster of six almost never can. Registering a sixth Pokemon could
 * then only lower the score, which inverts the advice the tool exists to give.
 *
 * @param roster The registered Pokemon, up to the format's maximum.
 * @param options Format and type-count context.
 * @returns Ranked bring options, the distinct lines behind the best, and the blended score.
 */
export function evaluateRoster(roster: RosterMember[], options: RosterScoringOptions): RosterEvaluation {
  const { format } = options;
  const indices = roster.map((_, index) => index);
  const subsets = combinationsOf(indices, format.broughtToBattle);
  const targetLines = countTargetLines(format.maxRosterSize, format.broughtToBattle);

  if (subsets.length === 0) {
    return { bringOptions: [], best: null, lines: [], viableLines: 0, targetLines, score: 0, optionCount: 0 };
  }

  const bringOptions: BringOption[] = subsets
    .map((subsetIndices) => ({
      indices: subsetIndices,
      names: subsetIndices.map((index) => roster[index].name),
      score: scoreBring(subsetIndices.map((index) => roster[index]), options)
    }))
    .sort((a, b) => b.score - a.score);

  const best = bringOptions[0];
  const lines = selectDistinctLines(bringOptions, format.broughtToBattle);

  // Missing lines contribute nothing rather than being averaged away, which is
  // what makes a shallow roster score below its own best bring. The denominator
  // never drops below the number of lines actually found, so an oversized roster
  // cannot score above its peak.
  const depth = lines.reduce((total, line) => total + line.score, 0) /
    Math.max(targetLines, lines.length);

  return {
    bringOptions,
    best,
    lines,
    viableLines: lines.filter((line) => line.score >= best.score - VIABLE_LINE_MARGIN).length,
    targetLines,
    score: (ROSTER_WEIGHTS.best * best.score) + (ROSTER_WEIGHTS.depth * depth),
    optionCount: bringOptions.length
  };
}
