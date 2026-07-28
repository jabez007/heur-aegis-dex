# Changelog

## Unreleased

### Fixed

- **A generated roster no longer spends a slot on a type combination it already has.** Reported: seeding Goodra-Hisui and clicking Fill Roster added Archaludon, also Steel/Dragon.

  Reproduced under the app's default filters, which cut the pool to 86 Pokémon across 42 typings — Steel/Dragon holds exactly those two. Seeded with Goodra-Hisui, the best roster was `goodra-hisui, archaludon, dragapult, primarina, rotom-heat, overqwil` at **87.30**, and the best with six distinct typings was the same roster with Metagross instead, at **86.77**.

  **The redundancy was already scored, and roughly correctly.** Holding Archaludon's stats and ability fixed and moving only its typing, a second Steel/Dragon costs about **5 points** against most alternatives — two members with one typing contribute one set of resistances to `uniqueResistances` and one set of types to `typeDiversity`. The problem is that the charge competes with individual quality, and Archaludon's edge over Metagross covered all but **0.53** of it. Half a point out of 87 is inside the noise of every weight in this model, and it bought a roster answering the same threats twice and folding to Ground and Fighting on both.

  Fixed as a constraint rather than a weight. Raising the synergy penalty until 0.53 became decisive would mean recalibrating `COMPOSITE_BOUNDS` and every team score to settle a case a constraint states directly — and the scoring is not wrong when it says "slightly worse", it just should not be *suggesting* it. New `allowDuplicateTypings` option on `generateRosters`, defaulting to false.

  **The search runs twice when it has to.** A user can filter the browser down to a handful of typings, and returning no roster there would be worse advice than one that doubles up, so a first pass that cannot fill falls back to the unconstrained search. Typing identity is the sorted type pair, so Steel/Dragon and Dragon/Steel are one typing.

  Note this binds generation only. Adding both by hand still works and the workbench scores that roster honestly.

### Changed

- **The three stat terms inside member quality are now measured against the ranges they occupy.** New `OBSERVED_STAT_TERMS`. This reorders the Pokémon Browser grid. Cache key bumped to v17.

  The third and innermost instance of the defect `pokedexScoring.ts` records under `OBSERVED_DAMAGE_FROM`. `STAT_CEILINGS` fixed the *top* of each term — competitive ceilings rather than the theoretical 255 — and nobody looked at the bottom. Every term had a floor well above zero, and a different one each:

  | term | floor | ceiling | realized share | nominal |
  | --- | --- | --- | --- | --- |
  | offense | 0.320 | 0.992 | 0.317 | 0.35 |
  | bulk | 0.313 | 0.988 | 0.440 | 0.45 |
  | speed | 0.133 | 0.947 | 0.243 | 0.20 |

  **The floors are what matter.** An 85 Attack — unusable where the Pokémon worth bringing carry 130 — still collected **52% of the offence term**, because the term's implicit zero was a Pokémon with no attacking stat at all and nothing in the pool is close to that. **Steelix ranked 21st** on 340 bulk and an attacking stat that cannot KO. That is the third gate of this project's premise failing to bite, and it failed because a floor nobody set was doing the work.

  Three consequences, all pointing the same way:

  1. `MEMBER_WEIGHTS` becomes near-exact (0.33 / 0.46 / 0.21 against 0.35 / 0.45 / 0.20), so bulk leading is a fact rather than an intention.
  2. The third gate bites: Klefki 111 → 171, Skarmory 51 → 91, Tinkaton 33 → 80, Forretress 84 → 120 — all Pokémon that cannot threaten anything.
  3. Speed's influence drops from 0.243 to 0.21, **reducing** the documented Trick Room bias rather than amplifying it. Slow bulky Pokémon rise: Avalugg 116 → 61, Hatterene 119 → 90. That was the outcome checked before committing to this, since the opposite would have been a reason not to.

  Rising into the top 25: Tyranitar 13 → 5, Rhyperior 29 → 12, Goodra 43 → 19, Aggron 31 → 21, Basculegion 37 → 22. Falling: Talonflame 83 → 127, Ninetales 97 → 123, Dragapult 6 → 10. 200 of 208 move, median 10 places.

  **min/max rather than percentiles**, for the reason already argued under `COMPOSITE_BOUNDS`: the 99th percentile of offence is 0.841, which is *Dragonite*. Clamping there would flatten the top of the pool, the part anyone is choosing between. These bounds clamp nothing and land within 0.02 of nominal anyway.

  `COMPOSITE_BOUNDS` was re-measured, since it is measured on `scoreMemberQuality`'s output. The composite's realized split improves from 4.0:1 to 1.87:1 against a nominal 1.22:1.

- **BREAKING-ish: `CANDIDATE_WEIGHTS.supportRole` falls from 2 to 1.** The invariant it exists to hold — a support role never offsets a quadruple weakness — broke for frail Pokémon.

  Defensive typing modulates the *bulk* term, so once bulk is measured against its real range the quad-weakness charge scales with how much bulk there is to modulate: **1.02 points at 200 raw bulk, 2.37 at 300, 3.66 at 400.** There is no longer a single figure to sit under, and 2 cleared the charge for anything below roughly 270 bulk — the Pokémon where a 4× weakness is *least* survivable. Pinned at the weakest case instead.

  That the charge is smaller for frail Pokémon is a genuine quirk of routing it through the bulk term, not a deliberate claim. Recorded rather than fixed, because it is defensible — something that dies to a neutral hit does not need a 4× one — and because it is the reason the weight had to move.

- **A validation assertion was split, and the split is the finding.** `ranks defensive walls above bulky Pokemon with ordinary typing` paired Blastoise and Feraligatr as two examples of "merely bulky". Measuring the stat terms separated them:

  | | bulk | best attacking stat | priority |
  | --- | --- | --- | --- |
  | blastoise | 268 | 85 | 43.8 |
  | skarmory | 275 | 80 | 44.8 |
  | feraligatr | 268 | 105 | **45.2** |

  Blastoise and Skarmory sit either side of an offensive stat neither can use, and typing decides it — the original claim, intact and still asserted. Feraligatr carries 25 more Attack on the same bulk and now edges the walls, which is the third gate working. The new assertion bounds that gap on *both* sides: a defensive typing that good is worth nearly as much as 25 points of Attack, and if either side runs away from the other something is wrong.

- **Both halves of the team score are now normalized against their reachable ranges.** `COMPOSITE_WEIGHTS` said 45/55 and behaved as roughly **16/84**. New `COMPOSITE_BOUNDS`, measured by `npm run measure:composite-bounds`.

  Same defect `pokedexScoring.ts` records under `OBSERVED_DAMAGE_FROM`, in the same model, one file away. Member quality is a weighted mean of clamped terms averaged *again* across the team, so it bunches hard around 0.5; synergy is a bonus-minus-penalty difference that genuinely spans almost all of −1..1. Measured over 200,000 random brings from all 208 legal species of Regulation M-B, across the 1st-to-99th percentile band:

  | half | nominal weight | points of swing |
  | --- | --- | --- |
  | member quality | 0.45 | 5.9 |
  | team synergy | 0.55 | 31.0 |

  **5.2 to 1.** Half of all large member-quality gaps were overturned by synergy, making how good the Pokémon were close to a coin flip against how tidily they fitted together. The visible symptom: four Pokémon of Watchog/Audino/Emolga/Dedenne calibre scored **55.28** against **43.59** for Dragonite, Metagross, Garchomp and Tyranitar — and the roster generator was picking Emolga and Dedenne into its best rosters for exactly that reason. Synergy was right in *direction* (two shared 4× Ice weaknesses is a genuinely poor four); it simply outvoted a 0.19 quality gap that should have been decisive.

  **Quality's bounds are exact, synergy's are observed.** An average member quality has a closed form — the mean of the pool's highest individual qualities down to the mean of its lowest — so no team can fall outside it, and both ends are ordinary teams rather than arithmetic limits. Synergy has no such form, so its bounds are the sampled extremes and outliers clamp, as they do for `STAT_CEILINGS`.

  **Percentile bounds were rejected despite landing the ratio on nominal.** The top 0.1% of *random* teams is where the roster generator actually operates: generated brings reach synergy 0.678 against a 99.9th percentile of 0.641, so clamping there would blind the search at the point it does its work. These bounds clamp nothing.

  The residual is **1.79:1 in doubles, 1.71:1 in singles** against a nominal 1.22:1, recorded rather than tuned away — synergy's own −1 clamp compresses the bottom of its range and normalizing cannot undo that. Closing the rest means changing `scoreTeamSynergy`. This takes the error from 330% to 46%. A new fixture test samples the distribution and fails if either half stops deciding anything.

  No cache key moves: team scores are computed live, and only the scan output is cached.

- **The `overlapping threats` validation team did not contain what it claimed.** Its description said the members shared a quadruple weakness. They did not — Garchomp, Sneasler, Kingambit and Glimmora carry one *each*, to four different types, so `sharedQuadrupleWeakness`, the heaviest penalty in the model at 1.5, never fired on the team at all. Under the compressed scale synergy outvoted its member quality anyway and it scored below the defensive core, so the fixture agreed with its assertion for a reason nobody had checked.

  It is now six elite attackers stacked three deep on that penalty — Dragonite and Garchomp both 4× to Ice, Kingambit and Tyranitar both to Fighting, Volcarona and Charizard both to Rock — which is the case the description always described. The old lineup is kept as `strongAttackers`, deliberately **unclassified**: whether six strong attackers with unshared weaknesses should beat six walls that cannot KO anything is a genuine judgement, so it is asserted only against the teams that are plainly bad.

- **Corrected a stale comment in the scoring fixture header**, which claimed abilities were pinned in the generator. They have been derived by the scan's own rule since the ability-selection fix.

- **Took a position: bulky attackers rank above walls that cannot threaten anything.** `strongAttackers` is now classified rather than left open, and asserted above `defensiveCore`.

  Judged against this project's premise — defensive typing, then decent bulk within it, then a real attacking stat out of what survives — the two teams split gate by gate:

  | gate | defensive core | strong attackers |
  | --- | --- | --- |
  | defensive typing | **17 unique resistances** | 16 |
  | decent bulk | 0.651 | 0.649 |
  | attacking stat | 0.543 | **0.747** |

  **Gate 2 decides it, and it is the one that surprises.** The usual case against a team of attackers is that it trades a turn for a KO and then dies, leaving the match to a speed race. That is not this lineup: Garchomp is 108/95/85, Annihilape 110/80/90, Kingambit 100/120/85. Only Lucario and Sneasler are frail. They are *bulky* attackers, so the objection does not apply and the walls' remaining edge is worth about one resistance.

  Gate 3 the walls fail outright — best attacking stats of 80, 90, 80, 95, 100 and 77, not one above 100, against four at 130 or better. A team that cannot KO does not win; it stalls until the clock or chip damage decides.

  The margin stays narrow (69.8 to 67.1) and the assertion deliberately does not demand otherwise: both teams fail the pipeline, in opposite directions. A second test carries the real claim — `balance`, which passes all three gates, must beat *both* by more than 5 points.

- **`MEMBER_WEIGHTS` was checked against the ranges its terms occupy, and holds up.** The same audit that found the composite weights behaving as 16/84 was run one level down, over all 208 legal species:

  | term | span | weight | realized swing | share |
  | --- | --- | --- | --- | --- |
  | offense | 0.502 | 0.35 | 0.176 | 0.34 |
  | bulk | 0.475 | 0.45 | 0.214 | **0.41** |
  | speed | 0.673 | 0.20 | 0.135 | 0.26 |

  Bulk really is the largest term, which is what the premise asks for — `STAT_CEILINGS` having been set to competitive rather than theoretical maxima is why, and this is the evidence it worked. Speed drifts to 0.26 against a nominal 0.20 because base Speed spreads wider across the pool; left alone deliberately, since correcting a 6-point overshoot on a term already known to be modelled wrong for Trick Room would be tuning the symptom.

  A first pass at this, measured on the 51-Pokémon fixture rather than the legal pool, suggested bulk was the *most* compressed term and wrongly implied the weights were inverted. The fixture is selected for scoring edge cases, not representative of the pool. Recorded because the wrong conclusion was reachable from data already in the repo.

- **BREAKING: roster depth counts *different* teams, not the top three bring options.** `ROSTER_DEPTH_OPTIONS` is removed, replaced by `selectDistinctLines`, `countTargetLines`, `maxSharedMembers` and `VIABLE_LINE_MARGIN`. `RosterEvaluation` gains `lines`, `viableLines` and `targetLines`.

  Depth was the mean of the three highest-scoring bring options. From six Pokemon bringing four there are fifteen options, and the top three are always **the same team with one Pokemon swapped** — they overlap the best bring in three of four members. The term averaged the peak three times and was reported as depth.

  Measured on the validation fixture: Dragonite / Metagross / Incineroar / Milotic / **Skarmory / Whimsicott** scored 64.62, and the same four with **Watchog / Audino** in the back scored 64.52. Two slots of outright junk cost **a tenth of a point**, because the junk never had to appear in more than one of the three counted options.

  A real alternative is not a substitution. Two brings now count as different teams only when they **differ by at least two members**, which forces every line beyond the first to actually field the back half of the roster. The same pair of rosters now separates by 0.93 — and on a fixture roster of six strong but overlapping threats, whose forced third line scores 27.5 against a 57.1 peak, the roster drops from 56.55 to 52.60.

  **Greedy, not a best-portfolio search.** Optimising the lines' total could return a set whose peak is below the roster's actual best bring, contradicting `ROSTER_WEIGHTS.best`: you play your strongest line whenever the matchup allows, and the rest are what you fall back on. Greedy keeps line one identical to `best` by construction.

  **The target comes from the format, not the roster.** Measured against its own size, a roster of five would have a target of 1 — from five, every pair of bring-fours shares three members — so it would earn full depth credit for a single line while a roster of six almost never can, and registering a sixth Pokemon could only lower the score. A test pins that a sixth member always helps.

- **`optionCount` is no longer shown in the workbench.** It is `C(6,4)` — always 15 for a full doubles roster, 20 for singles — so "over 15 options" was a constant presented as a measurement.

  The replacement needed a threshold to say anything. **`lines.length` is also structurally constant**: from any six Pokemon there are always three bring-fours that pairwise share only two members, whatever those Pokemon are. Reporting it would have repeated the same mistake. The workbench now shows `viableLines/targetLines` — lines within `VIABLE_LINE_MARGIN` (5 points) of the best bring — which runs 1–3 across generated rosters and collapses to a constant 3 by a margin of 12.

  **The margin is a readout, not a term in the score.** Depth already sums the lines' actual scores, so a weak alternative is discounted smoothly and in proportion; thresholding on top would charge the same shortfall twice, and would hand six weak-but-tidy Pokemon full marks for breadth. Keeping the count out of the score is what stops it being gameable.

- **BREAKING: `CANDIDATE_WEIGHTS.coverage` is removed.** It paid a second time for a count the offensive score already contains. `coverages` is exactly `damage_relations.double_damage_to`, and `calculateDamageToScore` is `baseScore + double_damage_to.length - …`. The same list fed both paths: **0.89 points** per super-effective type through the score into the offence term, and **0.75** again on its own line. STAB breadth was charged at **1.84×**.

  Its docstring claimed the offensive score "measures strength rather than spread". It counts the length of a list of types, which is spread. The justification had been wrong for as long as the weight existed — the same way `supportRole` claimed to be worth "about three resistances" while buying nine.

  This is the offensive mirror of the defect the earlier rework removed. That one found defensive typing paid three times — once as its own term and twice more as the resistance and weakness lists `normalizedDamageFromScore` already summarises. Nobody checked whether the offensive side had the same shape. It did.

  **Removed rather than shrunk, because the duplicate was also the worse-behaved of the two.** The explicit term was *stat-independent*: it paid Klefki for hitting seven types super-effectively off an 80 Special Attack at the same rate it paid Kingambit. Routing the charge through the offence term scales it by `effectiveOffense` — the whole argument behind the damage-class split and behind `effectiveOffense` itself. Coverage a Pokemon cannot back with an attacking stat describes a threat that does not exist. `moveCoverage` stays: it comes from the Champions movepool rather than the type chart, duplicates nothing, and is already read against stats.

  **This partly reverses the Azumarill result from the previous entry**, and that is the correct outcome rather than a regression. Azumarill went 34th to 26th on the offence fix, and back to 33rd once STAB was priced once instead of 1.84 times. Water/Fairy's six super-effective types are still paid — through the offence term, where they are scaled by the 100 Attack Huge Power builds — but at that price they no longer overcome Blastoise's Speed and bulk. The ordering had been resting on an arithmetic error rather than on anything the model believed, and the test now records that explicitly.

  Azumarill against **Klefki** is the assertion kept, and it is the sharper case: the two hit the *same number* of types super-effectively, so the old stat-independent term paid them identically for a 100 Attack and an 80/80. Rank correlation with the previous ordering is 0.975, so this reorders rather than upends.

- **The adjunct budget guard now measures its own maxima.** `rosterGeneration.ts` states the adjuncts should swing about a third of the observed quality spread. Measured on the roster the browser actually shows, they could swing 12.4 against a spread of 25.3 — 49%. The guard did not catch it because it hardcoded "a few of each", 4 coverage types and 6 move types, where the real maxima are 7 and 18. It now derives them from the fixture, which is the discipline the spread in the same assertion already used.

- **Offence is measured on the stat a Pokemon actually attacks with.** `scoreMemberQuality` computed offence as `attack + special-attack`, which assumes both halves are usable. Azumarill swings the 100 Attack Huge Power built for it and never touches its 60 Special Attack; Blastoise has 83/85, neither notable. Summed, that is 160 against 168 — **Blastoise scored higher on offence**, describing a Pokemon that does not exist.

  `coverageMoves.ts` had already rejected this reasoning one layer up. Its `getAttackerBias` reads Azumarill's movepool as physical, on the argument that crediting Pelipper with physical coverage it cannot use at 50 Attack is dishonest. That argument stopped at the coverage layer and never reached the term scoring the stats themselves.

  There was a second half: the 300 ceiling on the sum is only approachable by a mixed attacker — the highest sum anywhere in the fixture is 234 — so a one-sided attacker was capped near its own total however elite its real attacking stat, because half the numerator was a stat it never used.

  `effectiveOffense` now takes the primary attacking stat plus the weaker one discounted to `SECONDARY_OFFENSE_WEIGHT` (0.3), against a rescaled ceiling of 195. The weaker side is the angle a Pokemon has left when something walls its primary — real, but not a second attacker.

  **Deliberately smooth rather than a classification.** Reusing `getAttackerBias` would put a cliff at `MIXED_ATTACKER_RATIO`, where two Pokemon a single point apart score very differently. A category is right for "which moves would this Pokemon run", where the answer is genuinely discrete; it is wrong for a magnitude.

  The ceiling is chosen so mixed attackers land where they already did — Lucario 0.750 → 0.759, Simisear 0.653 → 0.653 — and only one-sided attackers move. This stops under-rating them; it does not re-scale everything.

  **Who moves.** Up: Staraptor +9, Azumarill +8, Sneasler +7, Volcarona +6, Kingambit +5, Milotic +5 — every one a one-sided attacker. Down: Lucario −8, Klefki −7, Blastoise −6, Ninetales −5 — every one balanced-stat. `rosterGeneration.ts` already recorded "Klefki's unusable 80/80 offences counted the same as Lucario's 110/115" as a defect it had fixed, but it only fixed the stat-blind half; the offence term went on crediting 80/80 as a threat until now.

  Incineroar now ranks above Lucario, a deliberate reversal recorded in the test rather than dropped. They share a primary attacking stat of 115; Lucario's entire edge was a 110 secondary against 80, worth 9 points once discounted, while Incineroar carries 65 more bulk on a term weighted 0.45 against offence's 0.35.

  **What this does not fix, recorded as its own assertion.** Azumarill still has the *lowest* member quality of its comparison group — 260 bulk and 50 Speed are genuinely worse than Blastoise's 284 and 78, and the model is right about that. It outranks them on coverage breadth, not on quality. What actually makes Azumarill good is Belly Drum and Aqua Jet, a setup move and a priority move that between them answer the low Speed the model penalises, and neither is visible to a scan that sees no moves beyond coverage types. `scoringValidation.test.ts` asserts the limitation explicitly so no future weight is tuned to compensate for a missing move model — the same trap as the documented Trick Room bias.

  Cache key bumped to v16: `chooseDefaultAbility` ranks on `scoreMemberQuality`, so a cached scan can hold an ability chosen under the old term.

- **Typing scores are normalized against the range real Pokemon occupy, not the formula's extremes.** This was the model's largest calibration error, and the argument against it was already written down in the same file that made it. `STAT_CEILINGS` explains that normalizing against a theoretical maximum "would compress every realistic Pokemon into a narrow band and cost the model most of its discrimination" — the stats got competitive ceilings on that reasoning, and the typing scores never did.

  `damageFromScoreBounds` ran 0 to `4 * baseScore`: the hypothetical typing that takes quadruple damage from all eighteen types. Measured across all 171 combinations the scan produces, real typings occupied **17.7%** of that range, and `TYPE_MODULATION` then halved what survived.

  **What that cost, in final ranking points:** the best defensive typing in the game beat the worst by **2.7 points**. Against 12.7 for the bulk spread between Staraptor and Toxapex, 12.1 for Speed, and 10.6 for offence. A tool built to rank defensive typings had made typing its smallest term — smaller than half of one 4× weakness penalty.

  The bounds are now measured: every type combination crossed with each of the eleven abilities granting a type immunity, plus the no-ability case. That is a superset of any roster, which is the property a bound needs. Including abilities matters — it moves the defensive minimum from 13.25 to 11.25 (Steel/Fairy with Earth Eater), and pinning to the bare-typing figure would have saturated the top of the range to zero, losing exactly the discrimination this recovers. The defensive signal now spans **86%** of its range.

- **`TYPE_MODULATION` 0.5 → 0.4.** Not because 0.5 was too strong, but because it was never in effect. With the widened signal, 0.5 would swing 13.4 points and make typing the single largest term — overshooting in the opposite direction. 0.4 puts defensive typing at 10.7 points, a peer of the stat terms rather than a rounding error or a dominator.

- **BREAKING: `CANDIDATE_WEIGHTS.quadrupleWeakness` is removed**, and `supportRole` falls 4 → 2. Both were sized to compensate for the compression, so leaving them would have converted an under-count into a double count — the exact failure the previous rework of that file was written to remove, reintroduced from the other side.

  The quadruple penalty turned out not to need resizing but deleting: it was the **third** charge for one property. A 4× weakness is paid for by `calculateDamageFromScore`, again by that flat penalty, and again by team scoring through `quadrupleWeakness`, `uncoveredQuadrupleWeakness` and `sharedQuadrupleWeakness`. Same shape as the defect the previous rework removed, where defensive typing was counted three times; it had simply gone unnoticed on a different property.

  It was also the worst-placed of the three. Whether a 4× weakness matters is a question about the *team* — is it covered, is it shared — which team scoring can ask and a solo ranking cannot. And it was the most expensive place to be wrong: this ranking prunes to `DEFAULT_CANDIDATE_LIMIT`, so a Pokemon dropped here is never seen by the scorer that could have judged the risk properly.

  The symptom was Scizor — nine resistances, one immunity, one weakness — ranking below Blastoise, Feraligatr and Klefki despite beating all three on member quality. Its entire deficit was this penalty. Removing it does not make the model blind to 4× weaknesses: Dragonite and Garchomp still carry a materially worse defensive score than Skarmory for exactly that reason.

  `supportRole` was the other half, found by checking the weight's own stated unit. Its comment claimed "about three resistances" — but that unit came from a formula where resistances were explicit terms, and the rework onto `scoreMemberQuality` folded them into the defensive score without restating it. A resistance is now worth 0.42 points, so 4 was buying **9.5** of them. The comment had been wrong for two reworks.

  **The reported symptoms, all fixed.** Skarmory and Corviknight (ten resistances, two immunities) now rank above Blastoise and Feraligatr (four resistances, comparable bulk, more offence), which previously led them because twelve-versus-four was worth a 3.6% multiplier on one term. Swampert and Scizor now rank above Staraptor, which previously led both despite the lowest member quality of the three. Scizor rises from twelfth to eighth, above Klefki, Blastoise and Feraligatr.

  All three orderings are now ordinal assertions in `scoringValidation.test.ts`, and each was verified to fail against the calibration it replaces rather than assumed to. The Scizor assertion deliberately pins member quality *and* final rank together: if a later change reintroduces a flat penalty, rank alone could be restored by inflating something else, and requiring the two orderings to agree is what makes it a claim about the model rather than about one number.

- **The scoring fixture can see the normalization it was generated under.** A structural gap found while verifying the above: the fixture stores *normalized* scores, so it bakes in the output of the stage most likely to be miscalibrated. Reverting the bounds to the old formula extremes left all fifteen ordinal assertions green, because they were comparing values frozen under the new bounds against each other.

  The generator now emits `SCORING_FIXTURE_RAW_SCORES` alongside, and an integrity test re-normalizes them against the live bounds. Changing the bounds without regenerating now fails loudly instead of quietly validating a scale no longer in use.

  Cache key bumped to v15: scan results store normalized scores, so cached scans are on the old scale.

### Fixed

- **Breedability is asked at the variety level, not only the species level.** The scan's breedable-only rule read `/pokemon-species` — egg groups plus the legendary and mythical flags — which is the right place for almost every Pokemon. It is the wrong place for Floette-Eternal, a variety of a perfectly ordinary Fairy-egg-group species that has never been obtainable in any released game. Nothing upstream rejected it either: the form is neither battle-only nor Mega, the regulation filter is species-keyed and `floette` is on the M-B roster, and its 551 base stat total clears the floors easily.

  **The symptom was worse than a spurious extra entry.** Base Floette is 371 BST and fails the 440 total floor, so the browser showed exactly one Floette — the one nobody can have.

  `src/lib/unbreedableForms.ts` records these by variety name in the `battleForms.ts` idiom: each entry carries its reasoning, and the varieties considered and *kept* are recorded alongside the excluded ones, because a bare absence cannot be told apart from an oversight. Two are excluded. Floette-Eternal, and Greninja-Battle-Bond — distribution-only, and the ability does not pass to offspring, so a player can receive one but never produce one. It survives variety collapsing because its lone ability differs from the registered Greninja's pair. Basculegion-F, Meowstic-F and Lycanroc-Dusk are recorded as deliberately kept.

  PokeAPI models no variety-level breedability, so this has to be recorded data rather than derived. The one available proxy — "has no moves in the `champions` version group" — was already considered and rejected when varieties were collapsed, because it conflates a form that does not exist with a form PokeAPI has not filled in yet.

  **The audit behind it:** all 208 M-B legal species were walked, yielding 34 non-default varieties that survive every filter, 30 of them distinct enough to survive collapsing. The other 28 are ordinary — regional forms, the five Rotom appliances, Gourgeist sizes, gender forms — and stay. The four Totem forms were already correctly collapsed.

  **A whitelist of exclusions goes stale quietly**, which is the weakness of this fix: a future regulation adding a species with an event-only form brings it into the browser with nothing to announce it, exactly as Floette-Eternal arrived. Two assertions convert that silence into a failing build rather than leaving it to be remembered. `VERIFIED_ON` must be no earlier than any regulation's own `verifiedOn`, and `VERIFIED_SPECIES_COUNT` must match the species the regulations actually cover.

  They are separate because they fail on different mistakes and either alone leaves a way through: the count catches species added without anyone touching dates, which is the common case; the date catches a roster re-verified against a PokeAPI that may have gained varieties for species already on it, which the count cannot see. Both failure messages name the drift and say what to re-walk, so the alarm is actionable rather than a number to bump — and both were verified by simulating the change they exist to catch.

  Removed with it: the hardcoded `paradoxPokemon` array that sat inside the breedable check. All 21 of its entries — the Paradox Pokemon, the box legendaries, Gholdengo — are reported by PokeAPI as `no-eggs` and were already caught by the egg-group check one line above. It was redundant on every entry, which is presumably why nobody noticed it was also the wrong level to catch Floette-Eternal.

  Cache key bumped to v14. The dead `floette-eternal` row is dropped from `coverageMoveData.ts`, and the generator now excludes unbreedable varieties so the table cannot drift back. `floette-mega` stays — Floette is on the M-B Mega-capable list, so that entry is real.

### Added

- **Unconditional stat abilities are applied.** `src/lib/statAbilities.ts` applies Huge Power, Pure Power, Fur Coat, Ice Scales and Hustle — the abilities that change a stat with no setup at all. The other twelve carried by a Regulation M-B legal species (Chlorophyll, Swift Swim, Guts, Solar Power, Plus/Minus and the rest) are recorded with the condition that rules them out, so their absence reads as a decision rather than an oversight. Each ability profile carries its own stat line, so switching ability moves the numbers and the coverage list, not just the resistances. Cards disclose which ability changed the stats and by how much.

  **Ability selection changed with it.** The default ability was previously chosen on defensive merit alone, which handed Azumarill Sap Sipper over the ability that doubles its Attack. A stat ability now wins the default.

  **The stat floors see the ability**, so Azumarill is measured at the 100 Attack it swings with rather than the 50 it is printed with, and Furfrou at the 120 Defense Fur Coat gives it. Together with the recalibrated floors below, that brings Azumarill, Medicham, Diggersby and Furfrou back into a default scan.

  Caveat recorded in the table: Hustle's ×1.5 Attack comes with an 80% physical accuracy penalty that a stat line cannot express, so Hustle Pokemon read slightly stronger here than they play.

- **Move coverage is split by damage class and read against the attacker's stats.** The generator already fetched each move's physical/special class and used it only to drop status moves; the emitted table flattened the two together. That credited Pelipper with Dark, Steel, Bug, Grass and Poison coverage it can never use at 50 Attack against 95 Special Attack. Measured across the Regulation M-B roster, 16% of the coverage types credited to a clearly one-sided attacker were reachable only through the wrong stat, and the tail was far worse than the average — Sceptile went from 12 usable move types to 5.

  `COVERAGE_MOVE_TYPES` entries are now `{ physical, special }`, and `getCoverageMoveTypes` / `getMoveCoverage` take optional stats. Pokemon whose attacking stats sit within `MIXED_ATTACKER_RATIO` (15%) keep both classes, because they genuinely run either; omitting stats also returns both, which is the honest answer for an unknown bias and matches the previous behaviour. Moves that pick their class at use time, like Shell Side Arm, count for both.

  Net effect on the roster: mean usable move types per Pokemon falls from 9.83 to 8.56, with 158 of 318 entries unchanged. This matters most where move coverage answers "does the team have a response to this weakness" — an overstated entry could mark a weakness as covered when nothing on the team could actually hit it.

- **Pokemon that register as one form and fight as another are rated on the form they fight in.** `src/lib/battleForms.ts` records which battle-only forms qualify, and just as importantly which do not — each entry carries its reasoning, so a species missing from the table can be told apart from one that was considered and rejected. A form is merged only when its trigger is an ability the registered Pokemon actually has, the typing is unchanged, and the Pokemon spends the battle in it. Today that is Palafin alone: Zero to Hero converts on the first switch-out and never reverts, a 193-point swing that took Palafin from below the default stat floor to a 650 base stat total. Aegislash, Castform, Greninja, Mimikyu and Morpeko are recorded as deliberately not merged. Affected cards disclose the form the numbers came from.

### Added

- **An ability-effect layer for abilities that change what a stat line is worth.** Three ability layers already existed — type immunities in `pokedexAbilities`, support roles in `abilityRoles`, stat multipliers in `statAbilities` — and between them they missed Unaware, Multiscale, Sturdy, Thick Fat and Adaptability entirely. `src/lib/abilityEffects.ts` scales the half of member quality an ability actually affects: bulk for durability abilities, offence for Adaptability. Applied to ten abilities; nine more are recorded with the condition that rules them out.

  Move-dependent abilities are the largest excluded group, deliberately. Prankster is among the strongest abilities in the format, but its value is entirely in *which* moves it makes priority — and moves are not modelled here beyond coverage types, so crediting it would be scoring a moveset the tool cannot see.

  The visible symptom was Skeledirge ranking below Typhlosion-Hisui. They share Fire/Ghost typing exactly, so the comparison came down to raw stats, where Typhlosion-H legitimately wins — and everything that makes Skeledirge the better Pokemon was worth zero.

- **A validation fixture for the scoring weights.** Every other test checks that a formula computes what it claims to; none checked whether the formula was *right*, and every weight in `MEMBER_WEIGHTS`, `CANDIDATE_WEIGHTS`, `MIXED_ATTACKER_RATIO` and the synergy sets was argued from structure rather than measured. `src/lib/scoringValidation.test.ts` is the counterweight: six real teams — balance, sun, a defensive core, mono-Fire, junk, and frail attackers — scored against each other, plus member-ranking comparisons over 41 real Pokemon.

  Assertions are **ordinal**, never absolute. A team judged stronger must outscore one judged weaker; no assertion names a number, because thresholds fail on every weight change regardless of whether it was an improvement and train people to update expected values without reading them. Each team carries its reasoning inline, so a failure is a disagreement to adjudicate rather than a number to bump.

  The fixture data is generated by driving the project's own pipeline — real type chart, real ability modifiers, real coverage table — via `npm run gen:scoring-fixture`. Hand-written approximations could agree with the scoring for the wrong reasons. Each Pokemon's ability is pinned in the generator rather than derived, so the fixture cannot drift when the selection rule changes.

  **It found a real defect on its first run.** `supportRole: 12` and `quadrupleWeakness: 15` were carried over from the previous formula, whose terms ran to 44. The rework compressed the base to a roughly 30-point spread, so those adjuncts could swing 27 points against it — enough to rank Arbok above Garchomp. Rescaled to 4 and 5, with `coverage` to 0.75 and `moveCoverage` to 0.2. A structural assertion now pins the invariant: the largest single-Pokemon adjustment must stay under half the observed spread of member quality, measured from the fixture rather than assumed.

### Changed

- **`MEMBER_WEIGHTS` shifts toward bulk**, from `0.4 / 0.4 / 0.2` to **`0.35 / 0.45 / 0.2`**. A Pokemon has to threaten something to win, but it only threatens anything on turns it is still alive. This also returns the scoring to the premise the project started from — it began as a theorycrafter for *defensive* typings, and weighting bulk over offence keeps it pointed at that question.

  Speed is unchanged and is now documented as the weakest part of the model: it is treated as linearly good, which is wrong for a format where Trick Room makes low Speed an asset. Correcting that needs move data the scan does not have, so the bias is recorded rather than papered over.

  Measured on Skeledirge against Typhlosion-Hisui, the reweight is the smaller of the two effects — it moves the gap from -2.1 to -1.4, and the ability layer carries it the rest of the way to +3.6.

- **Candidate ranking is built on `scoreMemberQuality` instead of its own weighted sum.** `candidatePriority` added typing and stats as independent terms and paid for defensive typing three separate times — as `defensiveTyping`, again per resistance, and again per weakness. But `normalizedDamageFromScore` *is* a summary of resistances and weaknesses, since `calculateDamageFromScore` sums exactly those buckets, so all three measured one property. Comparing Klefki, Lucario and Incineroar, that came to a 27-point spread on typing against 4 points on stats — a ratio near seven to one that nobody had chosen.

  `statsTotal` was the other half: being stat-blind, it counted Klefki's unusable 80/80 offences the same as Lucario's 110/115. Between them, a Pokemon with the best defensive typing in the game outranked two that beat it comfortably in practice (Klefki 135.8, Lucario 135.0, Incineroar 117.3).

  Ranking now calls `scoreMemberQuality` — already documented, already what the team scorer uses — so a candidate is judged by the same question the team scorer will ask later rather than a parallel approximation. Typing *modulates* stats there rather than sitting beside them, so elite typing multiplies bulk a Pokemon has without inventing offence it lacks. The order becomes Lucario 75.2, Incineroar 71.2, Klefki 63.8. Typing stays central, which is what this tool is for; it just stops being counted three times.

  Remaining terms cover only what member quality cannot see: support roles, STAB breadth (2), reachable coverage (0.5), and quadruple weaknesses. That last penalty halves from 30 to 15 — the defensive score already adds 3 per quadruple weakness, so the extra charge is now deliberate reinforcement of a discrete build risk rather than an unnoticed double count.

  This changes every generated roster, since pre-pruning to `DEFAULT_CANDIDATE_LIMIT` runs on this function. Like `MEMBER_WEIGHTS` and `MIXED_ATTACKER_RATIO`, the weights are argued from structure, not validated against match outcomes.

- **Candidate ranking credits support roles, and ability selection stops hiding them.** `candidatePriority` — which orders the Pokemon Browser and, more consequentially, picks the `DEFAULT_CANDIDATE_LIMIT` Pokemon the roster search ever looks at — scored only typing and stats. It was blind to Intimidate, Drizzle, redirection and ally protection, so a support Pokemon could be pruned before team synergy, which *does* weigh roles, had any chance to see it. A role is now worth `CANDIDATE_WEIGHTS.supportRole` (12), about three resistances and well under a quadruple weakness. Reasoned, not validated.

  Redirection and ally protection are worth nothing without a partner, so ranking takes the format: 55 of 261 breedable Regulation M-B varieties gain the credit in doubles, 28 in singles. The browser passes the format the workbench is set to, so switching format re-orders it.

  **The term alone would have been half a fix.** Ability selection ranked on defensive merit, so **23 of 64 support Pokemon defaulted to an ability they are never brought for** — Torkoal chose White Smoke over Drought, Pelipper chose Keen Eye over Drizzle, Incineroar chose Blaze over Intimidate. A support ability now takes precedence over a purely defensive one, behind a stat ability. That ordering is deliberate and the roster bears it out: Intimidate over Flash Fire on Arcanine, Drought over Flash Fire on Ninetales, Drizzle over Water Absorb on Politoed. Every ability is still offered; only the default changed.

- **The stat floors are an either/or, and the defaults are recalibrated.** `minimumAttacks` and `minimumDefenses` were applied together, so a Pokemon had to clear both — which asked it to be unremarkable at nothing rather than good at something. That excluded Toxapex for its 63 Attack and Excadrill for its 62 bulk: two Pokemon that are strong *because* they specialise. A Pokemon is now kept when it reaches **either** floor. The total remains a separate requirement.

  Defaults move from `480 / 80 / 80` to **`440 / 80 / 80`**. The two stat numbers are unchanged; what changed is that they no longer have to be satisfied simultaneously. The total drops because the old figure cut Pelipper (440) and Torkoal (470) — weather setters are low-total by design, which is what makes them affordable — along with Azumarill and Medicham at 470.

  Measured against Regulation M-B: the old defaults kept 126 of 266 breedable, non-Mega legal varieties; the new ones keep 231. Grimmsnarl, Sneasler, Talonflame, Farigiraf, Basculegion, Whimsicott, Skarmory, Forretress and Klefki all return. These floors exist to skip Pokemon that cannot hold a slot, not to rank the ones that can — scoring does the ranking — and the regulation filter now does the bulk pruning they were originally sized for. Loosening them costs no extra requests, because the detail prefetch runs ahead of every filter.

  `DEFAULT_STATS_FILTERS` is exported, and `getResistantTypes` now derives its defaults from it. Previously an omitted `statsFilters` produced `500 / 90 / 80` from one default while a partial object was merged against a different `480 / 80 / 80` — two disagreeing sources for the same setting.

### Fixed

- **Ability selection reaches the abilities that matter.** The scan chose a default ability through a precedence chain — stat abilities, then support roles, then defensive merit, then the first slot — that had grown a clause per ability layer without the ordering between them ever being argued for. It still missed a whole category: Unaware, Multiscale, Magic Guard and Adaptability all sit in a second or third ability slot, so `abilityEffects.ts` shipped with the app never selecting one of them and the layer did nothing in the browser.

  The chain is replaced by one rule: the default is whichever ability makes the Pokemon best by the model's own reckoning. The old special cases fall out of it rather than being encoded — Huge Power beats Sap Sipper because doubling Attack moves quality further than one type immunity, Drought beats Flash Fire because a support role is worth more than upgrading a resistance to an immunity.

  The scoring fixture had pinned each Pokemon's ability explicitly, which made the layer look tested while the app selected something else. It now derives abilities the same way the scan does, so it tests what a user actually sees.

- **Weather and terrain setters are credited less when ranked alone.** Intimidate lands the moment its holder switches in; Drought changes the field, which is worth nothing until a teammate wants it changed. Ranking them equally put Ninetales above Hydreigon despite an 8.5-point quality gap. Team scoring credits setters properly through its own support-role synergy term, so the solo bonus is halved — enough to keep them in the candidate pool, not enough to rank them as though the payoff had happened. Ability *selection* is unaffected: Ninetales still defaults to Drought, because that remains the right ability for it to run.

- **Battle-only forms no longer appear as their own Pokemon.** Gigantamax, Mimikyu-Busted, Eiscue-Noice and the like are states a Pokemon enters mid-battle, so listing them beside their base form invented team slots. Detected via `is_battle_only` on PokeAPI's form resource rather than by name suffix. Megas are battle-only by the same flag but remain a real pre-battle choice, so `allowMegas` still governs them — via `is_mega` now, replacing the `-mega` substring check. Where dropping a form would have understated the Pokemon, the battle-form rating above covers it.
- **Cosmetic varieties no longer appear as separate Pokemon.** PokeAPI models a lot of appearance-only variation as its own variety: Pikachu carries fifteen between the cosplay outfits and the travelling caps, and every Totem Pokemon duplicates its base form's stat line exactly. All of them were arriving in the browser as their own entry. `collapseIndistinctVarieties` keeps one when two varieties of a species match in everything this tool models — stats, typing and abilities — preferring the species' default. The rule is safe by construction: whatever it drops was indistinguishable from what stays.

  Varieties that genuinely differ are untouched. Basculegion keeps both forms (112 Attack against 92, 80 Special Attack against 100 — a physical attacker and a special one), and Meowstic keeps both of its despite an identical stat line, because Prankster and Competitive are not the same Pokemon to build around.

  Deliberately not keyed on move coverage: it is looked up by variety name, so the cosmetic variants have none, and including it would make them look distinct and defeat the rule. The survivor preference guards that instead.
- **Form controls look the same everywhere.** `.gba-label` / `.gba-select` / `.gba-input` were defined in `App.vue`'s scoped style block, so the Team Workbench's Format select rendered unstyled. They now live in `assets/scss/main.scss`.

The scan cache key moved to `v13`, so stored results containing battle-only forms — or rating Palafin as its registered form — are discarded rather than served.

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
