import { ref, computed } from 'vue';
import { withAbility, type PokemonEntry } from '../lib/pokemonEntry';
import { generateRosters } from '../lib/rosterGeneration';
import { analyzeTeamCoverage } from '../lib/teamCoverage';
import { analyzeTeamRoles, isImmuneToAllyMoves } from '../lib/abilityRoles';
import { evaluateRoster, type RosterMember } from '../lib/rosterScoring';
import {
  BATTLE_FORMATS,
  DEFAULT_BATTLE_FORMAT,
  getBattleFormat,
  type BattleFormatId
} from '../lib/battleFormats';
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

  /**
   * The brings worth stepping through: the roster's meaningfully different teams.
   *
   * Deliberately the distinct lines rather than every legal subset. A roster of
   * six offers fifteen bring-fours, and the top of that list is the same team
   * with one Pokemon swapped over and over — stepping through it would mostly
   * show the same four. `selectDistinctLines` already reduces that to the brings
   * differing by at least two members, which is the same set the "lines" readout
   * counts, so cycling shows exactly what the score is built from.
   */
  const bringLines = computed(() => rosterEvaluation.value.lines);

  /** Which line is on the field, or -1 for a pick that is not one of them. */
  const currentLineIndex = computed(() => {
    const current = bringIndices.value;
    if (current.length === 0) return -1;
    return bringLines.value.findIndex((line) =>
      line.indices.length === current.length &&
      line.indices.every((index) => current.includes(index))
    );
  });

  /** Score of the bring on the field, or null when it is not a scored line. */
  const currentBringScore = computed(() => {
    const current = bringIndices.value;
    const option = rosterEvaluation.value.bringOptions.find((bring) =>
      bring.indices.length === current.length &&
      bring.indices.every((index) => current.includes(index))
    );
    return option ? option.score : null;
  });

  /**
   * Steps to another line, wrapping in both directions.
   *
   * A hand-picked bring that is not a line counts as before the first one, so
   * stepping forward from it lands on the best line rather than nowhere.
   *
   * @param step How many lines to move, negative to go back.
   */
  const cycleBringLine = (step: number) => {
    const lines = bringLines.value;
    if (lines.length === 0) return;

    const from = currentLineIndex.value;
    const next = from === -1
      ? (step > 0 ? 0 : lines.length - 1)
      : (from + step + lines.length) % lines.length;

    // Line 0 is the best bring, which is what following the suggestion means, so
    // landing there clears the manual pick rather than pinning the same indices.
    manualBringIndices.value = next === 0 ? null : [...lines[next].indices].sort((a, b) => a - b);
  };

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

  /**
   * Registers a Pokemon on the roster.
   *
   *
   * @param entry Pokemon to register.
   * @param abilityName Optional ability override.
   * @returns Whether the Pokemon was added.
   */
  const addPokemon = (entry: PokemonEntry, abilityName?: string): boolean => {
    if (roster.value.length >= maxRosterSize.value) {
      notify(`Roster is full at ${maxRosterSize.value}.`, 'error');
      return false;
    }

    // Champions forbids duplicate Pokedex numbers, so identity is the species.
    if (roster.value.some(member => member.speciesName === entry.speciesName)) {
      notify(`${entry.speciesName.toUpperCase()} is already in your roster.`, 'error');
      return false;
    }

    roster.value.push(fromPokemonEntry(withAbility(entry, abilityName)));
    manualBringIndices.value = null;
    notify(`Added ${entry.name.toUpperCase()} to roster.`, 'success');
    return true;
  };

  const hasSpecies = (speciesName: string) =>
    roster.value.some((member) => member.speciesName === speciesName);

  const removeFromParty = (index: number) => {
    roster.value.splice(index, 1);
    manualBringIndices.value = null;
  };

  const clearParty = () => {
    roster.value = [];
    manualBringIndices.value = null;
  };

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

  /**
   * Builds a fresh roster from a Pokemon pool.
   *
   * @param pool Pokemon the search may draw from.
   * @returns Nothing.
   */
  const generateFullTeam = (pool: PokemonEntry[]) => {
    isGenerating.value = true;
    try {
      if (!runGeneration(pool, [], 'Best roster found')) {
        notify("No valid rosters found with current filters.", "error");
      }
    } catch (e: any) {
      notify(`Generation failed: ${e.message}`, "error");
    } finally {
      isGenerating.value = false;
    }
  };

  /**
   * Completes the current roster, keeping everything already registered.
   *
   * @param allPokemon Every scanned Pokemon, used to resolve locked members that sit outside the filters.
   * @param pool Pokemon the search may draw new members from.
   * @returns Nothing.
   */
  const fillRemainingSlots = (allPokemon: PokemonEntry[], pool: PokemonEntry[]) => {
    if (roster.value.length >= maxRosterSize.value) return;
    if (roster.value.length === 0) {
      generateFullTeam(pool);
      return;
    }

    isGenerating.value = true;
    try {
      // Locked members can sit outside the current filters, so the seed is
      // resolved against everything rather than the filtered pool.
      const byName = new Map(allPokemon.map((entry) => [entry.name, entry]));
      const seed = roster.value
        .map((member) => byName.get(member.name))
        .filter((entry): entry is PokemonEntry => entry !== undefined);

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
    addPokemon,
    hasSpecies,
    useSuggestedBring,
    bringLines,
    currentLineIndex,
    currentBringScore,
    cycleBringLine,
    teamWeaknessSummary,
    teamCoverageSummary,
    teamSpreadSummary,
    teamRoleSummary,
    removeFromParty,
    clearParty,
    generateFullTeam,
    fillRemainingSlots
  };
}
