import type { App } from 'vue'
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

export { useTeamBuilder } from './composables/useTeamBuilder'
export { useMetaFilters, ALL_TYPES } from './composables/useMetaFilters'
export { useNotifications } from './composables/useNotifications'

export type { PartyMember } from './composables/useTeamBuilder'
export type { Notification } from './composables/useNotifications'
export type { PokemonTypeData, DamageRelations, NamedResource } from './lib/pokedex'

export default {
  install: (app: App) => {
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
