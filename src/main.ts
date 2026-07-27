import { createApp } from 'vue'
import './assets/scss/main.scss'
import App from './App.vue'
import { provideTeamBuilder } from './composables/useTeamBuilder'
import { provideMetaFilters } from './composables/useMetaFilters'
import { provideNotifications } from './composables/useNotifications'

const app = createApp(App)

// Scope state to this app rather than relying on the module-level fallback.
provideTeamBuilder(app)
provideMetaFilters(app)
provideNotifications(app)

app.mount('#app')
