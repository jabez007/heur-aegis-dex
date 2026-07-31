import type {
  GuidedEvidence,
  PartnerRecommendation,
  StructuralNeed
} from './guidedNeedRules';

export function displayPokemonName(name: string): string {
  return name.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

export function explainGuidedNeed(need: StructuralNeed): string {
  const type = displayPokemonName(need.dimension);
  if (need.id === 'shared-quadruple-weakness') {
    return `${type} deals quadruple damage to more than one member of this roster.`;
  }
  if (need.id === 'unanswered-weakness') {
    return `${type} threatens the roster without a resistance, immunity, or coverage answer.`;
  }
  return `More than one roster member shares a weakness to ${type}.`;
}

export function explainRecommendation(recommendation: PartnerRecommendation): string {
  const { pokemon } = recommendation;
  const dimension = recommendation.reasons[0]?.dimension ?? '';
  const type = displayPokemonName(dimension);
  if (pokemon.immunities.includes(dimension)) return `Adds a complete immunity to ${type}.`;
  if (pokemon.resistances.includes(dimension)) return `Adds a resistance to ${type}.`;
  if (pokemon.coverages.includes(dimension)) return `Adds a same-type attack that pressures ${type}.`;
  if (pokemon.moveCoverages.includes(dimension)) return `Can carry coverage that pressures ${type}.`;
  return `Reduces the modeled ${type} vulnerability.`;
}

const TRADEOFF_LABELS: Readonly<Record<GuidedEvidence['ruleId'], string>> = {
  resistanceBreadth: 'resistance breadth',
  uncoveredWeakness: 'unanswered weakness',
  uncoveredQuadrupleWeakness: 'unanswered 4x weakness',
  sharedWeakness: 'shared weakness',
  quadrupleWeakness: '4x weakness',
  sharedQuadrupleWeakness: 'shared 4x weakness',
  spreadConflict: 'ally spread-move conflict',
  fieldConflict: 'field-effect conflict'
};

export function explainTradeoff(evidence: GuidedEvidence | null): string | null {
  if (!evidence) return null;
  return `Tradeoff: adds ${TRADEOFF_LABELS[evidence.ruleId]} (${displayPokemonName(evidence.dimension)}).`;
}
