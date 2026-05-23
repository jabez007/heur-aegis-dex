import { getEffectiveTypeProfile, getPokemonAbilityProfile } from './activePokemon';

export function generateTeams(options: any = {}): any[] {
  const {
    allowedTypes = [],
    teamSize = 3,
    teamComposition = { allowSharedTypes: true, allowSharedWeaknesses: false, coverWeaknesses: true },
    seed = []
  } = options;

  const _teamComposition = {
    allowSharedTypes: true,
    allowSharedWeaknesses: false,
    coverWeaknesses: true,
    ...teamComposition
  };

  const validAllowedTypes = allowedTypes.filter((t: any) => t.pokemon && t.pokemon.length > 0);

  const damageScores: any = validAllowedTypes.reduce((acc: any, t: any) => ({
    to: [...(acc.to || []), t.damage_to_score],
    from: [...(acc.from || []), t.damage_from_score]
  }), {});

  const maxDamageToScore = Math.max(...(damageScores.to.filter((s: any) => s !== undefined) || [1]));
  const minDamageToScore = Math.min(...(damageScores.to.filter((s: any) => s !== undefined) || [0]));

  const maxDamageFromScore = Math.max(...(damageScores.from.filter((s: any) => s !== undefined) || [1]));
  const minDamageFromScore = Math.min(...(damageScores.from.filter((s: any) => s !== undefined) || [0]));

  const normalizeDamageFromScore = (score: number | undefined): number =>
    (score === undefined || maxDamageFromScore === minDamageFromScore) ? 0.5 :
      (score - minDamageFromScore) / (maxDamageFromScore - minDamageFromScore);
  const normalizeDamageToScore = (score: number | undefined): number =>
    (score === undefined || maxDamageToScore === minDamageToScore) ? 0.5 :
      (score - minDamageToScore) / (maxDamageToScore - minDamageToScore);

  const normalizedTypes = validAllowedTypes.map((t: any) => ({
    ...t,
    normalized_damage_from_score: normalizeDamageFromScore(t.damage_from_score),
    normalized_damage_to_score: normalizeDamageToScore(t.damage_to_score)
  }));

  function isCompatible(current: any, candidate: any): boolean {
    const currentProfile = getEffectiveTypeProfile(current);
    const candidateProfile = getEffectiveTypeProfile(candidate);

    const passesSharedType = _teamComposition.allowSharedTypes || current.name.split('/').every((n: any) => !candidate.name.includes(n));
    const passesSharedWeakness = _teamComposition.allowSharedWeaknesses ||
      (currentProfile.weaknesses.every((w: any) => !candidateProfile.weaknesses.includes(w)) && currentProfile.ineffectives.every((i: any) => !candidateProfile.ineffectives.includes(i)));

    const passesCoverage = !_teamComposition.coverWeaknesses ||
      currentProfile.weaknesses.some((w: any) => candidateProfile.coverages.includes(w) || candidateProfile.resistances.includes(w)) ||
      candidateProfile.coverages.some((c: any) => currentProfile.weaknesses.includes(c)) ||
      candidateProfile.resistances.some((r: any) => currentProfile.weaknesses.includes(r));

    return passesSharedType && passesSharedWeakness && passesCoverage;
  }

  function getTeamKey(tm: any[]): string {
    return tm.map((t: any) => t.name).sort().join('|');
  }

  const teamResultCache = new Map<string, any>();

  function buildTeamResult(tm: any[]): any {
    const cacheKey = getTeamKey(tm);
    const cached = teamResultCache.get(cacheKey);
    if (cached) return cached;

    const teamProfiles = tm.map((t: any) => {
      const poke = t.selectedPokemon || (t.pokemon && t.pokemon[0]);
      const abilityProfile = getPokemonAbilityProfile(poke);
      return {
        pokemon: poke ? {
          types: t.name.split('/'),
          name: poke.pokemon.name,
          sprite: poke.sprite,
          stats: poke.stats,
          selected_ability_name: poke.selected_ability_name,
          effective_weaknesses: abilityProfile?.weaknesses || t.weaknesses || [],
          effective_quadruple_weaknesses: abilityProfile?.quadruple_weaknesses || t.quadruple_weaknesses || [],
          effective_resistances: abilityProfile?.resistances || t.resistances || [],
          effective_ineffectives: abilityProfile?.ineffectives || t.ineffectives || [],
          effective_coverages: abilityProfile?.coverages || t.coverages || [],
          normalized_damage_to_score: normalizeDamageToScore(abilityProfile?.damage_to_score ?? t.damage_to_score),
          normalized_damage_from_score: normalizeDamageFromScore(abilityProfile?.damage_from_score ?? t.damage_from_score)
        } : null,
        profile: getEffectiveTypeProfile(t, poke)
      };
    });

    const pokemon = teamProfiles.map(entry => entry.pokemon).filter((p: any) => p !== null);

    const weaknessCounts = teamProfiles.reduce((acc: Record<string, number>, entry: any) => {
      (entry.profile.weaknesses || []).forEach((weakness: string) => {
        acc[weakness] = (acc[weakness] || 0) + 1;
      });
      return acc;
    }, {});

    const resistanceCounts = teamProfiles.reduce((acc: Record<string, number>, entry: any) => {
      (entry.profile.resistances || []).forEach((resistance: string) => {
        acc[resistance] = (acc[resistance] || 0) + 1;
      });
      return acc;
    }, {});

    const coverageCounts = teamProfiles.reduce((acc: Record<string, number>, entry: any) => {
      (entry.profile.coverages || []).forEach((coverage: string) => {
        acc[coverage] = (acc[coverage] || 0) + 1;
      });
      return acc;
    }, {});

    const quadrupleWeaknessCounts = teamProfiles.reduce((acc: Record<string, number>, entry: any) => {
      (entry.profile.quadruple_weaknesses || []).forEach((weakness: string) => {
        acc[weakness] = (acc[weakness] || 0) + 1;
      });
      return acc;
    }, {});

    const uncoveredWeaknesses = Object.entries(weaknessCounts)
      .filter(([weakness]) => !resistanceCounts[weakness] && !coverageCounts[weakness])
      .map(([weakness]) => weakness);
    const uncoveredQuadrupleWeaknesses = Object.entries(quadrupleWeaknessCounts)
      .filter(([weakness]) => !resistanceCounts[weakness] && !coverageCounts[weakness])
      .map(([weakness]) => weakness);
    const sharedWeaknesses = Object.entries(weaknessCounts)
      .filter(([, count]) => count > 1)
      .map(([weakness]) => weakness);
    const sharedQuadrupleWeaknesses = Object.entries(quadrupleWeaknessCounts)
      .filter(([, count]) => count > 1)
      .map(([weakness]) => weakness);
    const uniqueResistances = Object.keys(resistanceCounts).length;
    const uniqueCoverages = Object.keys(coverageCounts).length;
    const typesTotal = (new Set(tm.flatMap((t: any) => t.name.split('/')))).size;

    const pokemonScore = teamProfiles.map((entry: any) => {
      const poke = entry.pokemon;
      if (!poke) return 0;
      const offScore = poke.normalized_damage_to_score ?? 0;
      const defScore = poke.normalized_damage_from_score ?? 0;
      return poke.stats.hp +
        ((poke.stats.attack + poke.stats['special-attack']) * offScore) +
        ((poke.stats.defense + poke.stats['special-defense']) / (1 + defScore)) +
        poke.stats.speed;
    }).reduce((a: number, b: number) => a + b, 0);

    const teamSynergyScore =
      (uniqueCoverages * 20) +
      (uniqueResistances * 12) +
      (typesTotal * 10) -
      (uncoveredWeaknesses.length * 30) -
      (uncoveredQuadrupleWeaknesses.length * 90) -
      sharedWeaknesses.reduce((total, weakness) => total + ((weaknessCounts[weakness] - 1) * 18), 0) -
      Object.values(quadrupleWeaknessCounts).reduce((total, count) => total + (count * 80), 0) -
      sharedQuadrupleWeaknesses.reduce((total, weakness) => total + ((quadrupleWeaknessCounts[weakness] - 1) * 220), 0);

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
      score: pokemonScore + teamSynergyScore
    };

    teamResultCache.set(cacheKey, result);
    return result;
  }

  function typePriorityScore(t: any): number {
    const poke = t.selectedPokemon || (t.pokemon && t.pokemon[0]);
    const profile = getEffectiveTypeProfile(t, poke);
    const statsTotal = poke ? Object.values(poke.stats || {}).reduce((total: number, stat: any) => total + Number(stat || 0), 0) : 0;
    const damageToScore = normalizeDamageToScore(poke?.effective_damage_to_score ?? t.damage_to_score);
    const damageFromScore = normalizeDamageFromScore(poke?.effective_damage_from_score ?? t.damage_from_score);
    return (damageToScore * 40) +
      ((1 - damageFromScore) * 32) +
      ((profile.coverages || []).length * 8) +
      ((profile.resistances || []).length * 5) +
      (statsTotal * 0.08) -
      ((profile.weaknesses || []).length * 6) -
      ((profile.quadruple_weaknesses || []).length * 40);
  }

  const validSeed = seed.filter((s: any) => s.name && s.weaknesses && (s.selectedPokemon || (s.pokemon && s.pokemon.length > 0)));
  if (validSeed.length > teamSize) return [];

  const seedCompatibleTypes = normalizedTypes.filter((t: any) =>
    !validSeed.some((s: any) => s.name === t.name) &&
    validSeed.every((s: any) => {
      return isCompatible(s, t);
    })
  );

  const prioritizedTypes = [...seedCompatibleTypes].sort((t1: any, t2: any) => typePriorityScore(t2) - typePriorityScore(t1));
  const beamWidth = Math.max(96, teamSize * 96);

  let partialTeams = [validSeed];
  prioritizedTypes.forEach((candidate: any, index: number) => {
    const remainingCandidates = prioritizedTypes.length - index - 1;
    const expandedTeams = partialTeams.flatMap((team: any[]) => {
      const branch = [team];
      const canAddCandidate = team.length < teamSize && team.every((member: any) => isCompatible(member, candidate));
      if (canAddCandidate) {
        branch.push([...team, candidate]);
      }
      return branch;
    });

    const seen = new Set<string>();
    partialTeams = expandedTeams
      .filter((team: any[]) => team.length <= teamSize && team.length + remainingCandidates >= teamSize)
      .sort((teamA: any[], teamB: any[]) => buildTeamResult(teamB).score - buildTeamResult(teamA).score)
      .filter((team: any[]) => {
        const key = getTeamKey(team);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, beamWidth);
  });

  return partialTeams
    .filter((team: any[]) => team.length === teamSize)
    .map((team: any[]) => buildTeamResult(team))
    .filter((team: any) => team.pokemon.length === teamSize)
    .sort((t1: any, t2: any) => t2.score - t1.score);
}
