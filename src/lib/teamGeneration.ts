import { getEffectiveTypeProfile, getPokemonAbilityProfile } from './activePokemon';
import { analyzeTeamCoverage } from './teamCoverage';
import { analyzeTeamRoles, isImmuneToAllyMoves } from './abilityRoles';
import {
  DEFAULT_BASE_SCORE,
  normalizeDamageFromScore,
  normalizeDamageToScore
} from './pokedexScoring';
import {
  CANDIDATE_PRIORITY_WEIGHTS,
  composeTeamScore,
  scoreMemberQuality,
  scoreTeamSynergy
} from './teamScoring';
import type {
  GenerateTeamsOptions,
  GeneratedTeamResult,
  PokemonListEntry,
  ResistantTypeResult,
  TeamMemberResult
} from './pokedexTypes';

/**
 * Partial teams kept per team member at each beam expansion. Higher values
 * search more thoroughly at a proportional cost in runtime.
 */
const BEAM_WIDTH_PER_MEMBER = 96;

type TeamCandidate = ResistantTypeResult & {
  selectedPokemon?: PokemonListEntry | null;
  normalized_damage_from_score?: number;
  normalized_damage_to_score?: number;
};

/**
 * Generates ranked teams from the allowed type pool using compatibility and
 * coverage constraints, optionally seeding the result with fixed members.
 *
 * This is a beam search, not an exhaustive one. Candidate typings are ordered
 * by typePriorityScore and only the highest scoring partial teams survive each
 * expansion, so the results are the best teams the search *found* — a better
 * team may exist outside the beam. Callers must not describe the top result as
 * optimal. Widening BEAM_WIDTH_PER_MEMBER trades runtime for thoroughness.
 *
 * @param options Team generation options including the allowed type pool, team size, composition rules, and optional seed members.
 * @returns Team results ordered by score, best first. May be empty.
 */
export function generateTeams(options: GenerateTeamsOptions = {}): GeneratedTeamResult[] {
  const {
    allowedTypes = [],
    teamSize = 3,
    teamComposition = { allowSharedTypes: true, allowSharedWeaknesses: false, coverWeaknesses: true },
    seed = [],
    baseScore = DEFAULT_BASE_SCORE
  } = options;

  const _teamComposition = {
    allowSharedTypes: true,
    allowSharedWeaknesses: false,
    coverWeaknesses: true,
    ...teamComposition
  };

  const validAllowedTypes = allowedTypes.filter((t): t is ResistantTypeResult => !!t.pokemon && t.pokemon.length > 0);

  // Normalization uses the absolute bounds of the scoring formulas rather than
  // the range observed in the current pool. Min-maxing against the pool meant
  // the same Pokemon normalized differently depending on which filters were
  // active, so scores were not comparable between two runs of the tool.
  const normalizeFrom = (score: number | undefined) => normalizeDamageFromScore(score, baseScore);
  const normalizeTo = (score: number | undefined) => normalizeDamageToScore(score, baseScore);

  const normalizedTypes: TeamCandidate[] = validAllowedTypes.map((t) => ({
    ...t,
    normalized_damage_from_score: normalizeFrom(t.damage_from_score),
    normalized_damage_to_score: normalizeTo(t.damage_to_score)
  }));

  function isCompatible(current: TeamCandidate, candidate: TeamCandidate): boolean {
    const currentProfile = getEffectiveTypeProfile(current);
    const candidateProfile = getEffectiveTypeProfile(candidate);
    const currentWeaknesses = currentProfile.weaknesses || [];
    const candidateWeaknesses = candidateProfile.weaknesses || [];
    const currentCoverages = currentProfile.coverages || [];
    const currentResistances = currentProfile.resistances || [];
    const candidateCoverages = candidateProfile.coverages || [];
    const candidateResistances = candidateProfile.resistances || [];

    // Compare whole type names. Substring matching happened to work only
    // because no current type name contains another, which is not a property
    // worth relying on.
    const candidateTypes = new Set(candidate.name.split('/'));
    const passesSharedType = _teamComposition.allowSharedTypes ||
      current.name.split('/').every((typeName) => !candidateTypes.has(typeName));
    const passesSharedWeakness = _teamComposition.allowSharedWeaknesses ||
      currentWeaknesses.every((w) => !candidateWeaknesses.includes(w));

    const coversWeaknesses = (coverages: string[], resistances: string[], weaknesses: string[]): boolean =>
      weaknesses.length === 0 || weaknesses.some((weakness) => coverages.includes(weakness) || resistances.includes(weakness));

    const passesCoverage = !_teamComposition.coverWeaknesses || (
      coversWeaknesses(candidateCoverages, candidateResistances, currentWeaknesses) &&
      coversWeaknesses(currentCoverages, currentResistances, candidateWeaknesses)
    );

    return passesSharedType && passesSharedWeakness && passesCoverage;
  }

  function getTeamKey(tm: TeamCandidate[]): string {
    return tm.map((t) => t.name).sort().join('|');
  }

  const teamResultCache = new Map<string, GeneratedTeamResult>();

  function buildTeamResult(tm: TeamCandidate[]): GeneratedTeamResult {
    const cacheKey = getTeamKey(tm);
    const cached = teamResultCache.get(cacheKey);
    if (cached) return cached;

    const teamProfiles = tm.map((t) => {
      const poke = t.selectedPokemon || (t.pokemon && t.pokemon[0]);
      const abilityProfile = getPokemonAbilityProfile(poke);
      const teamMember: TeamMemberResult | null = poke && poke.stats ? {
          types: t.name.split('/'),
          name: poke.pokemon.name,
          sprite: poke.sprite,
          stats: poke.stats,
          selected_ability_name: poke.selected_ability_name,
          effective_weaknesses: abilityProfile?.weaknesses || t.weaknesses || [],
          effective_quadruple_weaknesses: abilityProfile?.quadruple_weaknesses || t.quadruple_weaknesses || [],
          effective_resistances: abilityProfile?.resistances || t.resistances || [],
          effective_immunities: abilityProfile?.immunities || t.immunities || [],
          effective_move_coverages: poke.effective_move_coverages || t.move_coverages || [],
          effective_ineffectives: abilityProfile?.ineffectives || t.ineffectives || [],
          effective_coverages: abilityProfile?.coverages || t.coverages || [],
          normalized_damage_to_score: normalizeTo(abilityProfile?.damage_to_score ?? t.damage_to_score),
          normalized_damage_from_score: normalizeFrom(abilityProfile?.damage_from_score ?? t.damage_from_score)
        } : null;
      return {
        pokemon: teamMember,
        profile: getEffectiveTypeProfile(t, poke)
      };
    });

    const pokemon = teamProfiles.map(entry => entry.pokemon).filter((p): p is TeamMemberResult => p !== null);

    // The profile carries the combined typing as a name, so split it back out:
    // spread-move safety needs the member's own attacking types.
    const coverage = analyzeTeamCoverage(teamProfiles.map((entry, index) => ({
      ...entry.profile,
      types: tm[index].name.split('/'),
      moveCoverages: entry.pokemon?.effective_move_coverages || [],
      immuneToAllyMoves: isImmuneToAllyMoves(entry.pokemon?.selected_ability_name)
    })));

    // Roles come from the ability actually selected for battle, not from every
    // ability the species can have.
    const roles = analyzeTeamRoles(teamProfiles.map((entry) => ({
      abilityName: entry.pokemon?.selected_ability_name
    })), { hasAlly: true });
    const {
      uncoveredWeaknesses,
      uncoveredQuadrupleWeaknesses,
      sharedWeaknesses,
      sharedQuadrupleWeaknesses,
      uniqueResistances,
      uniqueCoverages
    } = coverage;

    const typesTotal = (new Set(tm.flatMap((t) => t.name.split('/')))).size;

    const memberQualities = teamProfiles
      .map((entry) => entry.pokemon)
      .filter((poke): poke is TeamMemberResult => poke !== null)
      .map((poke) => scoreMemberQuality({
        stats: poke.stats,
        normalizedDamageToScore: poke.normalized_damage_to_score,
        normalizedDamageFromScore: poke.normalized_damage_from_score
      }));

    const synergy = scoreTeamSynergy({
      coverage,
      roles,
      typesTotal,
      teamSize: tm.length,
      typeCount: baseScore
    });

    const result = {
      types: tm.map((t: any) => t.name),
      typesTotal,
      pokemon,
      uncoveredWeaknesses,
      uncoveredQuadrupleWeaknesses,
      sharedWeaknesses,
      sharedQuadrupleWeaknesses,
      uniqueResistances,
      uniqueCoverages,
      score: composeTeamScore(memberQualities, synergy)
    };

    teamResultCache.set(cacheKey, result);
    return result;
  }

  // Orders candidates so the beam explores promising typings first. This only
  // affects which teams survive pruning, not their final score, so it stays a
  // cheap single-candidate heuristic.
  function typePriorityScore(t: TeamCandidate): number {
    const poke = t.selectedPokemon || (t.pokemon && t.pokemon[0]);
    const profile = getEffectiveTypeProfile(t, poke);
    const statsTotal = poke ? Object.values(poke.stats || {}).reduce((total: number, stat) => total + Number(stat || 0), 0) : 0;
    const damageToScore = normalizeTo(poke?.effective_damage_to_score ?? t.damage_to_score);
    const damageFromScore = normalizeFrom(poke?.effective_damage_from_score ?? t.damage_from_score);
    const w = CANDIDATE_PRIORITY_WEIGHTS;
    return (damageToScore * w.offensiveTyping) +
      ((1 - damageFromScore) * w.defensiveTyping) +
      ((profile.coverages || []).length * w.coverage) +
      ((profile.resistances || []).length * w.resistance) +
      (statsTotal * w.statsTotal) -
      ((profile.weaknesses || []).length * w.weakness) -
      ((profile.quadruple_weaknesses || []).length * w.quadrupleWeakness);
  }

  const validSeed = seed.filter((s): s is TeamCandidate => !!s.name && !!s.weaknesses && (!!(s as TeamCandidate).selectedPokemon || !!s.pokemon?.length));
  if (validSeed.length > teamSize) return [];

  const seedCompatibleTypes = normalizedTypes.filter((t) =>
    !validSeed.some((s) => s.name === t.name) &&
    validSeed.every((s) => {
      return isCompatible(s, t);
    })
  );

  const prioritizedTypes = [...seedCompatibleTypes].sort((t1, t2) => typePriorityScore(t2) - typePriorityScore(t1));
  const beamWidth = Math.max(BEAM_WIDTH_PER_MEMBER, teamSize * BEAM_WIDTH_PER_MEMBER);

  let partialTeams: TeamCandidate[][] = [validSeed];
  prioritizedTypes.forEach((candidate, index: number) => {
    const remainingCandidates = prioritizedTypes.length - index - 1;
    const expandedTeams = partialTeams.flatMap((team) => {
      const branch = [team];
      const canAddCandidate = team.length < teamSize && team.every((member) => isCompatible(member, candidate));
      if (canAddCandidate) {
        branch.push([...team, candidate]);
      }
      return branch;
    });

    const seen = new Set<string>();
    partialTeams = expandedTeams
      .filter((team) => team.length <= teamSize && team.length + remainingCandidates >= teamSize)
      .sort((teamA, teamB) => buildTeamResult(teamB).score - buildTeamResult(teamA).score)
      .filter((team) => {
        const key = getTeamKey(team);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, beamWidth);
  });

  return partialTeams
    .filter((team) => team.length === teamSize)
    .map((team) => buildTeamResult(team))
    .filter((team) => team.pokemon.length === teamSize)
    .sort((t1, t2) => t2.score - t1.score);
}
