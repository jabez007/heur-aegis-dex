# Changelog

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
