# Stat Floors and Bulk Audit

## Scope

This audit followed the default scan changing to require both:

- Best Attack or Special Attack of at least 80.
- HP-adjusted effective bulk of at least 70.

Effective bulk is the mean of `sqrt(HP x Defense)` and
`sqrt(HP x Special Defense)`. The total-stat floor was removed.

## Default Pool

A live national Regulation M-B scan with Megas disabled and the default typing,
ability-immunity, and move-coverage settings produced:

- 49 eligible typing rows.
- 67 varieties.
- 64 species.

This is below the generator's 160-candidate pre-pruning limit, so candidate
pruning does not affect the default scan.

The conjunction is intentionally strict, but it removes support specialists
before role or team-synergy scoring can consider them. Whimsicott is a concrete
example: its best attacking stat is 77 and its effective bulk is about 69.3.
User testing should determine whether support-role exceptions are desirable;
ranking cannot recover a Pokemon that never enters the pool.

## Ability Eligibility

The old floor check applied every listed unconditional stat ability to one stat
line. Abilities are alternatives, so a hypothetical Huge Power/Fur Coat Pokemon
could clear Attack with one and Bulk with the other despite no legal profile
clearing both.

Eligibility now evaluates each ability profile independently. A variety enters
the pool when one profile clears both floors. Admission applies to the variety,
not every profile; the browser still allows profiles that fail either floor.
No Regulation M-B species currently combines two modeled unconditional stat
abilities, so this is a correctness guard rather than a default-pool change.

## Ranking Comparison

The old member-quality bulk term used `HP + Defense + Special Defense`. On the
67-variety default doubles pool, comparing the old and new `candidatePriority`
rankings showed:

- Spearman rank correlation: 0.864.
- Top-20 overlap: 17 of 20.
- Rotom-Wash fell 29 places, Skarmory 28, Cofagrigus 25, and Steelix 16;
  Staraptor rose 19.

The direction matches the filter's durability model, so Browser and Workbench
member quality now share the same HP-adjusted primitive. Speed remains a
separate soft ranking term and never compensates for failing a bulk floor.

## Calibration

`npm run measure:composite-bounds` is pinned to Regulation M-B and uses a fixed
random seed. Measuring all 208 legal species keeps scores comparable across
custom user filters rather than making scores relative to the current scan.

Final measured bounds:

```text
OBSERVED_STAT_TERMS.bulk  0.2642 .. 0.8760
doubles quality        0.1450 .. 0.5670
singles quality        0.1289 .. 0.5770
```

Existing synergy maxima were wider than the new run and remain unchanged under
the calibration rule: quality bounds are exact and replaced; sampled synergy
bounds only widen.

## Follow-up Signal

Hard floors still exclude support specialists before role scoring. Run
`npm run measure:support-eligibility -- M-B` to compare the current pool with a
floorless scan and list each rejected ability profile, its failed floors, and any
support role the engine can currently measure. The report deliberately does not
change scoring or maintain a hand-written exception list.

The command covers registerable, breedable varieties belonging to legal species.
Regulation legality is species-level, and the result remains dependent on live
PokeAPI data until the project has a versioned offline catalog.

Measured on 2026-07-30 against Regulation M-B:

- 236 scan-visible varieties before stat floors.
- 184 varieties clearing both floors.
- 52 rejected varieties.
- 11 rejected varieties carrying a currently modeled support ability: four with
  Intimidate, four with redirection, and three with ally protection.

The report also confirms the limit of ability-only role measurement. Whimsicott,
Sableye, and Liepard are rejected, but Prankster has no role here because its
value depends on which status moves the Pokemon can actually learn. Any
role-aware eligibility policy therefore needs move capabilities before it can
claim to cover support specialists generally.
