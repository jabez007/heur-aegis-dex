# Heur-Aegis Dex 🐺

An advanced Pokémon meta-analysis and team building engine designed with a retro GBA aesthetic. Built for stability, resilience, and precise competitive planning.

[**Live Demo**](https://jabez007.github.io/heur-aegis-dex/)

## 🛠 Features

- **Regulation Legality:** Filter the roster to a published Pokémon Champions regulation set (M-A, M-B). Defaults to whichever regulation is in force today.
- **Move Coverage:** Offensive answers account for what a Pokémon can actually learn, not just its STAB, using the Champions movepool.
- **Dynamic Cup Builder:** Define custom meta-games by selecting specific type pools and region constraints.
- **Pokémon Browser:** Every eligible Pokémon, ranked by balance of coverage against vulnerability, filtered by type and with a per-Pokémon ability selector.
- **Team Workbench:** Register a roster of up to six, then bring three (singles) or four (doubles). The workbench suggests the strongest bring and analyses the team that actually takes the field.
- **Local Workspaces:** Automatically recover the current draft or save named workspace snapshots containing scan settings, filters, roster choices, abilities, and generation exclusions.
- **Retro Aesthetic:** Fully themed GBA-style UI with pixel-perfect sprites and custom components.
- **High Performance:** Client-side caching and pruned beam-search roster generation.

### Regulations

Champions publishes legality as a whitelist per regulation set, so `src/lib/regulations.ts` records those rosters as data rather than approximating them. Each entry carries its source URLs and the date its rosters were verified against PokeAPI.

Legality is kept **independent** of the breedable-only rule the scan also applies. A Pokémon must satisfy both to appear: being tournament legal does not make it something you want to raise, and being breedable does not make it legal. Selecting "Any" drops the legality filter and leaves the breedable-only preference in place.

To add a regulation, append an entry to `REGULATION_LIST` with its roster, dates and sources. Anything not recovered from a published source belongs in `incompleteFields` so an empty set reads as "not recorded" rather than "none".

`npm run check:regulations` fails when no regulation is active or when the known
schedule ends within 21 days. The same check runs weekly in CI so an expiring
roster cannot silently turn the default scan into unrestricted play.

### Pokemon Catalog

`npm run gen:pokemon-catalog` rebuilds `data/pokemon-catalog.v1.json` from the
pinned `PokeAPI/api-data` revision recorded by the generator. The artifact stores
normalized external facts, not scores or final scan results, and is validated
against its manifest, regulation digest, forms, and variety joins. Generation is
atomic: an incomplete or malformed source walk leaves the previous artifact
untouched.

Runtime scans lazy-load this committed catalog, verify its semantic contract and
content hash, then recompute scores and filters locally. A valid revision-bound browser cache
hit avoids loading the catalog chunk. Live PokeAPI acquisition remains isolated
to development parity tests and data-generation tools.

### Domain Model

Pokémon are the primary entity. `src/lib/pokemonEntry.ts` flattens the scan — which is organised around 171 type combinations — into flat Pokémon records carrying their own typing, stats, abilities and coverage. `groupByTypeName` is the inverse for views that browse by typing.

The grid is a Pokémon browser: types are a *filter* on it, not the thing being listed. `groupByTypeName` remains for anything that wants the type-keyed view back.

The practical consequence is that identity is a **species**, not a typing. Two different Water/Flying Pokémon can share a roster; a species and its Mega form cannot, matching the no-duplicate-Pokédex-number rule.

### Formats and Rosters

Play! Pokémon registers up to six Pokémon and brings a subset — three in singles, four in doubles. Those are separate concepts in the code: `roster` is what you register, `bringIndices` is what enters the battle, and all team analysis describes the brought team, since the benched members never share a field.

`evaluateRoster` scores a roster by enumerating every legal bring (15 for doubles, 20 for singles) and blending the best option with the depth behind it. Open team list lets the opponent pick against your roster, so having several viable brings matters alongside having one great one.

Format also decides which synergy applies. Spread-move safety, redirection and ally protection all require a partner on the field, so they score zero in singles rather than crediting a capability the format cannot use.

### Coverage Moves

`src/lib/coverageMoveData.ts` is generated, not hand-written. It records which move types each Pokémon can bring, derived from PokeAPI's `champions` version group — the actual Champions movepool rather than a union across older games. A move counts when it is damaging with base power ≥ 60.

Rebuild it with `npm run gen:coverage-moves` when a regulation changes the roster. That writes `coverage-table.txt` and `coverage-stats.json` at the repository root; paste the table into the `COVERAGE_MOVE_TYPES` literal in `src/lib/coverageMoveData.ts` and update the generated-on line in its header. The step is manual on purpose — the header records the roster size and reasoning the table was built against, and a generator that overwrote it would drop the part a reader needs.

`npm run gen:scoring-fixture` differs: it writes `src/lib/scoring.fixture.ts` directly, because that file is data with no hand-written commentary to lose.

Move reach is kept **separate** from STAB coverage rather than replacing it. The median roster Pokémon has qualifying moves of ten types out of eighteen, so merging the two would flatten the offensive signal almost to nothing. Reach answers "does the team have an answer to this weakness"; STAB stays the measure of how hard the team threatens it.

## 🧪 Tech Stack

- **Framework:** Vue 3 (Composition API)
- **Language:** TypeScript
- **Build Tool:** Vite
- **Styling:** SASS (SCSS)
- **Data Source:** Versioned PokeAPI catalog, verified and scanned locally
- **Quality Assurance:** Vitest for unit testing, ESLint for code standards.
- **Deployment:** GitHub Actions for automated deployment to GitHub Pages.

## 📦 Library Usage

Heur-Aegis Dex can also be used as a component library in other Vue 3 projects. See [CHANGELOG.md](./CHANGELOG.md) for breaking changes between versions.

Published packages include the project GPL-3.0 license and the BSD-3-Clause
notice for the bundled PokeAPI-derived catalog data.

Beyond the components, the package exports the engine itself — `getResistantTypes` to run a scan, `flattenToPokemon` to work with the results, `generateRosters` and `evaluateRoster` for team building, and the regulation and battle-format data.

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

Workspace, party, filter and notification state is provided per Vue app. Registering the plugin with `app.use(HeurAegisDex)` scopes that reactive state automatically, so mounted instances do not share in-memory party or filter state and server-side rendering does not carry it between requests. Saved workspaces still use browser storage shared by the current origin.

If you import individual components without the plugin, they fall back to a shared module-level store. Call the provider functions during app setup to opt into isolation:

```typescript
import { provideTeamBuilder, provideMetaFilters, provideNotifications, provideWorkspaceState } from '@jabez007/heur-aegis-dex'

const app = createApp(App)
provideTeamBuilder(app)
provideMetaFilters(app)
provideNotifications(app)
provideWorkspaceState(app)
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

# Verify lazy catalog chunks and production package formats
npm run check:browser

# Pack, install, and verify ESM, CommonJS, and TypeScript consumers
npm run check:package

# Verify scanning with every external service blocked
npm run test:browser:offline
```

The production graph contains neither `pokedex-promise-v2` nor its Node-oriented
cache and `events` polyfill. `npm run check:browser` verifies that exclusion and
loads the lazy catalog through both ES and CommonJS package builds.

Catalog verification requires Web Crypto. The deployed browser app therefore
requires a secure context, and package consumers require Node.js 22 or newer.

## 🛡 Stability and Security

This project adheres to strict engineering standards:
- **Resilient Logic:** Guarded data lookups and clamped indices prevent runtime crashes during data updates.
- **Deterministic Builds:** Full dependency locking via `package-lock.json` ensures consistent behavior across CI environments.
- **Accessible Design:** Semantic HTML and ARIA live regions ensure the tool remains operable for all users.

---
_Guided by the Doctrine of the Spire._
