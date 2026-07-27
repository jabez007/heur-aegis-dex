import type { App } from 'vue'
import { provideTeamBuilder } from './composables/useTeamBuilder'
import { provideMetaFilters } from './composables/useMetaFilters'
import { provideNotifications } from './composables/useNotifications'
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
  TypeBadge
}

export { useTeamBuilder, provideTeamBuilder } from './composables/useTeamBuilder'
export { useMetaFilters, provideMetaFilters, ALL_TYPES } from './composables/useMetaFilters'
export { useNotifications, provideNotifications } from './composables/useNotifications'

export type { PartyMember } from './composables/useTeamBuilder'
export type { Notification } from './composables/useNotifications'
export type { PokemonTypeData, DamageRelations, NamedResource } from './lib/pokedex'

export {
  BATTLE_FORMATS,
  BATTLE_FORMAT_LIST,
  DEFAULT_BATTLE_FORMAT,
  combinationsOf,
  getBattleFormat
} from './lib/battleFormats'
export type { BattleFormat, BattleFormatId } from './lib/battleFormats'
export {
  ROSTER_WEIGHTS,
  ROSTER_DEPTH_OPTIONS,
  evaluateRoster,
  scoreBring
} from './lib/rosterScoring'
export type { RosterMember, RosterEvaluation, BringOption } from './lib/rosterScoring'

export {
  flattenToPokemon,
  groupByTypeName,
  toPokemonEntry,
  withAbility
} from './lib/pokemonEntry'
export type { PokemonEntry, FlattenOptions } from './lib/pokemonEntry'

export {
  ROSTER_BEAM_WIDTH,
  DEFAULT_CANDIDATE_LIMIT,
  CANDIDATE_WEIGHTS,
  candidatePriority,
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

export default {
  install: (app: App) => {
    // Each app gets its own party, filters and notifications. Without this the
    // components would fall back to shared module state, so two mounted
    // instances would fight over one party and SSR would leak state between
    // requests.
    provideTeamBuilder(app)
    provideMetaFilters(app)
    provideNotifications(app)

    app.component('HeurAegisDexMain', HeurAegisDexMain)
    app.component('CustomCupBuilder', CustomCupBuilder)
    app.component('GbaNotification', GbaNotification)
    app.component('MetaAnalysisGrid', MetaAnalysisGrid)
    app.component('MetaControls', MetaControls)
    app.component('PokemonCard', PokemonCard)
    app.component('StatBar', StatBar)
    app.component('TeamWorkbench', TeamWorkbench)
    app.component('TypeBadge', TypeBadge)
  }
}
