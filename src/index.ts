import type { App } from 'vue'
import { provideTeamBuilder } from './composables/useTeamBuilder'
import { provideMetaFilters } from './composables/useMetaFilters'
import { provideNotifications } from './composables/useNotifications'
import { provideWorkspaceState } from './composables/useWorkspaceState'
import './assets/scss/main.scss'
import HeurAegisDexMain from './App.vue'
import CustomCupBuilder from './components/CustomCupBuilder.vue'
import GbaNotification from './components/GbaNotification.vue'
import MetaAnalysisGrid from './components/MetaAnalysisGrid.vue'
import MetaControls from './components/MetaControls.vue'
import PokemonCard from './components/PokemonCard.vue'
import StatBar from './components/StatBar.vue'
import TeamWorkbench from './components/TeamWorkbench.vue'
import TypeBadge from './components/TypeBadge.vue'
import WorkspaceSavesDialog from './components/WorkspaceSavesDialog.vue'

/** Main app component for standalone mounting or library use. */
export { HeurAegisDexMain }

export {
  CustomCupBuilder,
  GbaNotification,
  MetaAnalysisGrid,
  MetaControls,
  PokemonCard,
  StatBar,
  TeamWorkbench,
  TypeBadge,
  WorkspaceSavesDialog
}

export { useTeamBuilder, provideTeamBuilder } from './composables/useTeamBuilder'
export { useMetaFilters, provideMetaFilters, ALL_TYPES } from './composables/useMetaFilters'
export { useNotifications, provideNotifications } from './composables/useNotifications'
export { useWorkspaceState, provideWorkspaceState } from './composables/useWorkspaceState'

export type { PartyMember } from './composables/useTeamBuilder'
export type { Notification } from './composables/useNotifications'
export {
  WORKSPACE_STORAGE_KEY,
  WORKSPACE_VERSION,
  deleteSavedWorkspace,
  emptyWorkspaceArchive,
  isWorkspaceArchive,
  isWorkspaceSnapshot,
  mergeUnresolvedTeamIdentifiers,
  readWorkspaceArchive,
  renameSavedWorkspace,
  saveNamedWorkspace,
  writeWorkspaceArchive
} from './lib/workspacePersistence'
export type {
  PokedexRegion,
  SavedWorkspace,
  WorkspaceArchiveV1,
  WorkspaceSnapshotV1,
  WorkspaceStorage
} from './lib/workspacePersistence'
// The scan itself, so consumers can drive the engine without mounting the app.
export {
  DEFAULT_STATS_FILTERS,
  getBaseTypes,
  getDualTypes,
  getResistantTypes,
  hpAdjustedBulk
} from './lib/pokedex'
export type {
  PokemonTypeData,
  DamageRelations,
  NamedResource,
  ResistantTypeResult,
  TeamTypeData,
  PokemonListEntry,
  PokemonStats,
  AbilityProfile
} from './lib/pokedexTypes'

export {
  REGULATIONS,
  getActiveRegulation,
  getRegulation,
  isSpeciesLegal,
  canMegaEvolve,
  hasCompleteData
} from './lib/regulations'
export type { Regulation, RegulationId, RegulationRules, MechanicId } from './lib/regulations'

export {
  BATTLE_FORMS,
  getMergedBattleForm,
  hasBattleFormRule
} from './lib/battleForms'
export type { BattleFormRule } from './lib/battleForms'

export {
  UNBREEDABLE_FORMS,
  UNBREEDABLE_VARIETIES,
  isVarietyBreedable,
  hasUnbreedableFormRule
} from './lib/unbreedableForms'
export type { UnbreedableFormRule } from './lib/unbreedableForms'

export {
  STAT_ABILITIES,
  getEffectiveStats,
  getStatAbility,
  hasStatAbilityRule
} from './lib/statAbilities'
export type { StatAbilityRule, ModifiableStat } from './lib/statAbilities'

export {
  BATTLE_FORMATS,
  BATTLE_FORMAT_LIST,
  DEFAULT_BATTLE_FORMAT,
  combinationsOf,
  getBattleFormat,
  isBattleFormatId
} from './lib/battleFormats'
export type { BattleFormat, BattleFormatId } from './lib/battleFormats'
export {
  ROSTER_WEIGHTS,
  VIABLE_LINE_MARGIN,
  countTargetLines,
  evaluateRoster,
  maxSharedMembers,
  scoreBring,
  selectDistinctLines
} from './lib/rosterScoring'
export type { RosterMember, RosterEvaluation, BringOption } from './lib/rosterScoring'

export {
  flattenToPokemon,
  groupByTypeName,
  getPokemonAbilityProfile,
  toPokemonEntry,
  withAbility
} from './lib/pokemonEntry'
export type { PokemonEntry, FlattenOptions } from './lib/pokemonEntry'

export {
  ROSTER_BEAM_WIDTH,
  DEFAULT_CANDIDATE_LIMIT,
  CANDIDATE_WEIGHTS,
  candidatePriority,
  countTypeOverlap,
  countSharedWeaknesses,
  DEFAULT_UNANSWERED_WEAKNESS_SLACK,
  generateRosters
} from './lib/rosterGeneration'
export type { GenerateRostersOptions, GeneratedRoster } from './lib/rosterGeneration'

export { analyzeTeamCoverage } from './lib/teamCoverage'
export type { TeamCoverageProfile, TeamCoverageAnalysis } from './lib/teamCoverage'
export {
  ABILITY_ROLES,
  DOUBLES_ABILITIES,
  analyzeTeamRoles,
  getAbilityEffect,
  isImmuneToAllyMoves
} from './lib/abilityRoles'
export type { AbilityRole, AbilityEffect, TeamRoleAnalysis } from './lib/abilityRoles'

export {
  ABILITY_QUALITY_EFFECTS,
  getAbilityQualityEffect,
  getQualityMultipliers,
  hasAbilityQualityRule
} from './lib/abilityEffects'
export type { AbilityQualityRule, QualityComponent } from './lib/abilityEffects'

export {
  STATUS_THREAT,
  getStatusImmunityMultipliers,
  grantsStatusImmunity
} from './lib/statusThreat'
export { STATUS_MOVE_AILMENTS } from './lib/statusMoveData'
export type { Ailment } from './lib/statusMoveData'

export default {
  install: (app: App) => {
    // Each app gets its own party, filters and notifications. Without this the
    // components would fall back to shared module state, so two mounted
    // instances would fight over one party and SSR would leak state between
    // requests.
    provideTeamBuilder(app)
    provideMetaFilters(app)
    provideNotifications(app)
    provideWorkspaceState(app)

    app.component('HeurAegisDexMain', HeurAegisDexMain)
    app.component('CustomCupBuilder', CustomCupBuilder)
    app.component('GbaNotification', GbaNotification)
    app.component('MetaAnalysisGrid', MetaAnalysisGrid)
    app.component('MetaControls', MetaControls)
    app.component('PokemonCard', PokemonCard)
    app.component('StatBar', StatBar)
    app.component('TeamWorkbench', TeamWorkbench)
    app.component('TypeBadge', TypeBadge)
    app.component('WorkspaceSavesDialog', WorkspaceSavesDialog)
  }
}
