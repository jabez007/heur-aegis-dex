import { ref, computed } from 'vue';
import { flattenToPokemon, type PokemonEntry } from '../lib/pokemonEntry';
import { generateRosters } from '../lib/rosterGeneration';
import { resolveSelectedPokemon } from '../lib/activePokemon';
import { analyzeTeamCoverage } from '../lib/teamCoverage';
import { analyzeTeamRoles, isImmuneToAllyMoves } from '../lib/abilityRoles';
import { evaluateRoster, type RosterMember } from '../lib/rosterScoring';
import {
  BATTLE_FORMATS,
  DEFAULT_BATTLE_FORMAT,
  getBattleFormat,
  type BattleFormatId
} from '../lib/battleFormats';
import { DEFAULT_BASE_SCORE, normalizeDamageFromScore, normalizeDamageToScore } from '../lib/pokedexScoring';
import type { ActiveTypeDataLike, TypeDataLike } from '../lib/activePokemon';
import { useNotifications } from './useNotifications';
import { createInjectableState } from './injectableState';

export interface PartyMember {
  /** PokeAPI variety name, unique within the roster. */
  name: string;
  /** PokeAPI species name. Regional forms and Megas share their base species. */
  speciesName: string;
  types: string[];
  sprite: string;
  stats: Record<string, number>;
  abilityName?: string;
  weaknesses: string[];
  resistances: string[];
  /** Strict 0x subset of `resistances`, needed for doubles spread safety. */
  immunities: string[];
  coverages: string[];
  /** Types reachable super-effectively via any learnable move. */
  moveCoverages: string[];
  /** Normalized 0..1 offensive score, carried so bring options can be scored. */
  normalizedDamageToScore?: number;
  /** Normalized 0..1 defensive score, carried so bring options can be scored. */
  normalizedDamageFromScore?: number;
  typeName: string;
}

const teamBuilderState = createInjectableState('heur-aegis-dex:team-builder', () => ({
  /** Registered Pokemon — the "show", up to the format's maximum. */
  roster: ref<PartyMember[]>([]),
  /** Roster positions the user has chosen to bring, or null to follow the suggestion. */
  manualBringIndices: ref<number[] | null>(null),
  formatId: ref<BattleFormatId>(DEFAULT_BATTLE_FORMAT),
  isGenerating: ref(false)
}));

export const provideTeamBuilder = teamBuilderState.provideState;
export const __resetTeamBuilderState = teamBuilderState.resetFallbackState;

/**
 * Provides roster-building state and helpers for manual and generated teams,
 * scoped to the current Vue app.
 *
 * Play! Pokemon registers up to six and brings a subset, so the roster and the
 * brought team are separate concepts here. Analysis always describes the
 * *brought* team, since that is what actually battles.
 *
 * @returns Roster state, bring selection, summary computed values, and actions.
 */
export function useTeamBuilder() {
  const { roster, manualBringIndices, formatId, isGenerating } = teamBuilderState.useState();
  const { notify } = useNotifications();

  const format = computed(() => getBattleFormat(formatId.value));
  const maxRosterSize = computed(() => format.value.maxRosterSize);
  const bringSize = computed(() => format.value.broughtToBattle);

  const toRosterMember = (member: PartyMember): RosterMember => ({
    name: member.name,
    types: member.types,
    abilityName: member.abilityName,
    stats: member.stats as RosterMember['stats'],
    weaknesses: member.weaknesses,
    resistances: member.resistances,
    immunities: member.immunities,
    coverages: member.coverages,
    moveCoverages: member.moveCoverages,
    normalizedDamageToScore: member.normalizedDamageToScore,
    normalizedDamageFromScore: member.normalizedDamageFromScore
  });

  const rosterEvaluation = computed(() =>
    evaluateRoster(roster.value.map(toRosterMember), { format: format.value })
  );

  /** Roster positions currently brought: the user's pick, else the best option. */
  const bringIndices = computed<number[]>(() => {
    if (manualBringIndices.value) {
      return [...manualBringIndices.value].filter((index) => index < roster.value.length).sort((a, b) => a - b);
    }
    return rosterEvaluation.value.best?.indices ?? [];
  });

  const isSuggestedBring = computed(() => manualBringIndices.value === null);
  const broughtTeam = computed(() => bringIndices.value.map((index) => roster.value[index]).filter(Boolean));

  const isBrought = (index: number) => bringIndices.value.includes(index);

  // Analysis describes the brought team, not the whole roster: the other members
  // never share a battle, so folding them in would describe a team that never
  // takes the field.
  const coverageAnalysis = computed(() => analyzeTeamCoverage(
    broughtTeam.value.map((member) => ({
      ...member,
      immuneToAllyMoves: format.value.hasAlly && isImmuneToAllyMoves(member.abilityName)
    }))
  ));

  const roleAnalysis = computed(() => analyzeTeamRoles(broughtTeam.value, { hasAlly: format.value.hasAlly }));

  // The workbench reports weaknesses with no *defensive* answer, because that is
  // what "Team Weaknesses" means to a player: types nobody can switch into.
  // The generator scores against the looser resist-or-cover notion, so the two
  // legitimately differ — see teamCoverage.ts for why they are kept distinct.
  const teamWeaknessSummary = computed(() => {
    const { weaknessCounts, defensivelyUncoveredWeaknesses } = coverageAnalysis.value;
    return Object.fromEntries(
      defensivelyUncoveredWeaknesses.map(weakness => [weakness, weaknessCounts[weakness]])
    );
  });

  const teamCoverageSummary = computed(() => coverageAnalysis.value.coverageCounts);

  // Doubles-only signal: which spread moves a partner makes free to click, and
  // which have no safe pairing on this team.
  const teamSpreadSummary = computed(() => ({
    enabled: coverageAnalysis.value.enabledSpreadTypes,
    conflicts: coverageAnalysis.value.spreadConflicts
  }));

  const teamRoleSummary = computed(() => ({
    roles: roleAnalysis.value.roles,
    roleSources: roleAnalysis.value.roleSources,
    fieldConflicts: roleAnalysis.value.fieldConflicts,
    conflictingAbilities: roleAnalysis.value.conflictingAbilities
  }));

  const setFormat = (nextFormatId: BattleFormatId) => {
    if (!(nextFormatId in BATTLE_FORMATS)) return;
    formatId.value = nextFormatId;
    // A bring sized for the old format is meaningless under the new one.
    manualBringIndices.value = null;
  };

  const toggleBring = (index: number) => {
    const current = new Set(bringIndices.value);
    if (current.has(index)) {
      current.delete(index);
    } else {
      if (current.size >= bringSize.value) {
        notify(`${format.value.label} brings ${bringSize.value}. Deselect one first.`, 'error');
        return;
      }
      current.add(index);
    }
    manualBringIndices.value = [...current].sort((a, b) => a - b);
  };

  /** Drops the manual pick and returns to the highest scoring bring. */
  const useSuggestedBring = () => {
    manualBringIndices.value = null;
  };

  const addToParty = (typeData: ActiveTypeDataLike, pokemonIndex: number, abilityName?: string) => {
    if (roster.value.length >= maxRosterSize.value) {
      notify(`Roster is full at ${maxRosterSize.value}.`, 'error');
      return;
    }

    const pokemon = resolveSelectedPokemon(typeData, pokemonIndex, abilityName);
    if (!pokemon || !pokemon.types || !pokemon.stats) return;

    // Champions forbids duplicate Pokedex numbers, so the roster is keyed by
    // species. It is deliberately *not* keyed by type combination: two
    // different Water/Flying Pokemon are a legal and often sensible pair, and
    // the old rule rejected them only because typings were the entities.
    const speciesName = pokemon.species_name || pokemon.pokemon.name;
    if (roster.value.some(member => member.speciesName === speciesName)) {
      notify(`${speciesName.toUpperCase()} is already in your roster.`, "error");
      return;
    }

    roster.value.push({
      name: pokemon.pokemon.name,
      speciesName,
      types: pokemon.types.map((p) => p.type.name),
      sprite: pokemon.sprite || '',
      stats: pokemon.stats,
      abilityName: pokemon.selected_ability_name,
      weaknesses: pokemon.effective_weaknesses || typeData.weaknesses,
      resistances: pokemon.effective_resistances || typeData.resistances,
      immunities: pokemon.effective_immunities || typeData.immunities || [],
      coverages: pokemon.effective_coverages || typeData.coverages,
      moveCoverages: pokemon.effective_move_coverages || [],
      normalizedDamageToScore: normalizeDamageToScore(pokemon.effective_damage_to_score, DEFAULT_BASE_SCORE),
      normalizedDamageFromScore: normalizeDamageFromScore(pokemon.effective_damage_from_score, DEFAULT_BASE_SCORE),
      typeName: typeData.name
    });
    // Roster positions shift, so a manual pick no longer means what it did.
    manualBringIndices.value = null;
    notify(`Added ${pokemon.pokemon.name.toUpperCase()} to roster.`, "success");
  };

  const removeFromParty = (index: number) => {
    roster.value.splice(index, 1);
    manualBringIndices.value = null;
  };

  const clearParty = () => {
    roster.value = [];
    manualBringIndices.value = null;
  };

  const fromPokemonEntry = (entry: PokemonEntry): PartyMember => ({
    name: entry.name,
    speciesName: entry.speciesName,
    types: entry.types,
    sprite: entry.sprite,
    stats: entry.stats,
    abilityName: entry.abilityName,
    weaknesses: entry.weaknesses,
    resistances: entry.resistances,
    immunities: entry.immunities,
    coverages: entry.coverages,
    moveCoverages: entry.moveCoverages,
    normalizedDamageToScore: entry.normalizedDamageToScore,
    normalizedDamageFromScore: entry.normalizedDamageFromScore,
    typeName: entry.typeName
  });

  /**
   * Rebuilds the roster from a generated result.
   *
   * @param pool Pokemon the search was allowed to draw from.
   * @param seed Pokemon that must survive into the result.
   * @param successMessage Prefix for the success notification.
   * @returns Whether a roster was produced.
   */
  const runGeneration = (pool: PokemonEntry[], seed: PokemonEntry[], successMessage: string): boolean => {
    const rosters = generateRosters({
      pokemon: pool,
      format: format.value,
      rosterSize: maxRosterSize.value,
      seed
    });

    if (rosters.length === 0) return false;

    roster.value = rosters[0].members.map(fromPokemonEntry);
    manualBringIndices.value = null;
    // Deliberately not "optimal": generateRosters prunes twice, so this is the
    // best roster the search found, not the best that exists.
    notify(`${successMessage} — ${Math.round(rosters[0].score)}/100.`, "success");
    return true;
  };

  const generateFullTeam = (allowedTypes: TypeDataLike[]) => {
    isGenerating.value = true;
    try {
      const pool = flattenToPokemon(allowedTypes);
      if (!runGeneration(pool, [], 'Best roster found')) {
        notify("No valid rosters found with current filters.", "error");
      }
    } catch (e: any) {
      notify(`Generation failed: ${e.message}`, "error");
    } finally {
      isGenerating.value = false;
    }
  };

  const fillRemainingSlots = (fullList: TypeDataLike[], allowedTypes: ActiveTypeDataLike[]) => {
    if (roster.value.length >= maxRosterSize.value) return;
    if (roster.value.length === 0) {
      generateFullTeam(allowedTypes);
      return;
    }

    isGenerating.value = true;
    try {
      // Locked members can sit outside the current filters, so the seed is
      // resolved against the full list rather than the filtered pool.
      const everything = flattenToPokemon(fullList);
      const byName = new Map(everything.map((entry) => [entry.name, entry]));
      const seed = roster.value
        .map((member) => byName.get(member.name))
        .filter((entry): entry is PokemonEntry => entry !== undefined);

      const pool = flattenToPokemon(allowedTypes);
      if (!runGeneration(pool, seed, 'Roster filled')) {
        notify("No compatible partners found for this roster.", "error");
      }
    } catch (e: any) {
      notify(`Filling slots failed: ${e.message}`, "error");
    } finally {
      isGenerating.value = false;
    }
  };

  return {
    roster,
    /** @deprecated Kept as an alias while callers migrate to `roster`. */
    currentParty: roster,
    isGenerating,
    format,
    formatId,
    maxRosterSize,
    bringSize,
    bringIndices,
    broughtTeam,
    isBrought,
    isSuggestedBring,
    rosterEvaluation,
    setFormat,
    toggleBring,
    useSuggestedBring,
    teamWeaknessSummary,
    teamCoverageSummary,
    teamSpreadSummary,
    teamRoleSummary,
    addToParty,
    removeFromParty,
    clearParty,
    generateFullTeam,
    fillRemainingSlots
  };
}
