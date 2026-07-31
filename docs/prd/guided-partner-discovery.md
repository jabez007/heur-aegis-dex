# PRD: Guided Partner Discovery

## Summary

Casual players often know which Pokemon they want to use but not which partner
would make those favorites easier to build around. Add a guided, current-session
flow for both singles and doubles:

1. Choose a format and lock one to three favorites.
2. Show one structural vulnerability in plain language.
3. Recommend up to five legal partners with a reason and primary tradeoff.
4. Add a partner and recalculate, for at most three guided additions.

The product promise is: **Build around the Pokemon you love, with guidance you
can understand.**

## Success Criteria

- Guided actions never remove or replace locked favorites.
- Singles guidance never credits ally-only interactions; doubles guidance may.
- Every recommendation improves the displayed need and explains the modeled
  benefit and highest modeled tradeoff.
- Fixed inputs produce stable needs and recommendation order.
- The flow handles fewer-than-five and no-improvement results honestly.
- The primary singles and doubles flows work with external requests blocked
  after the local catalog loads.

Validation is intentionally lightweight: automated tests, personal use, and
informal GitHub feedback. The project does not collect usage analytics.

## User Flow

1. The player chooses singles or doubles.
2. The player locks one to three legal, species-unique favorites.
3. The product displays one primary vulnerability with a short explanation and
   optional mechanical detail.
4. The product displays up to five improving, species-unique partner choices.
5. Each choice shows why it helps and the largest modeled risk it introduces,
   or states that no primary tradeoff was found.
6. The player follows the recommendation to the existing advanced details,
   adds it, or leaves for the advanced browser.
7. Adding a partner stores the exact recommended ability and recalculates the
   next need and shortlist.
8. The guided loop ends after three additions or whenever the player leaves it.

## Requirements

### Favorites And Format

- The player can lock one, two, or three legal Pokemon.
- Duplicate species are not allowed in the same guided session.
- Locked favorites remain visibly identifiable and cannot be removed or
  replaced by guided actions.
- Format becomes immutable when the first recommendation is shown. Changing
  format requires the caller to create a new current-session plan with the same
  favorites.
- Both singles and doubles are MVP formats.

### Structural Needs

The MVP uses only vulnerability needs that have direct mechanical meaning:

```ts
type StructuralNeedId =
  | 'shared-quadruple-weakness'
  | 'unanswered-weakness'
  | 'shared-weakness';
```

- Exactly one primary need is shown when a modeled vulnerability exists.
- No synthetic balanced state is required. If no vulnerability exists, the UI
  states that no specific modeled gap was found and links to the advanced
  browser.
- Role breadth, generic missing coverage, member quality, and doubles support
  are candidate-ranking signals or tradeoffs, not primary needs.
- Need definitions and arithmetic come from
  `docs/product/guided-need-rules.md`.

### Partner Recommendations

- The shortlist contains `min(5, improvingCandidates.length)` entries.
- Candidates must be legal under the current regulation and scan settings.
- Current members and duplicate species are excluded.
- Every available ability profile is evaluated. The selected ability is stored
  exactly if the recommendation is accepted.
- A recommendation must improve the primary need by more than the documented
  floating-point tolerance.
- Recommendation reasons contain structured before/after evidence; UI prose is
  derived from that evidence rather than inferred from a final score.
- Newly introduced canonical penalties are eligible tradeoffs. The largest
  weighted increase is displayed.
- Stable ties use existing candidate quality, then canonical variety and ability
  slugs in code-point order.
- Neutral candidates are never relabeled as fixes.
- Guided cards use local data and do not request remote sprites.

### Current-Session State

- State contains format, locked favorites, whether recommendations have begun,
  and zero to three accepted partners.
- A path cannot exceed six registered Pokemon.
- There is no guided removal or ability-editing action.
- The MVP does not persist guided state. Leaving or reloading starts a new guided
  session.
- Vulnerabilities are evaluated across the registered current-session roster as
  a structural pool, not as a claim that all six members battle simultaneously.
  Fixed bring-size denominators keep singles and doubles weighting distinct;
  brought-subset optimization is deferred.

## Technical Design

### Data Flow

1. Existing scan orchestration supplies an immutable legal `PokemonEntry[]` and
   scan revision.
2. A small reducer enforces favorites, format locking, species uniqueness, and
   the three-addition limit.
3. A pure need function evaluates the current partial roster using canonical
   coverage facts and fixed bring-size denominators.
4. A pure recommendation function evaluates legal candidate ability profiles
   against the primary need.
5. Explanation templates render structured evidence.

The guided engine does not call network APIs, mutate `useTeamBuilder`, use the
full-team composite score on partial rosters, or introduce another Pokemon data
source.

### Evidence Contract

```ts
interface GuidedEvidence {
  ruleId: string;
  dimension: string;
  sourceFacts: readonly string[];
  baselineValue: number;
  candidateValue: number;
  baselineContribution: number;
  candidateContribution: number;
  delta: number;
}

interface PartnerRecommendation {
  varietyName: string;
  speciesName: string;
  abilityName: string;
  needId: StructuralNeedId;
  improvement: number;
  reasons: readonly GuidedEvidence[];
  primaryTradeoff: GuidedEvidence | null;
}
```

For a problem contribution, `delta = candidateContribution -
baselineContribution` and `improvement = -sum(delta)`. A positive penalty delta
is a newly introduced risk.

### Performance

- Recommendation calculation is local and makes no network request.
- Avoid adding worker infrastructure or formal benchmark gates until profiling
  shows a real responsiveness problem.
- Use request IDs or equivalent latest-result handling only if recommendation
  calculation becomes asynchronous.

### Accessibility

- The flow is keyboard operable.
- Need severity and tradeoffs are not communicated by color alone.
- Locked favorites have programmatic labels.
- Recommendation updates use a non-interruptive live region.
- Focus moves predictably after adding a partner or opening details.

### Privacy

- No account is required.
- No team composition, behavioral event history, or free text is transmitted or
  stored for analytics.
- Catalog integrity and fail-closed regulation behavior remain unchanged.

## Testing

- Unit fixtures for need priority, positive improvement, actual before/after
  evidence, stable ties, and tradeoff selection.
- Singles fixtures proving ally-only roles and spread interactions receive no
  credit.
- Doubles fixtures covering spread safety, field conflicts, and Telepathy.
- Reducer tests proving favorites are retained, species stay unique, format
  locking works, and no more than three additions or six members are reachable.
- Candidate-order permutation tests.
- Component tests for keyboard flow, fewer-than-five results, no-improvement
  states, and recommendation explanations.
- One Playwright flow per format with external requests blocked.

## Non-Goals

- Complete movesets, items, EVs, natures, Tera choices, or matchup prediction.
- Replacing favorites or claiming to produce an optimal team.
- Branching, path comparison, or arbitrary planning trees.
- Pause/resume workflow, guided autosave, multi-plan archives, or multi-tab
  synchronization.
- Accounts, cloud sync, collaboration, or sharing.
- Usage analytics, telemetry, or formal usability-study instrumentation.
- A dedicated read-only detail system when the existing advanced details can be
  linked instead.

## Deferred Work

Add only when personal use demonstrates a concrete need:

- Local resume for one current draft.
- Forking and side-by-side path comparison.
- Plan-global species exclusions.
- More detailed set recommendations after the data model supports them.
- Worker-based recommendation calculation after measured responsiveness issues.
