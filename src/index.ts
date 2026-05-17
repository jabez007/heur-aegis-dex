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

// Export main app component
export { HeurAegisDexMain }

// Export individual components
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

// Export a plugin for global installation
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
