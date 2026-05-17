# Heur-Aegis Dex 🐺

An advanced Pokémon meta-analysis and team building engine designed with a retro GBA aesthetic. Built for stability, resilience, and precise competitive planning.

[**Live Demo**](https://jabez007.github.io/heur-aegis-dex/)

## 🛠 Features

- **Dynamic Cup Builder:** Define custom meta-games by selecting specific type pools and region constraints.
- **Meta-Analysis Grid:** Real-time ranking of type combinations based on offensive coverage and defensive vulnerability.
- **Team Workbench:** Assemble 3-member teams with automated "Auto-Fill" logic that suggests optimal partners based on current team weaknesses.
- **Retro Aesthetic:** Fully themed GBA-style UI with pixel-perfect sprites and custom components.
- **High Performance:** Client-side caching and optimized recursive team generation algorithms.

## 🧪 Tech Stack

- **Framework:** Vue 3 (Composition API)
- **Language:** TypeScript
- **Build Tool:** Vite
- **Styling:** SASS (SCSS)
- **Data Source:** PokeAPI via `pokedex-promise-v2`
- **Quality Assurance:** Vitest for unit testing, ESLint for code standards.
- **Deployment:** GitHub Actions for automated deployment to GitHub Pages.

## 📦 Library Usage

Heur-Aegis Dex can also be used as a component library in other Vue 3 projects.

### Installation

```bash
npm install @jabez007/heur-aegis-dex
```

### Registration

You can register it as a plugin to make the entire app and all components available globally:

```typescript
import { createApp } from 'vue'
import HeurAegisDex from '@jabez007/heur-aegis-dex'
import '@jabez007/heur-aegis-dex/style.css'

const app = createApp(App)
app.use(HeurAegisDex)
app.mount('#app')

// In your template:
// <HeurAegisDexMain />
```

Or import the main app component directly:

```typescript
import { HeurAegisDexMain } from '@jabez007/heur-aegis-dex'
import '@jabez007/heur-aegis-dex/style.css'

// In your component:
// <HeurAegisDexMain />
```

Or import individual components:

```typescript
import { PokemonCard } from '@jabez007/heur-aegis-dex'
import '@jabez007/heur-aegis-dex/style.css'
```

> **Note on Styling:** To prevent the GBA aesthetic from leaking into your host application, all library styles are namespaced under the `.heur-aegis-dex` class. If you use `HeurAegisDexMain`, this is handled automatically. If you use individual components, you should wrap them in a container with this class:
> 
> ```html
> <div class="heur-aegis-dex">
>   <PokemonCard :pokemon="..." />
> </div>
> ```

## 🚀 Development

```bash
npm run dev
```

### Building for Production

```bash
npm run build
```

### Testing and Linting

```bash
# Run unit tests
npm test

# Run linter
npm run lint

# Automatically fix linting issues
npm run lint:fix
```

## 🛡 Stability and Security

This project adheres to strict engineering standards:
- **Resilient Logic:** Guarded data lookups and clamped indices prevent runtime crashes during data updates.
- **Deterministic Builds:** Full dependency locking via `package-lock.json` ensures consistent behavior across CI environments.
- **Accessible Design:** Semantic HTML and ARIA live regions ensure the tool remains operable for all users.

---
_Guided by the Doctrine of the Spire._
