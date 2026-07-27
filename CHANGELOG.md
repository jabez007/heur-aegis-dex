# Changelog

## Unreleased

### Added

- **Move coverage is split by damage class and read against the attacker's stats.** The generator already fetched each move's physical/special class and used it only to drop status moves; the emitted table flattened the two together. That credited Pelipper with Dark, Steel, Bug, Grass and Poison coverage it can never use at 50 Attack against 95 Special Attack. Measured across the Regulation M-B roster, 16% of the coverage types credited to a clearly one-sided attacker were reachable only through the wrong stat, and the tail was far worse than the average — Sceptile went from 12 usable move types to 5.

  `COVERAGE_MOVE_TYPES` entries are now `{ physical, special }`, and `getCoverageMoveTypes` / `getMoveCoverage` take optional stats. Pokemon whose attacking stats sit within `MIXED_ATTACKER_RATIO` (15%) keep both classes, because they genuinely run either; omitting stats also returns both, which is the honest answer for an unknown bias and matches the previous behaviour. Moves that pick their class at use time, like Shell Side Arm, count for both.

  Net effect on the roster: mean usable move types per Pokemon falls from 9.83 to 8.56, with 158 of 318 entries unchanged. This matters most where move coverage answers "does the team have a response to this weakness" — an overstated entry could mark a weakness as covered when nothing on the team could actually hit it.

- **Pokemon that register as one form and fight as another are rated on the form they fight in.** `src/lib/battleForms.ts` records which battle-only forms qualify, and just as importantly which do not — each entry carries its reasoning, so a species missing from the table can be told apart from one that was considered and rejected. A form is merged only when its trigger is an ability the registered Pokemon actually has, the typing is unchanged, and the Pokemon spends the battle in it. Today that is Palafin alone: Zero to Hero converts on the first switch-out and never reverts, a 193-point swing that took Palafin from below the default stat floor to a 650 base stat total. Aegislash, Castform, Greninja, Mimikyu and Morpeko are recorded as deliberately not merged. Affected cards disclose the form the numbers came from.

### Fixed

- **Battle-only forms no longer appear as their own Pokemon.** Gigantamax, Mimikyu-Busted, Eiscue-Noice and the like are states a Pokemon enters mid-battle, so listing them beside their base form invented team slots. Detected via `is_battle_only` on PokeAPI's form resource rather than by name suffix. Megas are battle-only by the same flag but remain a real pre-battle choice, so `allowMegas` still governs them — via `is_mega` now, replacing the `-mega` substring check. Where dropping a form would have understated the Pokemon, the battle-form rating above covers it.
- **Form controls look the same everywhere.** `.gba-label` / `.gba-select` / `.gba-input` were defined in `App.vue`'s scoped style block, so the Team Workbench's Format select rendered unstyled. They now live in `assets/scss/main.scss`.

The scan cache key moved to `v8`, so stored results containing battle-only forms — or rating Palafin as its registered form — are discarded rather than served.

## 0.3.0

Rebuilds the tool around Pokémon Champions. The domain model is inverted — Pokémon are now the primary entity rather than type combinations — and the team builder follows the real register-six-bring-some structure.

**This release contains breaking changes to the library API.** See the migration notes below.

### Breaking

- **`useMetaFilters`** exposes `requireAllTypes` in place of `hideEmptyTypes`. "Hide empty types" had no meaning once the grid stopped listing type combinations. The new flag requires a Pokémon to carry *every* selected type rather than any of them, which is how you search for a specific dual typing.
- **`useTeamBuilder`** no longer returns `addToParty`. Use `addPokemon(entry, abilityName?)`, which takes a `PokemonEntry` instead of a type card and an index. `currentParty` remains as an alias for the new `roster`.
- **`PartyMember`** gains required `speciesName`, `immunities` and `moveCoverages` fields.
- **Component props changed** as the grid became a Pokémon browser:
  - `PokemonCard`: `typeData` → `pokemon` (a `PokemonEntry`). The `update:selected-pokemon-index` emit is gone; a card shows one Pokémon, so there is nothing to page through.
  - `MetaAnalysisGrid`: `filteredTypes` → `pokemon`.
  - `TeamWorkbench`: `allDataTypes` / `filteredTypes` → `allPokemon` / `filteredPokemon`.
  - `CustomCupBuilder`: `allDataTypes` is now `ResistantTypeResult[]`, which is what `getResistantTypes` returns.
- **Team scores are now 0–100**, read as a percentage of an ideal team, rather than unbounded values in the hundreds. Rankings will differ from 0.2.x.

Removed internals that were never exported from the package entry point, listed for anyone importing deep paths: `generateTeams` and `src/lib/teamGeneration.ts`, `src/lib/activePokemon.ts` (`getPokemonAbilityProfile` moved to `src/lib/pokemonEntry.ts`), and the `TypeDataLike` / `ActiveTypeDataLike` / `GenerateTeamsOptions` / `GeneratedTeamResult` / `TeamMemberResult` types.

### Added

- **Regulation legality.** `src/lib/regulations.ts` records the published Champions M-A and M-B rosters as data, with source URLs and a verification date. Applied as a scan filter, independent of the breedable-only preference — a Pokémon must satisfy both.
- **Battle formats.** Singles (bring 3) and doubles (bring 4) are first-class, and the format decides which synergy applies.
- **Roster and bring.** The workbench registers up to six and brings a format-sized subset. `evaluateRoster` scores a roster by enumerating every legal bring and blending the best option with the depth behind it.
- **Doubles spread-move safety.** Which attacking types a partner's immunity makes free to spread, and which have no safe pairing.
- **Ability support roles.** Intimidate, redirection, ally protection and weather/terrain setters, including detection of members competing to set incompatible field states.
- **Coverage moves.** A generated table of what each Pokémon can actually learn, derived from PokeAPI's `champions` version group. Kept separate from STAB coverage.
- **`PokemonEntry`** and `flattenToPokemon` / `groupByTypeName` / `withAbility` for working with Pokémon as the primary entity.
- **`generateRosters`** searches Pokémon directly, so two Pokémon sharing a typing can appear on one roster.
- **Per-app state scoping.** `provideTeamBuilder`, `provideMetaFilters` and `provideNotifications` isolate state per Vue app; the plugin does this automatically.
- **The scan and regulation APIs are now reachable.** `getResistantTypes`, `getBaseTypes`, `getDualTypes` and the regulation helpers are exported from the package entry point. In 0.2.0 they existed but were unreachable: they were never re-exported from `src/index.ts`, and the `exports` map blocks deep imports, so no consumer could drive the engine without mounting the whole app.

### Fixed

- Superseded Pokédex scans no longer overwrite newer results.
- Type rows describe their own typing instead of inheriting the ability immunities of their highest-stat member.
- Team scoring puts member quality and synergy on one scale, so synergy can influence ranking instead of being drowned out by base stat totals.
- Damage scores normalize against the scoring formulas' absolute bounds, so results are comparable between runs with different filters.
- The workbench and the generator agree on what "covered" means.
- Generated teams are no longer described as "optimal"; the search is a beam.
- Restored the `events` browser polyfill, without which the app fails to boot.

### Packaging

- The published package no longer ships a `.d.ts` stub for every test file. `vite-plugin-dts` was walking all of `src`, so 0.2.0 included thirteen of them.
- `CHANGELOG.md` is included in the published tarball.

### Changed

- Dropped `lodash` and `lodash.combinations` from runtime dependencies.

## 0.2.0

Initial published library release.
