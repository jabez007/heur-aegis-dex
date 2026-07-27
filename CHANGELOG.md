# Changelog

## Unreleased

### Added

- **Unconditional stat abilities are applied.** `src/lib/statAbilities.ts` applies Huge Power, Pure Power, Fur Coat, Ice Scales and Hustle — the abilities that change a stat with no setup at all. The other twelve carried by a Regulation M-B legal species (Chlorophyll, Swift Swim, Guts, Solar Power, Plus/Minus and the rest) are recorded with the condition that rules them out, so their absence reads as a decision rather than an oversight. Each ability profile carries its own stat line, so switching ability moves the numbers and the coverage list, not just the resistances. Cards disclose which ability changed the stats and by how much.

  **Ability selection changed with it.** The default ability was previously chosen on defensive merit alone, which handed Azumarill Sap Sipper over the ability that doubles its Attack. A stat ability now wins the default.

  **The stat floors see the ability**, so Azumarill is measured at the 100 Attack it swings with rather than the 50 it is printed with, and Furfrou at the 120 Defense Fur Coat gives it. Together with the recalibrated floors below, that brings Azumarill, Medicham, Diggersby and Furfrou back into a default scan.

  Caveat recorded in the table: Hustle's ×1.5 Attack comes with an 80% physical accuracy penalty that a stat line cannot express, so Hustle Pokemon read slightly stronger here than they play.

- **Move coverage is split by damage class and read against the attacker's stats.** The generator already fetched each move's physical/special class and used it only to drop status moves; the emitted table flattened the two together. That credited Pelipper with Dark, Steel, Bug, Grass and Poison coverage it can never use at 50 Attack against 95 Special Attack. Measured across the Regulation M-B roster, 16% of the coverage types credited to a clearly one-sided attacker were reachable only through the wrong stat, and the tail was far worse than the average — Sceptile went from 12 usable move types to 5.

  `COVERAGE_MOVE_TYPES` entries are now `{ physical, special }`, and `getCoverageMoveTypes` / `getMoveCoverage` take optional stats. Pokemon whose attacking stats sit within `MIXED_ATTACKER_RATIO` (15%) keep both classes, because they genuinely run either; omitting stats also returns both, which is the honest answer for an unknown bias and matches the previous behaviour. Moves that pick their class at use time, like Shell Side Arm, count for both.

  Net effect on the roster: mean usable move types per Pokemon falls from 9.83 to 8.56, with 158 of 318 entries unchanged. This matters most where move coverage answers "does the team have a response to this weakness" — an overstated entry could mark a weakness as covered when nothing on the team could actually hit it.

- **Pokemon that register as one form and fight as another are rated on the form they fight in.** `src/lib/battleForms.ts` records which battle-only forms qualify, and just as importantly which do not — each entry carries its reasoning, so a species missing from the table can be told apart from one that was considered and rejected. A form is merged only when its trigger is an ability the registered Pokemon actually has, the typing is unchanged, and the Pokemon spends the battle in it. Today that is Palafin alone: Zero to Hero converts on the first switch-out and never reverts, a 193-point swing that took Palafin from below the default stat floor to a 650 base stat total. Aegislash, Castform, Greninja, Mimikyu and Morpeko are recorded as deliberately not merged. Affected cards disclose the form the numbers came from.

### Changed

- **Candidate ranking credits support roles, and ability selection stops hiding them.** `candidatePriority` — which orders the Pokemon Browser and, more consequentially, picks the `DEFAULT_CANDIDATE_LIMIT` Pokemon the roster search ever looks at — scored only typing and stats. It was blind to Intimidate, Drizzle, redirection and ally protection, so a support Pokemon could be pruned before team synergy, which *does* weigh roles, had any chance to see it. A role is now worth `CANDIDATE_WEIGHTS.supportRole` (12), about three resistances and well under a quadruple weakness. Reasoned, not validated.

  Redirection and ally protection are worth nothing without a partner, so ranking takes the format: 55 of 261 breedable Regulation M-B varieties gain the credit in doubles, 28 in singles. The browser passes the format the workbench is set to, so switching format re-orders it.

  **The term alone would have been half a fix.** Ability selection ranked on defensive merit, so **23 of 64 support Pokemon defaulted to an ability they are never brought for** — Torkoal chose White Smoke over Drought, Pelipper chose Keen Eye over Drizzle, Incineroar chose Blaze over Intimidate. A support ability now takes precedence over a purely defensive one, behind a stat ability. That ordering is deliberate and the roster bears it out: Intimidate over Flash Fire on Arcanine, Drought over Flash Fire on Ninetales, Drizzle over Water Absorb on Politoed. Every ability is still offered; only the default changed.

- **The stat floors are an either/or, and the defaults are recalibrated.** `minimumAttacks` and `minimumDefenses` were applied together, so a Pokemon had to clear both — which asked it to be unremarkable at nothing rather than good at something. That excluded Toxapex for its 63 Attack and Excadrill for its 62 bulk: two Pokemon that are strong *because* they specialise. A Pokemon is now kept when it reaches **either** floor. The total remains a separate requirement.

  Defaults move from `480 / 80 / 80` to **`440 / 80 / 80`**. The two stat numbers are unchanged; what changed is that they no longer have to be satisfied simultaneously. The total drops because the old figure cut Pelipper (440) and Torkoal (470) — weather setters are low-total by design, which is what makes them affordable — along with Azumarill and Medicham at 470.

  Measured against Regulation M-B: the old defaults kept 126 of 266 breedable, non-Mega legal varieties; the new ones keep 231. Grimmsnarl, Sneasler, Talonflame, Farigiraf, Basculegion, Whimsicott, Skarmory, Forretress and Klefki all return. These floors exist to skip Pokemon that cannot hold a slot, not to rank the ones that can — scoring does the ranking — and the regulation filter now does the bulk pruning they were originally sized for. Loosening them costs no extra requests, because the detail prefetch runs ahead of every filter.

  `DEFAULT_STATS_FILTERS` is exported, and `getResistantTypes` now derives its defaults from it. Previously an omitted `statsFilters` produced `500 / 90 / 80` from one default while a partial object was merged against a different `480 / 80 / 80` — two disagreeing sources for the same setting.

### Fixed

- **Battle-only forms no longer appear as their own Pokemon.** Gigantamax, Mimikyu-Busted, Eiscue-Noice and the like are states a Pokemon enters mid-battle, so listing them beside their base form invented team slots. Detected via `is_battle_only` on PokeAPI's form resource rather than by name suffix. Megas are battle-only by the same flag but remain a real pre-battle choice, so `allowMegas` still governs them — via `is_mega` now, replacing the `-mega` substring check. Where dropping a form would have understated the Pokemon, the battle-form rating above covers it.
- **Cosmetic varieties no longer appear as separate Pokemon.** PokeAPI models a lot of appearance-only variation as its own variety: Pikachu carries fifteen between the cosplay outfits and the travelling caps, and every Totem Pokemon duplicates its base form's stat line exactly. All of them were arriving in the browser as their own entry. `collapseIndistinctVarieties` keeps one when two varieties of a species match in everything this tool models — stats, typing and abilities — preferring the species' default. The rule is safe by construction: whatever it drops was indistinguishable from what stays.

  Varieties that genuinely differ are untouched. Basculegion keeps both forms (112 Attack against 92, 80 Special Attack against 100 — a physical attacker and a special one), and Meowstic keeps both of its despite an identical stat line, because Prankster and Competitive are not the same Pokemon to build around.

  Deliberately not keyed on move coverage: it is looked up by variety name, so the cosmetic variants have none, and including it would make them look distinct and defeat the rule. The survivor preference guards that instead.
- **Form controls look the same everywhere.** `.gba-label` / `.gba-select` / `.gba-input` were defined in `App.vue`'s scoped style block, so the Team Workbench's Format select rendered unstyled. They now live in `assets/scss/main.scss`.

The scan cache key moved to `v12`, so stored results containing battle-only forms — or rating Palafin as its registered form — are discarded rather than served.

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
