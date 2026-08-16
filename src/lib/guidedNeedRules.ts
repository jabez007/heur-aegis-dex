import { analyzeTeamRoles, isImmuneToAllyMoves } from './abilityRoles';
import type { BattleFormat } from './battleFormats';
import { analyzeTeamCoverage, type TeamCoverageProfile, type TypeMatchupValues } from './teamCoverage';
import {
  getTeamSynergyBreakdown,
  type SynergyBonusTermId,
  type SynergyPenaltyTermId,
  type TeamSynergyBreakdown
} from './teamScoring';
import { withAbility, type PokemonEntry } from './pokemonEntry';
import { candidatePriority } from './rosterGeneration';

export const GUIDED_IMPROVEMENT_EPSILON = 1e-12;

export type StructuralNeedId =
  | 'shared-quadruple-weakness'
  | 'unanswered-weakness'
  | 'shared-weakness';

export type GuidedRuleId =
  | 'resistanceBreadth'
  | 'uncoveredWeakness'
  | 'uncoveredQuadrupleWeakness'
  | 'sharedWeakness'
  | 'quadrupleWeakness'
  | 'sharedQuadrupleWeakness'
  | 'spreadConflict'
  | 'fieldConflict';

export interface GuidedLineMember extends TeamCoverageProfile {
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

export interface GuidedRisk {
  readonly ruleId: Exclude<GuidedRuleId, 'resistanceBreadth'>;
  readonly dimension: string;
  readonly value: number;
  readonly contribution: number;
  readonly sourceFacts: readonly string[];
}

export interface GuidedCandidateNeedEvaluation {
  readonly improvement: number;
  readonly improves: boolean;
  readonly reasons: readonly GuidedEvidence[];
  readonly primaryTradeoff: GuidedEvidence | null;
}

export interface GuidedNeedOptions {
  readonly format: BattleFormat;
  readonly typeNames: readonly string[];
  /**
   * What each type is worth in the metagame. Reaches the advice twice: the
   * synergy breakdown prices each need by it, and the gap lists arrive ordered
   * most-threatening-first, so the need named is the one worth fixing rather
   * than whichever type happened to be found first.
   */
  readonly typeValues?: TypeMatchupValues;
}

interface GuidedLineContext {
  coverage: ReturnType<typeof analyzeTeamCoverage>;
  roles: ReturnType<typeof analyzeTeamRoles>;
  breakdown: TeamSynergyBreakdown;
}

interface NeedContribution {
  ruleId: GuidedRuleId;
  value: number;
  contribution: number;
  sourceFacts: string[];
}

const NEED_PRIORITY: Readonly<Record<StructuralNeedId, number>> = {
  'shared-quadruple-weakness': 0,
  'unanswered-weakness': 1,
  'shared-weakness': 2
};

const codePointCompare = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

function validateOptions(options: GuidedNeedOptions): void {
  if (options.format.broughtToBattle <= 0 || options.typeNames.length === 0 ||
    new Set(options.typeNames).size !== options.typeNames.length) {
    throw new Error('Guided need options are invalid.');
  }
}

function analyzeLine(members: readonly GuidedLineMember[], options: GuidedNeedOptions): GuidedLineContext {
  const profiles = members.map((member) => ({
    ...member,
    immuneToAllyMoves: options.format.hasAlly && isImmuneToAllyMoves(member.abilityName)
  }));
  const coverage = analyzeTeamCoverage(profiles, options.typeValues);
  const roles = analyzeTeamRoles(
    members.map(({ abilityName, name }) => ({ abilityName, varietyName: name })),
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
  return { coverage, roles, breakdown };
}

function bonusTerm(context: GuidedLineContext, id: SynergyBonusTermId) {
  return context.breakdown.bonusTerms.find((term) => term.id === id)!;
}

function penaltyTerm(context: GuidedLineContext, id: SynergyPenaltyTermId) {
  return context.breakdown.penaltyTerms.find((term) => term.id === id)!;
}

function contributionsFor(
  context: GuidedLineContext,
  id: StructuralNeedId,
  dimension: string
): NeedContribution[] {
  const { coverage } = context;
  const weaknessCount = coverage.weaknessCounts[dimension] ?? 0;
  const quadrupleCount = coverage.quadrupleWeaknessCounts[dimension] ?? 0;
  const resistanceCount = coverage.resistanceCounts[dimension] ?? 0;
  const contributions: NeedContribution[] = [];
  const add = (ruleId: GuidedRuleId, value: number, weight: number, ...sourceFacts: string[]) => {
    const contribution = weight * value;
    if (contribution > 0) contributions.push({ ruleId, value, contribution, sourceFacts });
  };

  if (id === 'shared-quadruple-weakness') {
    const shared = penaltyTerm(context, 'sharedQuadrupleWeakness');
    add('sharedQuadrupleWeakness', Math.max(quadrupleCount - 1, 0) / shared.denominator,
      shared.weight, `quadruple-weakness-count:${quadrupleCount}`);
    if (quadrupleCount >= 2 && resistanceCount === 0) {
      const resistance = bonusTerm(context, 'resistanceBreadth');
      add('resistanceBreadth', 1 / resistance.denominator, resistance.weight, 'resistance-count:0');
    }
  }

  if (id === 'unanswered-weakness' && coverage.uncoveredWeaknesses.includes(dimension)) {
    const uncovered = penaltyTerm(context, 'uncoveredWeakness');
    add('uncoveredWeakness', 1 / uncovered.denominator, uncovered.weight,
      `weakness-count:${weaknessCount}`);
    if (coverage.uncoveredQuadrupleWeaknesses.includes(dimension)) {
      const quadruple = penaltyTerm(context, 'uncoveredQuadrupleWeakness');
      add('uncoveredQuadrupleWeakness', 1 / quadruple.denominator, quadruple.weight,
        `quadruple-weakness-count:${quadrupleCount}`);
    }
  }

  if (id === 'shared-weakness') {
    const shared = penaltyTerm(context, 'sharedWeakness');
    add('sharedWeakness', Math.max(weaknessCount - 1, 0) / shared.denominator,
      shared.weight, `weakness-count:${weaknessCount}`);
    if (weaknessCount >= 2 && resistanceCount === 0) {
      const resistance = bonusTerm(context, 'resistanceBreadth');
      add('resistanceBreadth', 1 / resistance.denominator, resistance.weight, 'resistance-count:0');
    }
  }

  return contributions;
}

function needFor(context: GuidedLineContext, id: StructuralNeedId, dimension: string): StructuralNeed | null {
  const contributions = contributionsFor(context, id, dimension);
  if (contributions.length === 0) return null;
  return {
    id,
    dimension,
    severity: contributions.reduce((total, item) => total + item.contribution, 0),
    evidence: contributions.map((item) => ({
      ruleId: item.ruleId,
      dimension,
      sourceFacts: item.sourceFacts,
      baselineValue: item.value,
      candidateValue: item.value,
      baselineContribution: item.contribution,
      candidateContribution: item.contribution,
      delta: 0
    }))
  };
}

/** Returns vulnerability needs in deterministic product priority order. */
export function getGuidedLineNeeds(
  members: readonly GuidedLineMember[],
  options: GuidedNeedOptions
): StructuralNeed[] {
  validateOptions(options);
  const context = analyzeLine(members, options);
  const ids: StructuralNeedId[] = [
    'shared-quadruple-weakness',
    'unanswered-weakness',
    'shared-weakness'
  ];
  return ids.flatMap((id) => options.typeNames
    .map((type) => needFor(context, id, type))
    .filter((need): need is StructuralNeed => need !== null)
  ).sort((left, right) =>
    NEED_PRIORITY[left.id] - NEED_PRIORITY[right.id] ||
    right.severity - left.severity ||
    codePointCompare(left.dimension, right.dimension)
  );
}

export function selectPrimaryGuidedNeed(
  members: readonly GuidedLineMember[],
  options: GuidedNeedOptions
): StructuralNeed | null {
  return getGuidedLineNeeds(members, options)[0] ?? null;
}

function risksFor(context: GuidedLineContext): GuidedRisk[] {
  const { coverage, roles } = context;
  const risks: GuidedRisk[] = [];
  const add = (ruleId: GuidedRisk['ruleId'], dimension: string, numerator: number) => {
    const term = penaltyTerm(context, ruleId);
    const value = numerator / term.denominator;
    const contribution = term.weight * value;
    if (contribution > 0) risks.push({
      ruleId,
      dimension,
      value,
      contribution,
      sourceFacts: [`count:${numerator}`]
    });
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
    right.contribution - left.contribution ||
    codePointCompare(left.ruleId, right.ruleId) ||
    codePointCompare(left.dimension, right.dimension)
  );
}

export function getGuidedLineRisks(
  members: readonly GuidedLineMember[],
  options: GuidedNeedOptions
): GuidedRisk[] {
  validateOptions(options);
  return risksFor(analyzeLine(members, options));
}

/** Returns actual before/after evidence for one candidate and primary need. */
export function evaluateGuidedCandidateNeed(
  members: readonly GuidedLineMember[],
  candidate: GuidedLineMember,
  need: Pick<StructuralNeed, 'id' | 'dimension'>,
  options: GuidedNeedOptions
): GuidedCandidateNeedEvaluation {
  validateOptions(options);
  if (members.some(({ name }) => name === candidate.name)) {
    throw new Error(`Candidate ${candidate.name} is already on the guided roster`);
  }
  const baseline = analyzeLine(members, options);
  const after = analyzeLine([...members, candidate], options);
  const baselineByRule = new Map(contributionsFor(baseline, need.id, need.dimension)
    .map((item) => [item.ruleId, item]));
  const candidateByRule = new Map(contributionsFor(after, need.id, need.dimension)
    .map((item) => [item.ruleId, item]));
  const factsFor = (context: GuidedLineContext, prefix: 'baseline' | 'candidate') => [
    `${prefix}:weakness-count:${context.coverage.weaknessCounts[need.dimension] ?? 0}`,
    `${prefix}:quadruple-weakness-count:${context.coverage.quadrupleWeaknessCounts[need.dimension] ?? 0}`,
    `${prefix}:resistance-count:${context.coverage.resistanceCounts[need.dimension] ?? 0}`,
    `${prefix}:stab-answer-count:${context.coverage.coverageCounts[need.dimension] ?? 0}`,
    `${prefix}:move-answer-count:${context.coverage.moveCoverageCounts[need.dimension] ?? 0}`
  ];
  const ruleIds = [...new Set([...baselineByRule.keys(), ...candidateByRule.keys()])].sort(codePointCompare);
  const reasons = ruleIds.map((ruleId): GuidedEvidence => {
    const before = baselineByRule.get(ruleId);
    const next = candidateByRule.get(ruleId);
    const baselineContribution = before?.contribution ?? 0;
    const candidateContribution = next?.contribution ?? 0;
    return {
      ruleId,
      dimension: need.dimension,
      sourceFacts: [...factsFor(baseline, 'baseline'), ...factsFor(after, 'candidate')],
      baselineValue: before?.value ?? 0,
      candidateValue: next?.value ?? 0,
      baselineContribution,
      candidateContribution,
      delta: candidateContribution - baselineContribution
    };
  });
  const improvement = reasons.reduce((total, evidence) => total - evidence.delta, 0);

  const baselineRisks = new Map(risksFor(baseline)
    .map((risk) => [`${risk.ruleId}\0${risk.dimension}`, risk]));
  const candidateRisks = new Map(risksFor(after)
    .map((risk) => [`${risk.ruleId}\0${risk.dimension}`, risk]));
  const tradeoffs = [...new Set([...baselineRisks.keys(), ...candidateRisks.keys()])].map((key) => {
    const before = baselineRisks.get(key);
    const next = candidateRisks.get(key);
    const baselineContribution = before?.contribution ?? 0;
    const candidateContribution = next?.contribution ?? 0;
    const risk = next ?? before!;
    return {
      ruleId: risk.ruleId,
      dimension: risk.dimension,
      sourceFacts: [
        ...(before?.sourceFacts ?? []).map((fact) => `baseline:${fact}`),
        ...(next?.sourceFacts ?? []).map((fact) => `candidate:${fact}`)
      ],
      baselineValue: before?.value ?? 0,
      candidateValue: next?.value ?? 0,
      baselineContribution,
      candidateContribution,
      delta: candidateContribution - baselineContribution
    };
  }).filter((risk) => risk.delta > GUIDED_IMPROVEMENT_EPSILON).sort((left, right) =>
    right.delta - left.delta ||
    codePointCompare(left.ruleId, right.ruleId) ||
    codePointCompare(left.dimension, right.dimension)
  );

  return {
    improvement,
    improves: improvement > GUIDED_IMPROVEMENT_EPSILON,
    reasons,
    primaryTradeoff: tradeoffs[0] ?? null
  };
}

export interface PartnerRecommendation {
  readonly varietyName: string;
  readonly speciesName: string;
  readonly abilityName: string;
  readonly needId: StructuralNeedId;
  readonly improvement: number;
  readonly reasons: readonly GuidedEvidence[];
  readonly primaryTradeoff: GuidedEvidence | null;
  readonly pokemon: PokemonEntry;
}

export interface GuidedRecommendationRequest extends GuidedNeedOptions {
  readonly currentMembers: readonly PokemonEntry[];
  readonly candidatePool: readonly PokemonEntry[];
}

const toGuidedMember = (pokemon: PokemonEntry): GuidedLineMember => ({
  name: pokemon.name,
  abilityName: pokemon.abilityName,
  types: pokemon.types,
  weaknesses: pokemon.weaknesses,
  quadruple_weaknesses: pokemon.quadrupleWeaknesses,
  resistances: pokemon.resistances,
  immunities: pokemon.immunities,
  coverages: pokemon.coverages,
  moveCoverages: pokemon.moveCoverages
});

interface RankedRecommendation extends PartnerRecommendation {
  quality: number;
}

function compareRecommendations(left: RankedRecommendation, right: RankedRecommendation): number {
  return right.improvement - left.improvement ||
    (left.primaryTradeoff?.delta ?? 0) - (right.primaryTradeoff?.delta ?? 0) ||
    right.quality - left.quality ||
    codePointCompare(left.varietyName, right.varietyName) ||
    codePointCompare(left.abilityName, right.abilityName);
}

/** Evaluates legal scan candidates and returns a stable species-unique shortlist. */
export function recommendGuidedPartners(request: GuidedRecommendationRequest): PartnerRecommendation[] {
  const options = { format: request.format, typeNames: request.typeNames };
  validateOptions(options);
  const current = request.currentMembers.map(toGuidedMember);
  const need = selectPrimaryGuidedNeed(current, options);
  if (!need) return [];
  const currentSpecies = new Set(request.currentMembers.map(({ speciesName }) => speciesName));
  const bestByVariety = new Map<string, RankedRecommendation>();

  request.candidatePool.forEach((candidate) => {
    if (currentSpecies.has(candidate.speciesName)) return;
    const abilityNames = [...new Set([candidate.abilityName, ...Object.keys(candidate.abilityProfiles)])]
      .filter((name) => name.length > 0)
      .sort(codePointCompare);
    abilityNames.forEach((abilityName) => {
      const pokemon = withAbility(candidate, abilityName);
      const evaluation = evaluateGuidedCandidateNeed(current, toGuidedMember(pokemon), need, options);
      if (!evaluation.improves) return;
      const recommendation: RankedRecommendation = {
        varietyName: pokemon.name,
        speciesName: pokemon.speciesName,
        abilityName: pokemon.abilityName,
        needId: need.id,
        improvement: evaluation.improvement,
        reasons: evaluation.reasons,
        primaryTradeoff: evaluation.primaryTradeoff,
        pokemon,
        quality: candidatePriority(pokemon, { hasAlly: request.format.hasAlly })
      };
      const incumbent = bestByVariety.get(pokemon.name);
      if (!incumbent || compareRecommendations(recommendation, incumbent) < 0) {
        bestByVariety.set(pokemon.name, recommendation);
      }
    });
  });

  const bestBySpecies = new Map<string, RankedRecommendation>();
  [...bestByVariety.values()].sort(compareRecommendations).forEach((recommendation) => {
    const incumbent = bestBySpecies.get(recommendation.speciesName);
    if (!incumbent || compareRecommendations(recommendation, incumbent) < 0) {
      bestBySpecies.set(recommendation.speciesName, recommendation);
    }
  });
  return [...bestBySpecies.values()].sort(compareRecommendations).slice(0, 5)
    .map((recommendation) => ({
      varietyName: recommendation.varietyName,
      speciesName: recommendation.speciesName,
      abilityName: recommendation.abilityName,
      needId: recommendation.needId,
      improvement: recommendation.improvement,
      reasons: recommendation.reasons,
      primaryTradeoff: recommendation.primaryTradeoff,
      pokemon: recommendation.pokemon
    }));
}
