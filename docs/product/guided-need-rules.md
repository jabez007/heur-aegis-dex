# Guided Need Rules

This artifact defines the small deterministic rule set used by the guided MVP.
It supports both singles and doubles but limits primary needs to structural
vulnerabilities a new partner can directly address.

## Inputs

- `T`: number of elemental types in the active catalog, normally 18.
- `B`: `format.broughtToBattle`, 3 in singles and 4 in doubles.
- Ability-resolved coverage profiles for current members and the candidate.
- The exact selected ability for every member.

Guided calculations use `B` for team-size-normalized terms even when the current
roster is smaller. A neutral addition must not appear useful merely because it
increased a denominator.

The MVP evaluates vulnerability across the registered current-session roster.
It does not treat the result as a score for a simultaneous brought team;
favorite-containing subset optimization is deferred.

## Primary Needs

Needs have fixed category priority:

1. `shared-quadruple-weakness`
2. `unanswered-weakness`
3. `shared-weakness`

Within a category, dimensions sort by contribution descending and then type
slug in code-point order. If no dimension has positive contribution, there is
no primary need.

For type `t`:

```text
w(t) = weakness count
q(t) = quadruple-weakness count
r(t) = resistance count, including strict immunities

answered(t) =
  r(t) > 0 or STAB coverage reaches t or learnable move coverage reaches t
```

Using canonical weights from the existing synergy model:

```text
shared-quadruple-weakness(t) =
  sharedQuadrupleWeaknessWeight * max(q(t) - 1, 0) / B
  + resistanceBreadthWeight / T when q(t) >= 2 and r(t) == 0

unanswered-weakness(t) =
  uncoveredWeaknessWeight / T when w(t) > 0 and answered(t) is false
  + uncoveredQuadrupleWeaknessWeight / T
    when q(t) > 0 and answered(t) is false

shared-weakness(t) =
  sharedWeaknessWeight * max(w(t) - 1, 0) / (2 * B)
  + resistanceBreadthWeight / T when w(t) >= 2 and r(t) == 0
```

The resistance opportunity does not claim that a partner removes a favorite's
weakness. It records that the team gained a switch-in to the threatened type.

## Candidate Improvement

Evaluate the current roster and the same roster plus the candidate with fixed
denominators. For every rule contributing to the primary need, return actual
baseline and candidate values and contributions:

```text
delta = candidateContribution - baselineContribution
improvement = -sum(delta)
```

A candidate is improving when `improvement > 1e-12`. The tolerance prevents
floating-point noise from promoting a neutral candidate.

Generic role breadth and missing STAB targets are not primary needs. They may
participate only after primary-need improvement and introduced risk have tied.

## Tradeoffs

Tradeoffs are positive candidate-minus-baseline deltas in canonical penalty
dimensions:

- uncovered weakness;
- uncovered quadruple weakness;
- shared weakness;
- quadruple weakness;
- shared quadruple weakness;
- spread conflict in doubles only;
- field conflict for roles applicable to the selected format.

The primary tradeoff is the largest positive weighted delta. Equal deltas sort
by rule ID and then dimension slug in code-point order.

`immuneToAllyMoves` is derived from the selected ability during guided analysis,
so Telepathy is treated consistently with existing roster scoring.

## Candidate Order

1. Primary-need improvement descending.
2. Primary tradeoff delta ascending; no tradeoff is zero.
3. Existing candidate quality descending.
4. Ability slug ascending when selecting an ability profile.
5. Variety slug ascending for the final species-unique shortlist.

Input order is never a tiebreaker. Neutral candidates are omitted rather than
promoted to fill five slots.

## Required Fixtures

- Neutral additions produce zero improvement.
- A resistance closes only the linked resistance opportunity.
- Defensive, STAB, and move-only answers clear unanswered weaknesses.
- Shared quadruple raw penalties remain after an answer is added.
- Candidate evidence contains real before/after values and signed deltas.
- Telepathy and spread safety differ correctly between singles and doubles.
- Equal candidates remain stable under input permutation.
- No-vulnerability and fewer-than-five states do not fabricate recommendations.
