# Guided Need Rules

Status: Phase 0 normative baseline

This artifact defines the deterministic vocabulary and arithmetic for guided
partner discovery. The rules reuse canonical coverage facts, role facts, and
the weights exposed by `getTeamSynergyBreakdown`. They do not use the composite
team score and do not predict battle outcomes.

## Inputs

- `T`: the ordered elemental type universe supplied by the active scan. The
  standard catalog has 18 types.
- `B`: `format.broughtToBattle` (`3` in singles, `4` in doubles).
- `R`: the number of roles returned by `getApplicableRoles(format.hasAlly)`
  (`3` in singles, `5` in doubles).
- `RC`: reachable distinct role capacity, `min(B, R)` (`3` in singles, `4`
  in doubles), because one selected ability supplies at most one modeled role.
- Ability-resolved coverage profiles for every path member.
- The selected ability for every path member.
- One to three locked favorite variety slugs.

All slugs use code-point order. Guided analysis passes `B`, rather than the
partial line's member count, as the scoring-breakdown team-size denominator.
This prevents a neutral addition from appearing to improve a penalty merely by
making the roster larger.

## Finite Identifiers

Structural needs:

```ts
type StructuralNeedId =
  | 'shared-quadruple-weakness'
  | 'unanswered-weakness'
  | 'shared-weakness'
  | 'missing-coverage'
  | 'missing-modeled-role'
  | 'balanced-improvement';
```

Guided rules are the canonical contribution IDs used by the need or risk:

```ts
type GuidedRuleId =
  | 'coverageBreadth'
  | 'resistanceBreadth'
  | 'supportRoles'
  | 'uncoveredWeakness'
  | 'uncoveredQuadrupleWeakness'
  | 'sharedWeakness'
  | 'quadrupleWeakness'
  | 'sharedQuadrupleWeakness'
  | 'spreadConflict'
  | 'fieldConflict';
```

`quadrupleWeakness`, `spreadConflict`, and `fieldConflict` are risk rules, not
primary needs in the MVP.

## Dimension Contributions

Each need is one type or one applicable role. For a line `X` and type `t`:

```text
w(t) = weaknessCounts[t] or 0
q(t) = quadrupleWeaknessCounts[t] or 0
r(t) = resistanceCounts[t] or 0

answered(t) =
  r(t) > 0 or coverageCounts[t] > 0 or moveCoverageCounts[t] > 0
```

`CW`, `RW`, and `SW` are the active format's canonical `coverageBreadth`,
`resistanceBreadth`, and `supportRoles` weights. The contribution for each need
dimension is:

```text
shared-quadruple-weakness(t) =
  1.5 * max(q(t) - 1, 0) / B
  + RW / T when q(t) >= 2 and r(t) == 0

unanswered-weakness(t) =
  0.6 / T when w(t) > 0 and answered(t) is false
  + 1.2 / T when q(t) > 0 and answered(t) is false

shared-weakness(t) =
  0.5 * max(w(t) - 1, 0) / (2 * B)
  + RW / T when w(t) >= 2 and r(t) == 0

missing-coverage(t) =
  CW / T when coverageCounts[t] == 0

missing-modeled-role(role) =
  SW / R when fewer than RC distinct roles are present and the role is absent
```

Once a line reaches `RC` distinct roles, no role is reported as missing. This
avoids demanding five simultaneous ability roles from a doubles bring-four.

The added resistance opportunity does not claim that a resistant partner
removes a favorite's weakness. It closes the same-type opportunity already
modeled by the canonical resistance-breadth term while leaving the raw shared
penalty unchanged. Strict immunities count as resistances for this rule and
remain separately available through `immunityCounts` for explanations and path
comparison.

Every non-zero addend becomes structured evidence with its `GuidedRuleId`,
dimension slug, source facts, and contribution. Need severity is the sum of
those addends. Dimensions sort by severity descending, need ID ascending, then
dimension slug ascending.

## Favorite-Containing Lines

For current path `P`, candidate `c`, locked favorite `f`, and bring size `B`:

```text
baseSize = min(|P|, B)
candidateSize = min(|P| + 1, B)

BaseLines(f) =
  every baseSize subset of P containing f

CandidateLines(c, f) =
  every candidateSize subset of P + c containing c and f
```

For need dimension `d`, each favorite receives the lowest contribution among
its eligible lines. Current severity is the arithmetic mean of those
per-favorite values. This gives every favorite equal weight regardless of how
many combinations contain it.

Candidate improvement uses paired aggregate values:

```text
delta(f, d) = bestBaseContribution(f, d) - bestCandidateContribution(f, d)
improvement(c, d) = mean(delta(f, d) for every locked favorite)
```

A candidate improves the need only when every favorite's delta is non-negative
and the exact arithmetic mean is greater than zero. There is no epsilon or
minimum gameplay threshold. A candidate may help one favorite and leave another
unchanged; it may not worsen the primary need for any favorite.

When two lines have equal primary contribution, prefer lower total canonical
penalty, then the code-point-ordered line signature.

## Balanced Behavior

`balanced-improvement` is a terminal no-specific-gap state, not a fallback
score. It is selected only when every other modeled need has zero severity. Its
severity is zero and it returns no recommendations. The UI explains that the
rules found no specific modeled gap and links to the advanced browser.

Failure to find a candidate for the current primary need does not switch to
`balanced-improvement` and does not promote neutral candidates.

## Risks

Candidate risks are positive candidate-minus-baseline deltas in canonical
penalty dimensions, using fixed denominators:

```text
uncoveredWeakness          = 0.6 / T per type
uncoveredQuadrupleWeakness = 1.2 / T per type
sharedWeakness             = 0.5 * excess count / (2 * B)
quadrupleWeakness          = 0.6 * count / B
sharedQuadrupleWeakness    = 1.5 * excess count / B
spreadConflict             = 0.25 / min(2 * B, T) per type in doubles; 0 in singles
fieldConflict              = 0.4 / R per role
```

The primary tradeoff is the largest positive weighted delta. Equal deltas sort
by rule ID, then dimension slug. No positive delta is represented as `null`, not
as a claim that the candidate has no possible competitive downside.

## Candidate And Ability Order

Candidates and ability profiles use this complete order:

1. Primary-need improvement descending.
2. Primary tradeoff delta ascending; no tradeoff is zero.
3. Existing `candidatePriority` descending.
4. Ability slug ascending when selecting a profile for one variety.
5. Variety slug ascending when selecting among varieties and final candidates.

Apply the comparator to ability profiles, then varieties within a species, then
the species-unique shortlist. Candidate input order is never a tiebreaker.

## Golden Fixture Gate

The Phase 0 fixture suite must cover both formats and assert:

- neutral additions produce exactly zero shared-weakness improvement;
- resistance closes only the linked resistance opportunity;
- shared quadruple penalties remain while their resistance opportunity closes;
- defensive, STAB, and move-only answers clear unanswered weaknesses;
- move-only reach does not earn STAB coverage breadth;
- redirection, ally protection, and spread interactions are doubles-only;
- a candidate that worsens any favorite's primary need is rejected;
- bring-size caps and favorite-containing combinations are respected;
- ability, risk, variety, and input-permutation ties are stable;
- no-gap and fewer-than-five states do not fabricate recommendations.

Changing an identifier, formula, denominator, sign convention, or tie order
requires updating this artifact and its golden fixtures in the same change.
