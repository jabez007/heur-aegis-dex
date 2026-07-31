import { analyzeTeamRoles, getApplicableRoles } from './abilityRoles';
import { combinationsOf, type BattleFormat } from './battleFormats';
import { analyzeTeamCoverage, type TeamCoverageProfile } from './teamCoverage';
import {
  getTeamSynergyBreakdown,
  type SynergyBonusTermId,
  type SynergyPenaltyTermId,
  type TeamSynergyBreakdown
} from './teamScoring';

export type StructuralNeedId =
  | 'shared-quadruple-weakness'
  | 'unanswered-weakness'
  | 'shared-weakness'
  | 'missing-coverage'
  | 'missing-modeled-role'
  | 'balanced-improvement';

export type GuidedRuleId =
  | 'coverageBreadth'
  | 'resistanceBreadth'
  | 'supportRoles'
  | 'uncoveredWeakness'
  | 'uncoveredQuadrupleWeakness'
  | 'sharedWeakness'
  | 'quadrupleWeakness'
  | 'sharedQuadrupleWeakness'
  | 'spreadConflict'
  | 'fieldConflict';

export interface GuidedLineMember extends TeamCoverageProfile {
  /** Canonical variety slug; unique within a guided path. */
  readonly name: string;
  readonly abilityName?: string;
}

export interface GuidedEvidence {
  readonly ruleId: GuidedRuleId;
  readonly dimension: string;
  readonly sourceFacts: readonly string[];
  readonly baselineValue: number;
  readonly candidateValue: number;
  readonly baselineContribution: number;
  readonly candidateContribution: number;
  readonly delta: number;
}

export interface StructuralNeed {
  readonly id: StructuralNeedId;
  readonly dimension: string;
  readonly severity: number;
  readonly evidence: readonly GuidedEvidence[];
}

export interface GuidedNeedOptions {
  readonly format: BattleFormat;
  readonly typeNames: readonly string[];
}

export interface GuidedCandidateNeedEvaluation {
  readonly improvement: number;
  readonly improves: boolean;
  readonly favoriteDeltas: readonly { favorite: string; delta: number }[];
  readonly primaryTradeoff: GuidedTradeoff | null;
}

export interface GuidedRisk {
  readonly ruleId: Exclude<GuidedRuleId, 'coverageBreadth' | 'resistanceBreadth' | 'supportRoles'>;
  readonly dimension: string;
  readonly severity: number;
}

export interface GuidedTradeoff extends GuidedRisk {
  readonly favoriteDeltas: readonly { favorite: string; delta: number }[];
}

export interface GuidedRankedOption {
  readonly improvement: number;
  readonly primaryTradeoffDelta: number;
  readonly candidatePriority: number;
  readonly abilityName: string;
  readonly varietyName: string;
}

export interface GuidedRecommendationOption extends GuidedRankedOption {
  readonly speciesName: string;
  /** Legality, path membership, and plan-global exclusion checks have passed. */
  readonly eligible: boolean;
  /** Every locked favorite's primary-need delta is non-negative. */
  readonly improvesPrimaryNeed: boolean;
}

interface GuidedLineContext {
  coverage: ReturnType<typeof analyzeTeamCoverage>;
  roles: ReturnType<typeof analyzeTeamRoles>;
  breakdown: TeamSynergyBreakdown;
  options: GuidedNeedOptions;
}

const codePointCompare = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

function compareRankTerms(left: GuidedRankedOption, right: GuidedRankedOption): number {
  return right.improvement - left.improvement ||
    left.primaryTradeoffDelta - right.primaryTradeoffDelta ||
    right.candidatePriority - left.candidatePriority;
}

/** Comparator for choosing the best selected ability on one variety. */
export function compareGuidedAbilityProfiles(left: GuidedRankedOption, right: GuidedRankedOption): number {
  return compareRankTerms(left, right) || codePointCompare(left.abilityName, right.abilityName);
}

/** Comparator for species-unique variety selection and the final shortlist. */
export function compareGuidedCandidates(left: GuidedRankedOption, right: GuidedRankedOption): number {
  return compareRankTerms(left, right) || codePointCompare(left.varietyName, right.varietyName);
}

/** Reduces evaluated ability profiles to a stable, species-unique shortlist. */
export function rankGuidedRecommendations(
  options: readonly GuidedRecommendationOption[],
  limit = 5
): GuidedRecommendationOption[] {
  if (limit <= 0) return [];
  const byVariety = new Map<string, GuidedRecommendationOption[]>();
  options.filter((option) =>
    option.eligible && option.improvesPrimaryNeed && option.improvement > 0
  ).forEach((option) => {
    const profiles = byVariety.get(option.varietyName) ?? [];
    profiles.push(option);
    byVariety.set(option.varietyName, profiles);
  });

  const bestBySpecies = new Map<string, GuidedRecommendationOption>();
  [...byVariety.values()]
    .map((profiles) => profiles.sort(compareGuidedAbilityProfiles)[0])
    .sort(compareGuidedCandidates)
    .forEach((option) => {
      const incumbent = bestBySpecies.get(option.speciesName);
      if (!incumbent || compareGuidedCandidates(option, incumbent) < 0) {
        bestBySpecies.set(option.speciesName, option);
      }
    });

  return [...bestBySpecies.values()].sort(compareGuidedCandidates).slice(0, limit);
}

function analyzeLine(members: readonly GuidedLineMember[], options: GuidedNeedOptions): GuidedLineContext {
  const coverage = analyzeTeamCoverage([...members]);
  const roles = analyzeTeamRoles(
    members.map(({ abilityName }) => ({ abilityName })),
    { hasAlly: options.format.hasAlly }
  );
  const typesTotal = new Set(members.flatMap((member) => member.types ?? [])).size;
  const breakdown = getTeamSynergyBreakdown({
    coverage,
    roles,
    format: options.format,
    typesTotal,
    teamSize: options.format.broughtToBattle,
    typeCount: options.typeNames.length
  });
  return { coverage, roles, breakdown, options };
}

function validateOptions(options: GuidedNeedOptions): void {
  if (options.format.broughtToBattle <= 0) throw new Error('Guided format must bring at least one Pokemon');
  if (options.typeNames.length === 0) throw new Error('Guided analysis requires an elemental type universe');
  if (new Set(options.typeNames).size !== options.typeNames.length) {
    throw new Error('Guided elemental type names must be unique');
  }
}

function canonicalFavorites(lockedFavorites: readonly string[]): string[] {
  const favorites = [...lockedFavorites].sort(codePointCompare);
  if (new Set(favorites).size !== favorites.length) throw new Error('Locked favorites must be unique');
  return favorites;
}

function bonusTerm(context: GuidedLineContext, id: SynergyBonusTermId) {
  return context.breakdown.bonusTerms.find((term) => term.id === id)!;
}

function penaltyTerm(context: GuidedLineContext, id: SynergyPenaltyTermId) {
  return context.breakdown.penaltyTerms.find((term) => term.id === id)!;
}

function evidenceFor(
  context: GuidedLineContext,
  id: StructuralNeedId,
  dimension: string
): GuidedEvidence[] {
  const { coverage, roles, options } = context;
  const weaknessCount = coverage.weaknessCounts[dimension] ?? 0;
  const quadrupleCount = coverage.quadrupleWeaknessCounts[dimension] ?? 0;
  const resistanceCount = coverage.resistanceCounts[dimension] ?? 0;
  const evidence: GuidedEvidence[] = [];
  const add = (ruleId: GuidedRuleId, value: number, weight: number, ...sourceFacts: string[]) => {
    const contribution = weight * value;
    if (contribution > 0) evidence.push({
      ruleId,
      dimension,
      sourceFacts,
      baselineValue: value,
      candidateValue: value,
      baselineContribution: contribution,
      candidateContribution: contribution,
      delta: 0
    });
  };

  if (id === 'shared-quadruple-weakness') {
    const sharedTerm = penaltyTerm(context, 'sharedQuadrupleWeakness');
    add(
      'sharedQuadrupleWeakness',
      Math.max(quadrupleCount - 1, 0) / sharedTerm.denominator,
      sharedTerm.weight,
      `quadruple-weakness-count:${quadrupleCount}`
    );
    if (quadrupleCount >= 2 && resistanceCount === 0) {
      const resistanceTerm = bonusTerm(context, 'resistanceBreadth');
      add('resistanceBreadth', 1 / resistanceTerm.denominator, resistanceTerm.weight, 'resistance-count:0');
    }
  }

  if (id === 'unanswered-weakness' && coverage.uncoveredWeaknesses.includes(dimension)) {
    const uncoveredTerm = penaltyTerm(context, 'uncoveredWeakness');
    add('uncoveredWeakness', 1 / uncoveredTerm.denominator, uncoveredTerm.weight,
      `weakness-count:${weaknessCount}`);
    if (coverage.uncoveredQuadrupleWeaknesses.includes(dimension)) {
      const quadrupleTerm = penaltyTerm(context, 'uncoveredQuadrupleWeakness');
      add(
        'uncoveredQuadrupleWeakness',
        1 / quadrupleTerm.denominator,
        quadrupleTerm.weight,
        `quadruple-weakness-count:${quadrupleCount}`
      );
    }
  }

  if (id === 'shared-weakness') {
    const sharedTerm = penaltyTerm(context, 'sharedWeakness');
    add(
      'sharedWeakness',
      Math.max(weaknessCount - 1, 0) / sharedTerm.denominator,
      sharedTerm.weight,
      `weakness-count:${weaknessCount}`
    );
    if (weaknessCount >= 2 && resistanceCount === 0) {
      const resistanceTerm = bonusTerm(context, 'resistanceBreadth');
      add('resistanceBreadth', 1 / resistanceTerm.denominator, resistanceTerm.weight, 'resistance-count:0');
    }
  }

  if (id === 'missing-coverage' && !coverage.coverageCounts[dimension]) {
    const coverageTerm = bonusTerm(context, 'coverageBreadth');
    add('coverageBreadth', 1 / coverageTerm.denominator, coverageTerm.weight, 'coverage-count:0');
  }

  if (id === 'missing-modeled-role') {
    const applicableRoles = getApplicableRoles(options.format.hasAlly);
    const roleCapacity = Math.min(options.format.broughtToBattle, applicableRoles.length);
    if (roles.roles.length < roleCapacity &&
      applicableRoles.includes(dimension as typeof applicableRoles[number]) &&
      !roles.roles.includes(dimension as typeof roles.roles[number])) {
      const roleTerm = bonusTerm(context, 'supportRoles');
      add('supportRoles', 1 / roleTerm.denominator, roleTerm.weight,
        `covered-role-count:${roles.roles.length}`);
    }
  }

  return evidence;
}

function needFor(context: GuidedLineContext, id: StructuralNeedId, dimension: string): StructuralNeed {
  const evidence = evidenceFor(context, id, dimension);
  return {
    id,
    dimension,
    severity: evidence.reduce((total, item) => total + item.baselineContribution, 0),
    evidence
  };
}

function risksFor(context: GuidedLineContext): GuidedRisk[] {
  const { coverage, roles } = context;
  const risks: GuidedRisk[] = [];
  const add = (ruleId: GuidedRisk['ruleId'], dimension: string, numerator: number) => {
    const term = penaltyTerm(context, ruleId);
    const severity = term.weight * numerator / term.denominator;
    if (severity > 0) risks.push({ ruleId, dimension, severity });
  };

  coverage.uncoveredWeaknesses.forEach((type) => add('uncoveredWeakness', type, 1));
  coverage.uncoveredQuadrupleWeaknesses.forEach((type) => add('uncoveredQuadrupleWeakness', type, 1));
  Object.entries(coverage.weaknessCounts).forEach(([type, count]) =>
    add('sharedWeakness', type, Math.max(count - 1, 0)));
  Object.entries(coverage.quadrupleWeaknessCounts).forEach(([type, count]) => {
    add('quadrupleWeakness', type, count);
    add('sharedQuadrupleWeakness', type, Math.max(count - 1, 0));
  });
  coverage.spreadConflicts.forEach((type) => add('spreadConflict', type, 1));
  roles.fieldConflicts.forEach((role) => add('fieldConflict', role, 1));

  return risks.sort((left, right) =>
    right.severity - left.severity ||
    codePointCompare(left.ruleId, right.ruleId) ||
    codePointCompare(left.dimension, right.dimension)
  );
}

/** Returns canonical penalty dimensions for one line, highest severity first. */
export function getGuidedLineRisks(
  members: readonly GuidedLineMember[],
  options: GuidedNeedOptions
): GuidedRisk[] {
  validateOptions(options);
  return risksFor(analyzeLine(members, options));
}

/** Returns every positive guided need for one line in deterministic priority order. */
export function getGuidedLineNeeds(
  members: readonly GuidedLineMember[],
  options: GuidedNeedOptions
): StructuralNeed[] {
  validateOptions(options);
  const context = analyzeLine(members, options);
  const needs = [
    ...options.typeNames.map((type) => needFor(context, 'shared-quadruple-weakness', type)),
    ...options.typeNames.map((type) => needFor(context, 'unanswered-weakness', type)),
    ...options.typeNames.map((type) => needFor(context, 'shared-weakness', type)),
    ...options.typeNames.map((type) => needFor(context, 'missing-coverage', type)),
    ...getApplicableRoles(options.format.hasAlly)
      .map((role) => needFor(context, 'missing-modeled-role', role))
  ].filter((need) => need.severity > 0);

  if (needs.length === 0) {
    return [{ id: 'balanced-improvement', dimension: 'none', severity: 0, evidence: [] }];
  }

  return needs.sort((left, right) =>
    right.severity - left.severity ||
    codePointCompare(left.id, right.id) ||
    codePointCompare(left.dimension, right.dimension)
  );
}

function linesContaining(
  members: readonly GuidedLineMember[],
  size: number,
  requiredNames: readonly string[]
): GuidedLineMember[][] {
  return combinationsOf([...members], size).filter((line) =>
    requiredNames.every((name) => line.some((member) => member.name === name))
  );
}

function selectBestLine(
  lines: readonly GuidedLineMember[][],
  need: Pick<StructuralNeed, 'id' | 'dimension'>,
  options: GuidedNeedOptions
): { line: GuidedLineMember[]; need: StructuralNeed; risks: GuidedRisk[]; penalty: number; signature: string } {
  return lines.map((line) => {
    const context = analyzeLine(line, options);
    return {
      line,
      need: needFor(context, need.id, need.dimension),
      risks: risksFor(context),
      penalty: context.breakdown.penalty,
      signature: line.map(({ name }) => name).sort(codePointCompare).join('\0')
    };
  }).sort((left, right) =>
    left.need.severity - right.need.severity ||
    left.penalty - right.penalty ||
    codePointCompare(left.signature, right.signature)
  )[0];
}

/** Selects the highest-severity need across each locked favorite's best legal line. */
export function selectPrimaryGuidedNeed(
  path: readonly GuidedLineMember[],
  lockedFavorites: readonly string[],
  options: GuidedNeedOptions
): StructuralNeed {
  validateOptions(options);
  if (path.length === 0 || lockedFavorites.length === 0) {
    return { id: 'balanced-improvement', dimension: 'none', severity: 0, evidence: [] };
  }
  const favorites = canonicalFavorites(lockedFavorites);
  const size = Math.min(path.length, options.format.broughtToBattle);
  const linesByFavorite = favorites.map((favorite) => {
    const lines = linesContaining(path, size, [favorite]);
    if (lines.length === 0) throw new Error(`Locked favorite ${favorite} is not on the guided path`);
    return { favorite, lines };
  });
  const keys = new Map<string, Pick<StructuralNeed, 'id' | 'dimension'>>();
  linesByFavorite.forEach(({ lines }) => lines.forEach((line) => {
    getGuidedLineNeeds(line, options).forEach((need) => {
      if (need.id !== 'balanced-improvement') keys.set(`${need.id}\0${need.dimension}`, need);
    });
  }));

  const needs = [...keys.values()].map((need) => {
    const selected = linesByFavorite.map(({ favorite, lines }) => ({
      favorite,
      selected: selectBestLine(lines, need, options)
    }));
    const evidenceByRule = new Map<GuidedRuleId, GuidedEvidence>();
    selected.forEach(({ favorite, selected: line }) => line.need.evidence.forEach((item) => {
      const current = evidenceByRule.get(item.ruleId);
      const sourceFacts = [...new Set([
        ...(current?.sourceFacts ?? []),
        `favorite:${favorite}`,
        `line:${line.signature}`,
        ...item.sourceFacts
      ])].sort(codePointCompare);
      evidenceByRule.set(item.ruleId, {
        ...item,
        sourceFacts,
        baselineValue: (current?.baselineValue ?? 0) + item.baselineValue / favorites.length,
        candidateValue: (current?.candidateValue ?? 0) + item.candidateValue / favorites.length,
        baselineContribution: (current?.baselineContribution ?? 0) +
          item.baselineContribution / favorites.length,
        candidateContribution: (current?.candidateContribution ?? 0) +
          item.candidateContribution / favorites.length
      });
    }));
    const evidence = [...evidenceByRule.values()].sort((left, right) =>
      codePointCompare(left.ruleId, right.ruleId)
    );
    return {
      ...need,
      severity: evidence.reduce((sum, item) => sum + item.baselineContribution, 0),
      evidence
    };
  }).filter((need) => need.severity > 0).sort((left, right) =>
    right.severity - left.severity ||
    codePointCompare(left.id, right.id) ||
    codePointCompare(left.dimension, right.dimension)
  );

  return needs[0] ?? { id: 'balanced-improvement', dimension: 'none', severity: 0, evidence: [] };
}

/** Measures a candidate against the same primary need for every locked favorite. */
export function evaluateGuidedCandidateNeed(
  path: readonly GuidedLineMember[],
  candidate: GuidedLineMember,
  lockedFavorites: readonly string[],
  need: Pick<StructuralNeed, 'id' | 'dimension'>,
  options: GuidedNeedOptions
): GuidedCandidateNeedEvaluation {
  validateOptions(options);
  if (path.some(({ name }) => name === candidate.name)) {
    throw new Error(`Candidate ${candidate.name} is already on the guided path`);
  }
  const favorites = canonicalFavorites(lockedFavorites);
  const baseSize = Math.min(path.length, options.format.broughtToBattle);
  const candidateSize = Math.min(path.length + 1, options.format.broughtToBattle);
  const withCandidate = [...path, candidate];
  const selectedLines: {
    favorite: string;
    base: ReturnType<typeof selectBestLine>;
    candidate: ReturnType<typeof selectBestLine>;
  }[] = [];
  const favoriteDeltas = favorites.map((favorite) => {
    const baseLines = linesContaining(path, baseSize, [favorite]);
    const candidateLines = linesContaining(withCandidate, candidateSize, [favorite, candidate.name]);
    if (baseLines.length === 0 || candidateLines.length === 0) {
      throw new Error(`Cannot evaluate candidate for locked favorite ${favorite}`);
    }
    const base = selectBestLine(baseLines, need, options);
    const candidateLine = selectBestLine(candidateLines, need, options);
    selectedLines.push({ favorite, base, candidate: candidateLine });
    return {
      favorite,
      delta: base.need.severity - candidateLine.need.severity
    };
  });
  const improvement = favoriteDeltas.length === 0
    ? 0
    : favoriteDeltas.reduce((sum, item) => sum + item.delta, 0) / favoriteDeltas.length;

  const riskKeys = new Map<string, Pick<GuidedRisk, 'ruleId' | 'dimension'>>();
  selectedLines.forEach(({ base, candidate: candidateLine }) => {
    [...base.risks, ...candidateLine.risks]
      .forEach((risk) => riskKeys.set(`${risk.ruleId}\0${risk.dimension}`, risk));
  });
  const tradeoffs = [...riskKeys.values()].map((risk) => {
    const deltas = selectedLines.map(({ favorite, base, candidate: candidateLine }) => {
      const severityIn = (risks: GuidedRisk[]) => risks
        .find((item) => item.ruleId === risk.ruleId && item.dimension === risk.dimension)?.severity ?? 0;
      return { favorite, delta: severityIn(candidateLine.risks) - severityIn(base.risks) };
    });
    return {
      ...risk,
      severity: deltas.reduce((sum, item) => sum + item.delta, 0) / favorites.length,
      favoriteDeltas: deltas
    };
  }).filter((risk) => risk.severity > 0).sort((left, right) =>
    right.severity - left.severity ||
    codePointCompare(left.ruleId, right.ruleId) ||
    codePointCompare(left.dimension, right.dimension)
  );

  return {
    improvement,
    improves: improvement > 0 && favoriteDeltas.every(({ delta }) => delta >= 0),
    favoriteDeltas,
    primaryTradeoff: tradeoffs[0] ?? null
  };
}
