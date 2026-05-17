# Heur-Aegis Dex 🐺

An advanced Pokémon meta-analysis and team building engine designed with a retro GBA aesthetic. Built for stability, resilience, and precise competitive planning.

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

## 🚀 Getting Started

### Installation

```bash
npm install
```

### Development

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
