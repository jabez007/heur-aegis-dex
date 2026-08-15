import { getAbilityEffect } from './abilityRoles';
import { getMoveCoverage } from './coverageMoves';
import { applyAbilityModifiers, createRawAbilityProfile } from './pokedexAbilities';
import {
  cloneDamageRelations,
  normalizeDamageFromScore,
  normalizeDamageToScore
} from './pokedexScoring';
import { canMegaEvolve, hasCompleteData, isSpeciesLegal } from './regulations';
import { CANDIDATE_WEIGHTS } from './rosterGeneration';
import { hpAdjustedBulk } from './statMetrics';
import { getEffectiveStats, getStatAbilityName, totalStats } from './statAbilities';
import { scoreMemberQuality } from './teamScoring';
import { isVarietyBreedable } from './unbreedableForms';
import type { OffensiveTypeChart } from './coverageMoves';
import type { DamageScoreBounds } from './pokedexScoring';
import type { TypeThreatWeights } from './typeThreat';
import type {
  AbilityProfile,
  PokemonAbilitySlot,
  PokemonListEntry,
  PokemonStats,
  PokemonTypeSlot,
  PokemonTypeData
} from './pokedexTypes';
import type { Regulation } from './regulations';

const POKEDEX_MAPS: Readonly<Record<string, readonly string[]>> = {
  national: ['national'],
  kanto: ['letsgo-kanto'],
  galar: ['galar', 'isle-of-armor', 'crown-tundra'],
  sinnoh: ['sinnoh'],
  hisui: ['hisui'],
  paldea: ['paldea', 'kitakami', 'blueberry']
};

export interface PokemonEnrichmentFacts {
  readonly id: number;
  readonly name: string;
  readonly url?: string;
  readonly speciesName: string;
  readonly isDefault: boolean;
  readonly types: readonly PokemonTypeSlot[];
  readonly sprite: string | null;
  readonly abilities: readonly PokemonAbilitySlot[];
  readonly stats: PokemonStats;
  readonly battleFormName?: string;
  readonly isLegendary: boolean;
  readonly isMythical: boolean;
  readonly eggGroups: readonly string[];
  readonly pokedexes: readonly string[];
  readonly form: {
    readonly isMega: boolean;
    readonly isBattleOnly: boolean;
  };
}

export interface PokemonEnrichmentOptions {
  readonly baseScore: number;
  /**
   * How much each attacking type threatens the pool being prepared against.
   * Uniform reproduces the flat count every score before `typeThreat.ts` used.
   */
  readonly threatWeights: TypeThreatWeights;
  /**
   * Extremes the weighted defensive score reaches under `threatWeights`. Carried
   * rather than looked up because deriving it costs a 3,078-profile cross product
   * and every entry in a scan shares one.
   */
  readonly damageFromBounds: DamageScoreBounds;
  /** Extremes the offensive score reaches under the census the scan ran with. */
  readonly damageToBounds: DamageScoreBounds;
  readonly inPokedex: string;
  readonly allowMegas: boolean;
  readonly includeAbilityImmunities: boolean;
  readonly includeMoveCoverage: boolean;
  readonly minimumAttacks: number;
  readonly minimumBulk: number;
  readonly regulation?: Regulation;
}

/**
 * Picks the ability whose complete modelled loadout has the highest member quality.
 *
 * Threat weighting reaches this choice, not just the score it produces. Levitate
 * is worth what Ground is worth: in a metagame full of Earthquake it can be the
 * best ability on the Pokemon, and in one without Ground attackers it is worth
 * nothing and some other ability should win. That only happens if the profiles
 * are compared under the weights and bounds actually in force, which is why both
 * arrive here rather than being defaulted.
 *
 * @param profiles Candidate ability profiles, already scored.
 * @param baseScore Baseline the scores were calculated with.
 * @param bounds Extremes to normalize the defensive score against. Defaults to
 *   the unweighted measurement, which is correct only for unweighted profiles.
 * @param varietyName PokeAPI variety name, so the firepower term reaches this
 *   choice too. It is not constant across profiles even though the movepool is:
 *   an ability that moves an attacking stat can flip which damage class the
 *   Pokemon reads its best STAB from, and Huge Power is the plain case. Omitting
 *   it scores every profile at full firepower, which ranks them against a
 *   different function than `scoreMemberQuality` computes.
 */
export function chooseDefaultAbility<T extends AbilityProfile & { stats: PokemonStats }>(
  profiles: T[],
  baseScore: number,
  bounds?: DamageScoreBounds,
  toBounds?: DamageScoreBounds,
  varietyName?: string
): T {
  const supportBonus = CANDIDATE_WEIGHTS.supportRole / CANDIDATE_WEIGHTS.quality;
  const score = (profile: T) =>
    scoreMemberQuality({
      stats: profile.stats,
      normalizedDamageToScore: normalizeDamageToScore(profile.damage_to_score, baseScore, toBounds),
      normalizedDamageFromScore: normalizeDamageFromScore(
        profile.damage_from_score, baseScore, bounds
      ),
      abilityName: profile.ability_name,
      varietyName
    }) + (getAbilityEffect(profile.ability_name) ? supportBonus : 0);

  return profiles.reduce((best, profile) => (score(profile) > score(best) ? profile : best));
}

const copyStats = (stats: PokemonStats): PokemonStats => ({
  hp: stats.hp,
  attack: stats.attack,
  defense: stats.defense,
  'special-attack': stats['special-attack'],
  'special-defense': stats['special-defense'],
  speed: stats.speed
});

const isEligible = (facts: PokemonEnrichmentFacts, options: PokemonEnrichmentOptions): boolean => {
  if (!facts.isDefault) {
    if (facts.form.isMega) {
      if (!options.allowMegas) return false;
      if (options.regulation && hasCompleteData(options.regulation, 'megaCapableSpecies') &&
        !canMegaEvolve(options.regulation, facts.speciesName)) return false;
    } else if (facts.form.isBattleOnly) {
      return false;
    }
  }

  if (facts.isLegendary || facts.isMythical) return false;
  if (facts.eggGroups.length > 0 && facts.eggGroups.every((name) => name === 'no-eggs')) return false;
  if (!isVarietyBreedable(facts.name)) return false;
  if (options.regulation && !isSpeciesLegal(options.regulation, facts.speciesName)) return false;

  return facts.pokedexes.some((pokedex) =>
    (POKEDEX_MAPS[options.inPokedex] || []).some((name) => pokedex.includes(name))
  );
};

/**
 * Converts normalized external facts into the canonical enriched scan entry.
 * The function does not mutate its facts, type data, or offensive chart.
 */
export function enrichPokemon(
  facts: PokemonEnrichmentFacts,
  type: PokemonTypeData,
  offensiveChart: OffensiveTypeChart,
  options: PokemonEnrichmentOptions
): PokemonListEntry | null {
  if (!isEligible(facts, options)) return null;

  const entry: PokemonListEntry = {
    pokemon: {
      name: facts.name,
      url: facts.url ?? `https://pokeapi.co/api/v2/pokemon/${facts.id}/`
    },
    species_name: facts.speciesName,
    is_default_variety: facts.isDefault,
    types: facts.types.map((slot) => ({ ...slot, type: { ...slot.type } })),
    sprite: facts.sprite,
    abilities: facts.abilities.map((ability) => ({ ...ability })),
    battle_form_name: facts.battleFormName,
    base_stats: copyStats(facts.stats)
  };
  const abilityNames = facts.abilities.map((ability) => ability.name);
  const baseDamageRelations = cloneDamageRelations(type.damage_relations);
  const { abilityProfiles } = options.includeAbilityImmunities
    ? applyAbilityModifiers(
      baseDamageRelations, abilityNames, options.baseScore, options.threatWeights
    )
    : {
      abilityProfiles: abilityNames.length > 0
        ? abilityNames.map((abilityName) =>
          createRawAbilityProfile(
            baseDamageRelations, abilityName, options.baseScore, options.threatWeights
          ))
        : [createRawAbilityProfile(
          baseDamageRelations, '', options.baseScore, options.threatWeights
        )]
    };

  const profilesWithStats = abilityProfiles.map((profile) => {
    const profileStats = copyStats(getEffectiveStats(entry.base_stats!, [profile.ability_name]));
    return {
      ...profile,
      stats: profileStats,
      stats_total: totalStats(profileStats),
      move_coverages: options.includeMoveCoverage
        ? getMoveCoverage(entry.pokemon.name, offensiveChart, profileStats)
        : []
    };
  });

  const clearsStatFloors = profilesWithStats.some((profile) =>
    Math.max(profile.stats.attack, profile.stats['special-attack']) >= options.minimumAttacks &&
    hpAdjustedBulk(profile.stats) >= options.minimumBulk
  );
  if (!clearsStatFloors) return null;

  const selectedProfile = chooseDefaultAbility(
    profilesWithStats, options.baseScore, options.damageFromBounds, options.damageToBounds,
    entry.pokemon.name
  );
  entry.ability_profiles = Object.fromEntries(
    profilesWithStats.map((profile) => [profile.ability_name || '', profile])
  );
  entry.selected_ability_name = selectedProfile.ability_name;
  entry.effective_damage_relations = selectedProfile.damage_relations;
  entry.effective_weaknesses = selectedProfile.weaknesses;
  entry.effective_quadruple_weaknesses = selectedProfile.quadruple_weaknesses;
  entry.effective_resistances = selectedProfile.resistances;
  entry.effective_immunities = selectedProfile.immunities;
  entry.effective_move_coverages = selectedProfile.move_coverages;
  entry.effective_ineffectives = selectedProfile.ineffectives;
  entry.effective_coverages = selectedProfile.coverages;
  entry.effective_damage_from_score = selectedProfile.damage_from_score;
  entry.effective_damage_to_score = selectedProfile.damage_to_score;
  entry.stats = copyStats(selectedProfile.stats);
  entry.stats_total = selectedProfile.stats_total;
  entry.stat_ability_name = getStatAbilityName([selectedProfile.ability_name]);

  return entry;
}
