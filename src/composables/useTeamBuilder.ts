import { ref, computed } from 'vue';
import { generateTeams } from '../lib/pokedex';
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
import type { TeamMemberResult } from '../lib/pokedexTypes';
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

  const toPartyMember = (member: TeamMemberResult, typeName: string, typeData: TypeDataLike): PartyMember => ({
    name: member.name,
    speciesName: member.species_name || member.name,
    types: member.types,
    sprite: member.sprite || '',
    stats: member.stats,
    abilityName: member.selected_ability_name,
    weaknesses: member.effective_weaknesses || typeData.weaknesses,
    resistances: member.effective_resistances || typeData.resistances,
    immunities: member.effective_immunities || typeData.immunities || [],
    coverages: member.effective_coverages || typeData.coverages,
    moveCoverages: member.effective_move_coverages || [],
    normalizedDamageToScore: member.normalized_damage_to_score,
    normalizedDamageFromScore: member.normalized_damage_from_score,
    typeName
  });

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

  const applyGeneratedRoster = (
    members: TeamMemberResult[],
    typeNames: string[],
    lookup: TypeDataLike[]
  ): PartyMember[] =>
    members.map((member, index) => {
      const typeName = typeNames[index];
      const typeData = lookup.find(t => t.name === typeName);
      return typeData ? toPartyMember(member, typeName, typeData) : null;
    }).filter((member): member is PartyMember => member !== null);

  const generateFullTeam = (allowedTypes: TypeDataLike[]) => {
    isGenerating.value = true;
    try {
      const teams = generateTeams({
        allowedTypes: allowedTypes,
        teamSize: maxRosterSize.value,
        seed: []
      });

      if (teams.length > 0) {
        const topTeam = teams[0];
        roster.value = applyGeneratedRoster(topTeam.pokemon, topTeam.types, allowedTypes);
        manualBringIndices.value = null;
        // Deliberately not "optimal": generateTeams is a beam search, so this is
        // the best roster it found, not the best roster that exists.
        notify(`Best roster found — bring scores ${Math.round(rosterEvaluation.value.score)}/100.`, "success");
      } else {
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
      const seed = roster.value.map((member): ActiveTypeDataLike | null => {
        // Seed members can be filtered out of the current view, but generation still
        // needs to reconstruct their full type record to preserve the locked choice.
        const typeData = fullList.find(t => t.name === member.typeName);
        if (!typeData) return null;
        const pokemonIndex = typeData.pokemon.findIndex((p: any) => p.pokemon.name === member.name);
        const selectedPokemon = resolveSelectedPokemon(typeData, pokemonIndex, member.abilityName);
        if (!selectedPokemon) return null;
        return {
          ...typeData,
          selectedPokemon,
          selected_pokemon_index: pokemonIndex,
          selected_ability_name: selectedPokemon.selected_ability_name || ''
        };
      }).filter((item): item is ActiveTypeDataLike => item !== null);

      const teams = generateTeams({
        allowedTypes: allowedTypes,
        teamSize: maxRosterSize.value,
        seed
      });

      if (teams.length > 0) {
        const topTeam = teams[0];
        roster.value = applyGeneratedRoster(topTeam.pokemon, topTeam.types, fullList);
        manualBringIndices.value = null;
        notify(`Roster filled — bring scores ${Math.round(rosterEvaluation.value.score)}/100.`, "success");
      } else {
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
