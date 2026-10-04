# Browser Ranking Audit

Measured 2026-08-19 against the committed catalog, Regulation M-B, doubles.

## Scope

This audit started from one question: when the model measures a Normal type's
weakness to Fighting, is it counting the Fighting-types in the format or the
Pokemon in the format that can bring a strong Fighting move?

The answer turned out to be recorded already, so the audit became the thing that
question is usually a proxy for — whether the Browser's order is deciding on
what it claims to decide on, and where it is not.

## The measure is availability, and it is the right one

`typeThreat.ts` counts move availability, not typing prevalence, and the gap
between the two readings is wide enough that the choice is load-bearing rather
than a detail:

| type     | is the type | can click a >=60 BP move of it |
| -------- | ----------- | ------------------------------ |
| fighting | 10.1%       | 63.5% (132 of 208 species)     |
| normal   | 9.6%        | 99.5%                          |
| water    | 12.5%       | 28.9%                          |

Water is the most common typing in the regulation and one of its rarest
attacking types. A prevalence-based weight would price a Fighting weakness near
zero in a cup that excludes Fighting-types and be badly wrong, because half that
cup still clicks Close Combat. 111 of the 132 species that can bring a Fighting
move are not Fighting-types.

The implementation is a step past the binary question, and the step matters.
Availability is not counted as one per Pokemon that *can* learn the move — a
member's free moveslots (`4 - own types`) are allocated proportionally to how
much of the field each reachable type catches super-effectively that its STAB
does not already catch. Fighting's 63.5% availability therefore becomes a 36.1%
expected slot share, which sets the maximum weight of 1.000.

Normal is the case that shows the allocation is doing real work. It has 99.5%
availability and comes out at 0.266, weight rank 18 of 18, because nothing on
the chart is weak to Normal and a type that buys no coverage takes no slot. That
is the correct answer arrived at with no special case.

The offensive direction deliberately uses the opposite measure.
`defenderCensus.ts` counts typings, because what you attack is a Pokemon
standing in front of you rather than a movepool. Both directions being different
measures over the same pool is the design, not an inconsistency.

**Verdict: no change. The premise is sound and better argued than most of what
this repo has had to revisit.**

## What the ranking actually decides on

Run of `measure:ranking-terms`, default M-B browser view, 146 entries:

| term                | points | share | premise term |
| ------------------- | ------ | ----- | ------------ |
| effective bulk      | 14.03  | 26.7% | yes          |
| effective offense   | 9.64   | 18.4% |              |
| defensive typing    | 9.18   | 17.5% | yes          |
| speed               | 6.15   | 11.7% |              |
| STAB power          | 5.78   | 11.0% | yes          |
| offensive typing    | 3.82   | 7.3%  |              |
| reachable coverage  | 2.37   | 4.5%  |              |
| support role        | 1.50   | 2.9%  |              |

The entire availability-versus-prevalence question lives inside "defensive
typing" — 17.5% of the ordering, on an input occupying 46% of its normalized
range. That bounds what any further work on the threat measure can buy, and is
the main reason the two candidate refinements below are recorded rather than
acted on.

## The view filters are deliberate, and correctly scoped

This section replaces a wrong reading. The first pass of this audit measured
that the default Browser view omits 45.2% of the format's usage mass — including
Kingambit at 28.79% and Garchomp at 27.55%, the two most-played species in the
regulation — and read that as a defect.

It is not. The Browser lists Pokemon *you would register*. The premise is to
find bulky Pokemon with strong defensive typings that survive and answer the
Kingambits and Garchomps of the format without being them. Excluding a typing
with a quadruple weakness alongside other weaknesses is a statement about what
the user wants to raise, and usage mass is the wrong yardstick for it.

The property that makes this coherent is that **the exclusions never reach the
measurement**, and that was verified rather than assumed:

- `getThreatPool` filters on default-form, Champions Pokedex, regulation and cup
  only. Kingambit, Garchomp, Dragonite, Tyranitar and Hydreigon are all in the
  threat pool, so a candidate is still scored for surviving them.
- The offensive census is measured over that same pool. All five typings are in
  the 102-typing census, so a candidate is still scored for hitting them.
- Weights and bounds are keyed on `{regulation, cupTypes, baseScore}` and nothing
  else (`pokemonCatalogScan.ts:195`). No stat floor, breeding rule or type
  filter can move them.

`threatPool.ts` already states this as the rule — "the pool is the opponents,
not the candidates", and "a bound that moved when a stat floor slider moved
would make two scans incomparable." The audit confirms the code holds it.

The decomposition is kept because it is useful for sizing the filters, not
because any of it is a bug:

| view              | species shown | usage mass absent |
| ----------------- | ------------- | ----------------- |
| default           | 129           | 45.2%             |
| quad filter off   | 161           | 17.6%             |
| stat floors off   | 169           | 34.2%             |
| breedable-only off| 131           | 42.0%             |
| all off           | 208           | 0.0%              |

`limitQuadrupleDamage` is the largest single exclusion at 27.6 points of usage
mass, ahead of the stat floors at 11.0 and breeding at 3.2. It removes 51 of the
171 typings and 37 species from a default M-B scan, taking the entry count from
183 to 146.

## The one actionable finding: the quad filter is not offerable

`scoringValidation.test.ts:33-36` justifies keeping Garchomp, Dragonite and
Kingambit in the scoring fixture on the grounds that `maxDamageFromScore` and
`limitQuadrupleDamage` are "a lens the user chooses over a sound ranking, not
part of the ranking itself."

The reasoning is right and the premise is currently false. `limitQuadrupleDamage`
is hardcoded `true` at `App.vue:405`. There is no control in `MetaControls.vue`,
no field in `useWorkspaceState`, and it does not appear in the scan cache key —
so unlike the stat floors, which are sliders the user moves, this lens cannot be
chosen, saved, or shared in a workspace.

That is the gap worth closing, and it is a UI gap rather than a scoring one.
Exposing it as a checkbox beside the stat floors makes the test comment's
justification true. Three things travel with it:

1. A field on the workspace snapshot, so a saved workspace restores the same
   view.
2. The flag in the scan cache key at `App.vue:422`, since it changes the result
   set.
3. `maxDamageFromScore` is the sibling case and stays off by default, for the
   reason recorded in `resistantTypeScan.ts` — it cuts a dense continuous band
   at a point nothing distinguishes. The quad filter does not have that problem:
   its cut is on a discrete, structural property, which is why it survives the
   argument that retired the other one.

The default stays `true`. It is the team-construction preference the tool is
built around.

## Two refinements measured and not taken

Recorded because both sound like defects and are not, and the next person to
have either idea should not have to re-measure it.

### Weighting the threat pool by usage

Every legal species currently counts as one unit of threat. Real opponent fields
are not uniform, and `scripts/usage-reg-m-b.json` is already in the repo.

Weighting each pool member's contribution by its ladder usage, with the censored
tail handled three ways because only 93 of 208 species are listed:

| tail handling  | Spearman vs production weights |
| -------------- | ------------------------------ |
| drop unlisted  | 0.884                          |
| floor at 0.5%  | 0.907                          |
| floor at 1.0%  | 0.924                          |

The top three attacking types stay `{fighting, ground, dark}` in some order. The
movers are flying (12th to 6th), dragon (17th to 14th), and bug, psychic and
rock falling. So the effect is real and modest, inside a term worth 17.5% of the
ordering.

Not taken, for the reason `measure-usage-correlation.mjs` already gives about
this data: the tail is censored, so the three rows above disagree by more than
the effect is worth, and usage is popularity rather than strength. A weighting
derived from it would import that into the one term this tool is most opinionated
about.

An earlier crude pass on this replicated members by rounded usage percentage and
reported Fighting falling to 0.706 and fifth place. That was an artifact of
`max(1, round(usage))` inflating every small entry, not a result. The
proportional numbers above supersede it.

### Valuing reachable coverage by the metagame

`candidatePriority` charges `coverageBeyondStab(...).length` — a raw count. Every
other term in the model respects the cup; this one does not, so reaching Ice and
reaching Grass are worth the same in a Boulder Cup.

Re-scored with each reached type valued by `getTypeMatchupValues().presence`,
across three selections:

| selection                              | entries | Spearman vs production |
| -------------------------------------- | ------- | ---------------------- |
| full M-B                               | 146     | 1.000                  |
| Boulder Cup (rock/ground/steel/fighting)| 45      | 0.998                  |
| Twilight Cup (fairy/dark/poison/ghost) | 49      | 0.997                  |

Nothing moves, even in Twilight Cup where the presence values span 0.00 (normal,
flying) to 3.20 (ghost) — a swing of the whole range. The reach term is 4.5% of
the ordering, and modulating it by anything cannot escape that ceiling.

Not taken. It would be tidiness rather than correction, and it would add a
dependency on `typeValues` to a function that currently needs only the entry.

### Weighting the threat pool by attacking power

Also measured, also null. Scaling each member's contribution by `offenseStatTerm`
leaves the weight order unchanged except for steel/rock and ice/water swapping.
Blastoise and Pikachu counting as full Fighting-move users is cosmetically odd
and numerically irrelevant — the `getAttackerBias` damage-class split is already
doing the work that matters here, and it is live: the threat pool resolves as 94
physical, 68 special, 46 mixed, with stats present for all 208 members.

## Summary

| finding                                              | action        |
| ---------------------------------------------------- | ------------- |
| Availability over prevalence, with proportional slots | none, correct |
| View filters do not leak into threat measurement      | none, verified|
| `limitQuadrupleDamage` cannot be chosen by the user   | expose it     |
| Usage-weighted threat pool                            | not taken     |
| Metagame-valued reach term                            | not taken     |
| Power-weighted threat pool                            | not taken     |
