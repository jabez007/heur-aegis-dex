import { ref, computed } from 'vue';
import { withAbility, type PokemonEntry } from '../lib/pokemonEntry';
import { generateRosters } from '../lib/rosterGeneration';
import { analyzeTeamCoverage } from '../lib/teamCoverage';
import { analyzeTeamRoles, isImmuneToAllyMoves } from '../lib/abilityRoles';
import { evaluateRoster, type RosterMember } from '../lib/rosterScoring';
import {
  DEFAULT_BATTLE_FORMAT,
  getBattleFormat,
  isBattleFormatId,
  type BattleFormatId
} from '../lib/battleFormats';
import { useNotifications } from './useNotifications';
import { createInjectableState } from './injectableState';

const FILL_ALTERNATIVE_SCORE_MARGIN = 3;

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
  /**
   * Strict 4x subset of `weaknesses`. Carried separately because the team
   * analysis weighs it separately: a type two members are quadruply weak to is
   * the shape that loses games, and folding it into `weaknesses` would price it
   * as an ordinary one.
   */
  quadrupleWeaknesses: string[];
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
  isGenerating: ref(false),
  fillSeedNames: ref<string[]>([]),
  lastFilledRosterKey: ref<string | null>(null),
  fillAlternativeCount: ref(0),
  fillAlternativesDirty: ref(false),
  /** Pokemon varieties automatic roster generation must not add. */
  excludedPokemonNames: ref<string[]>([])
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
  const {
    roster,
    manualBringIndices,
    formatId,
    isGenerating,
    fillSeedNames,
    lastFilledRosterKey,
    fillAlternativeCount,
    fillAlternativesDirty,
    excludedPokemonNames
  } = teamBuilderState.useState();
  const { notify } = useNotifications();

  const format = computed(() => getBattleFormat(formatId.value));
  const maxRosterSize = computed(() => format.value.maxRosterSize);
  const bringSize = computed(() => format.value.broughtToBattle);
  const canTryAnotherRoster = computed(() =>
    roster.value.length >= maxRosterSize.value &&
    fillSeedNames.value.length > 0 &&
    (fillAlternativeCount.value > 1 || fillAlternativesDirty.value)
  );

  const resetFillCycle = () => {
    fillSeedNames.value = [];
    lastFilledRosterKey.value = null;
    fillAlternativeCount.value = 0;
    fillAlternativesDirty.value = false;
  };

  const isExcludedFromGeneration = (name: string) => excludedPokemonNames.value.includes(name);

  const toggleGenerationExclusion = (name: string) => {
    const index = excludedPokemonNames.value.indexOf(name);
    if (index === -1) {
      excludedPokemonNames.value.push(name);
    } else {
      excludedPokemonNames.value.splice(index, 1);
    }
    fillAlternativesDirty.value = fillSeedNames.value.length > 0;
    lastFilledRosterKey.value = null;
  };

  const clearGenerationExclusions = () => {
    if (excludedPokemonNames.value.length === 0) return;
    excludedPokemonNames.value = [];
    fillAlternativesDirty.value = fillSeedNames.value.length > 0;
    lastFilledRosterKey.value = null;
  };

  const toRosterMember = (member: PartyMember): RosterMember => ({
    name: member.name,
    types: member.types,
    abilityName: member.abilityName,
    stats: member.stats as RosterMember['stats'],
    weaknesses: member.weaknesses,
    quadruple_weaknesses: member.quadrupleWeaknesses,
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
   * stepping forward from it lands on the best line rather than nowhere. A step
   * of zero from there stays off-line rather than jumping somewhere.
   *
   * Total for any integer step. The workbench only ever passes ±1, but this is
   * exported from the published composable, and `(from + step + length) %
   * length` normalizes exactly one wrap — `cycleBringLine(-5)` across three
   * lines produced -2 and indexed off the end.
   *
   * @param step How many lines to move, negative to go back.
   */
  const cycleBringLine = (step: number) => {
    const lines = bringLines.value;
    if (lines.length === 0 || !Number.isFinite(step)) return;

    const from = currentLineIndex.value;
    if (from === -1 && step === 0) return;

    const wrap = (index: number) => ((index % lines.length) + lines.length) % lines.length;
    const next = from === -1
      ? (step > 0 ? wrap(step - 1) : wrap(step))
      : wrap(from + step);

    // Line 0 is the best bring, which is what following the suggestion means, so
    // landing there clears the manual pick rather than pinning the same indices.
    manualBringIndices.value = next === 0 ? null : [...lines[next].indices].sort((a, b) => a - b);
  };

  const isBrought = (index: number) => bringIndices.value.includes(index);

  // Analysis describes the brought team, not the whole roster: the other members
  // never share a battle, so folding them in would describe a team that never
  // takes the field.
  // Routed through toRosterMember rather than spreading the PartyMember: the
  // analysis reads snake_case fields, so a spread silently supplies nothing for
  // any field whose two names differ. That is exactly how quadruple_weaknesses
  // went missing here while the roster generator scored it.
  const coverageAnalysis = computed(() => analyzeTeamCoverage(
    broughtTeam.value.map((member) => ({
      ...toRosterMember(member),
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
    quadrupleWeaknesses: entry.quadrupleWeaknesses,
    resistances: entry.resistances,
    immunities: entry.immunities,
    coverages: entry.coverages,
    moveCoverages: entry.moveCoverages,
    normalizedDamageToScore: entry.normalizedDamageToScore,
    normalizedDamageFromScore: entry.normalizedDamageFromScore,
    typeName: entry.typeName
  });

  const setFormat = (nextFormatId: BattleFormatId) => {
    if (!isBattleFormatId(nextFormatId)) return;
    formatId.value = nextFormatId;
    // A bring sized for the old format is meaningless under the new one.
    manualBringIndices.value = null;
    resetFillCycle();
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
    resetFillCycle();
    notify(`Added ${entry.name.toUpperCase()} to roster.`, 'success');
    return true;
  };

  const hasSpecies = (speciesName: string) =>
    roster.value.some((member) => member.speciesName === speciesName);

  const removeFromParty = (index: number) => {
    roster.value.splice(index, 1);
    manualBringIndices.value = null;
    resetFillCycle();
  };

  const clearParty = () => {
    roster.value = [];
    manualBringIndices.value = null;
    resetFillCycle();
  };

  /**
   * Rebuilds the roster from a generated result.
   *
   * @param pool Pokemon the search was allowed to draw from.
   * @param seed Pokemon that must survive into the result.
   * @param successMessage Prefix for the success notification.
   * @param cycleAlternatives Whether to advance through the strongest completions.
   * @returns Whether a roster was produced.
   */
  const runGeneration = (
    pool: PokemonEntry[],
    seed: PokemonEntry[],
    successMessage: string,
    cycleAlternatives = false
  ): boolean => {
    const allowedPokemon = pool.filter((entry) => !isExcludedFromGeneration(entry.name));
    const rosters = generateRosters({
      pokemon: allowedPokemon,
      format: format.value,
      rosterSize: maxRosterSize.value,
      seed
    });

    if (cycleAlternatives) {
      fillAlternativesDirty.value = false;
      fillAlternativeCount.value = 0;
    }
    if (rosters.length === 0) return false;

    const alternatives = cycleAlternatives
      ? rosters.filter((candidate) => rosters[0].score - candidate.score <= FILL_ALTERNATIVE_SCORE_MARGIN)
      : [rosters[0]];
    fillAlternativeCount.value = cycleAlternatives ? alternatives.length : 0;
    const rosterKey = (members: PokemonEntry[]) =>
      members.map((member) => member.name).sort().join('|');
    const previousIndex = alternatives.findIndex((candidate) =>
      rosterKey(candidate.members) === lastFilledRosterKey.value
    );
    const selectedIndex = cycleAlternatives && previousIndex >= 0
      ? (previousIndex + 1) % alternatives.length
      : 0;
    const selected = alternatives[selectedIndex];

    roster.value = selected.members.map(fromPokemonEntry);
    manualBringIndices.value = null;
    lastFilledRosterKey.value = rosterKey(selected.members);
    // Deliberately not "optimal": generateRosters prunes twice, so this is the
    // best roster the search found, not the best that exists.
    const option = cycleAlternatives && alternatives.length > 1
      ? ` (option ${selectedIndex + 1}/${alternatives.length})`
      : '';
    notify(`${successMessage}${option} — ${Math.round(selected.score)}/100.`, "success");
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
      resetFillCycle();
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
    const isTryingAnother = canTryAnotherRoster.value;
    if (roster.value.length >= maxRosterSize.value && !isTryingAnother) return;
    if (roster.value.length === 0) {
      generateFullTeam(pool);
      return;
    }

    isGenerating.value = true;
    try {
      // Locked members can sit outside the current filters, so the seed is
      // resolved against everything rather than the filtered pool.
      const byName = new Map(allPokemon.map((entry) => [entry.name, entry]));
      const membersToKeep = isTryingAnother
        ? fillSeedNames.value
          .map((name) => roster.value.find((member) => member.name === name))
          .filter((member): member is PartyMember => member !== undefined)
        : roster.value;
      const seed = membersToKeep
        .map((member) => {
          const entry = byName.get(member.name);
          return entry ? withAbility(entry, member.abilityName) : undefined;
        })
        .filter((entry): entry is PokemonEntry => entry !== undefined);

      // Anything the scan cannot resolve would drop out of the seed silently,
      // and runGeneration replaces roster.value wholesale — so a member this
      // function promises to keep would be quietly swapped for something the
      // search preferred. A rescan under a different regulation is enough to
      // get here. Refuse rather than destroy a registration the user made:
      // they can remove it deliberately, which is a choice, or rescan.
      const unresolved = membersToKeep
        .filter((member) => !byName.has(member.name))
        .map((member) => member.name);

      if (unresolved.length > 0) {
        notify(
          `Cannot fill: ${unresolved.join(', ')} ${unresolved.length === 1 ? 'is' : 'are'} `
          + 'not in the current scan. Rescan or remove them first.',
          "error"
        );
        return;
      }

      if (!runGeneration(pool, seed, 'Roster filled', true)) {
        notify("No compatible partners found for this roster.", "error");
      } else if (!isTryingAnother) {
        fillSeedNames.value = membersToKeep.map((member) => member.name);
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
    canTryAnotherRoster,
    excludedPokemonNames,
    isExcludedFromGeneration,
    toggleGenerationExclusion,
    clearGenerationExclusions,
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
