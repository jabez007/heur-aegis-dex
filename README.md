# Heur-Aegis Dex 🐺

An advanced Pokémon meta-analysis and team building engine designed with a retro GBA aesthetic. Built for stability, resilience, and precise competitive planning.

[**Live Demo**](https://jabez007.github.io/heur-aegis-dex/)

## 🛠 Features

- **Regulation Legality:** Filter the roster to a published Pokémon Champions regulation set (M-A, M-B). Defaults to whichever regulation is in force today.
- **Move Coverage:** Offensive answers account for what a Pokémon can actually learn, not just its STAB, using the Champions movepool.
- **Dynamic Cup Builder:** Define custom meta-games by selecting specific type pools and region constraints.
- **Meta-Analysis Grid:** Real-time ranking of type combinations based on offensive coverage and defensive vulnerability.
- **Team Workbench:** Register a roster of up to six, then bring three (singles) or four (doubles). The workbench suggests the strongest bring and analyses the team that actually takes the field.
- **Retro Aesthetic:** Fully themed GBA-style UI with pixel-perfect sprites and custom components.
- **High Performance:** Client-side caching and optimized recursive team generation algorithms.

### Regulations

Champions publishes legality as a whitelist per regulation set, so `src/lib/regulations.ts` records those rosters as data rather than approximating them. Each entry carries its source URLs and the date its rosters were verified against PokeAPI.

Legality is kept **independent** of the breedable-only rule the scan also applies. A Pokémon must satisfy both to appear: being tournament legal does not make it something you want to raise, and being breedable does not make it legal. Selecting "Any" drops the legality filter and leaves the breedable-only preference in place.

To add a regulation, append an entry to `REGULATION_LIST` with its roster, dates and sources. Anything not recovered from a published source belongs in `incompleteFields` so an empty set reads as "not recorded" rather than "none".

### Domain Model

Pokémon are the primary entity. `src/lib/pokemonEntry.ts` flattens the scan — which is organised around 171 type combinations — into flat Pokémon records carrying their own typing, stats, abilities and coverage. `groupByTypeName` is the inverse for views that browse by typing.

Both shapes coexist on purpose: the meta grid still consumes the type-keyed view, while team building works from Pokémon. A typing is one of a Pokémon's attributes and a way to group them, not a stand-in for one.

The practical consequence is that identity is a **species**, not a typing. Two different Water/Flying Pokémon can share a roster; a species and its Mega form cannot, matching the no-duplicate-Pokédex-number rule.

### Formats and Rosters

Play! Pokémon registers up to six Pokémon and brings a subset — three in singles, four in doubles. Those are separate concepts in the code: `roster` is what you register, `bringIndices` is what enters the battle, and all team analysis describes the brought team, since the benched members never share a field.

`evaluateRoster` scores a roster by enumerating every legal bring (15 for doubles, 20 for singles) and blending the best option with the depth behind it. Open team list lets the opponent pick against your roster, so having several viable brings matters alongside having one great one.

Format also decides which synergy applies. Spread-move safety, redirection and ally protection all require a partner on the field, so they score zero in singles rather than crediting a capability the format cannot use.

### Coverage Moves

`src/lib/coverageMoveData.ts` is generated, not hand-written. It records which move types each Pokémon can bring, derived from PokeAPI's `champions` version group — the actual Champions movepool rather than a union across older games. A move counts when it is damaging with base power ≥ 60.

Rebuild it with `node scripts/gen-coverage-moves.mjs` when a regulation changes the roster.

Move reach is kept **separate** from STAB coverage rather than replacing it. The median roster Pokémon has qualifying moves of ten types out of eighteen, so merging the two would flatten the offensive signal almost to nothing. Reach answers "does the team have an answer to this weakness"; STAB stays the measure of how hard the team threatens it.

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

### State Scoping

Party, filter and notification state is provided per Vue app. Registering the plugin with `app.use(HeurAegisDex)` scopes that state automatically, so two mounted instances never share a party and server-side rendering does not carry state between requests.

If you import individual components without the plugin, they fall back to a shared module-level store. Call the provider functions during app setup to opt into isolation:

```typescript
import { provideTeamBuilder, provideMetaFilters, provideNotifications } from '@jabez007/heur-aegis-dex'

const app = createApp(App)
provideTeamBuilder(app)
provideMetaFilters(app)
provideNotifications(app)
```

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

# Verify the browser bundle does not externalize a Node builtin
npm run check:browser
```

> **Browser polyfills:** `events` is a runtime dependency even though nothing in `src/` imports it. `node-cache`, reached through `pokedex-promise-v2`, extends `EventEmitter` at module scope; Vite externalizes Node builtins for the browser, so without the polyfill the app fails to boot. The unit suite runs in Node where builtins resolve natively and cannot catch this, so `src/browserDeps.test.ts` asserts the packaging invariant and `npm run check:browser` verifies the real bundle.

## 🛡 Stability and Security

This project adheres to strict engineering standards:
- **Resilient Logic:** Guarded data lookups and clamped indices prevent runtime crashes during data updates.
- **Deterministic Builds:** Full dependency locking via `package-lock.json` ensures consistent behavior across CI environments.
- **Accessible Design:** Semantic HTML and ARIA live regions ensure the tool remains operable for all users.

---
_Guided by the Doctrine of the Spire._
