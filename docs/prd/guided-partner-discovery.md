# PRD: Guided Partner Discovery

## 1. Executive Summary

### Problem Statement

Casual players often know which Pokemon they want to use but cannot determine
which shared weakness, missing resistance, unanswered attacking type, or
unfilled modeled role to address next. The current application exposes those
signals through an advanced browser and workbench but does not guide the next
partner decision.

### Proposed Solution

Add a guided planning mode for singles and doubles. A player locks one to three
favorite Pokemon, receives one prioritized structural need and up to five explained
partner candidates, and adds partners one slot at a time. The player may finish
the session after two additions and resume later, while the guided flow stops
after the third. The player may fork one decision into two locally persisted paths and compare their
strengths, risks, and remaining needs without replacing the locked favorites.

The product promise is: **Build around the Pokemon you love, with guidance you
can understand.**

### Success Criteria

- In a fixed-build summative pilot with 24 participants, 12 assigned to singles
  and 12 to doubles, at least 10 participants in each format add two partners
  within five minutes of locking favorites without facilitator help.
- At least 9 of 12 participants in each format score 2/2 on the recommendation
  comprehension rubric: one evidence-backed benefit and one disclosed tradeoff.
- At least 8 of 12 participants in each format fork and compare two paths
  without facilitator help.
- At least 6 of 12 participants in each format reopen the same guided plan in an
  unprompted second session between four hours and seven days after the first.
- Locked favorites are retained in 100% of recommendation, add, fork, restore,
  and comparison operations.
- After catalog loading, each guided recommendation step completes within 250
  ms at the 95th percentile on the supported desktop test environment.

## 2. User Experience & Functionality

### User Personas

**Primary: Casual Team Builder**

- Has one to three favorite Pokemon in mind.
- Understands basic type strengths and weaknesses but not every competitive
  interaction.
- Wants a team that makes mechanical sense without surrendering ownership to a
  full-team generator or replacing the favorites they selected.
- May play singles or doubles and should not need to learn the other format's
  terminology.

**Secondary: Returning Experimenter**

- Has already started a guided plan.
- Wants to revisit the same favorites, compare two partner directions, or
  continue adding partners later.
- Expects prior choices and explanations to survive a reload.

The advanced competitive player remains served by the existing browser and
workbench but is not the target persona for this mode.

### Core User Flow

1. The player starts a guided plan and chooses singles or doubles.
2. The player selects and locks one to three favorite Pokemon from the legal
   catalog for the active regulation and current scan settings.
3. The product shows the team's highest-priority structural need in plain
   language, with an optional mechanical detail view. A structural need is a
   traceable coverage or role gap, not a new team-quality score.
4. The product presents up to five legal, unique partner candidates. Each
   candidate states why it addresses the need and the most important new risk
   or limitation it introduces.
5. The player adds one candidate or returns to the advanced browser.
6. The product recalculates needs and recommendations for the updated partial
   roster. After the second addition, the player can **Save for later** or **Add
   one more**. Saving pauses the path; resuming returns it to active. The third
   addition sets the path to `limit-reached` and ends guided additions.
7. At one recommendation step, the player may fork the plan. The original core
   is copied into both paths; each path may choose a different partner.
8. The comparison view shows the structural differences between the two paths,
   not a single unexplained winner.
9. Both paths persist locally and can be resumed after reload or in a later
   session.

### User Stories

#### Story 1: Start Around Favorites

As a casual player, I want to lock my favorite Pokemon so that recommendations
help me use them rather than replace them.

**Acceptance Criteria**

- The player must choose singles or doubles before recommendations appear.
- The player can lock one, two, or three legal Pokemon.
- Duplicate species cannot be locked in the same plan.
- A locked Pokemon remains visually identifiable in every guided view.
- No guided action can remove or replace a locked Pokemon.
- If a saved favorite is no longer legal, the original plan remains available
  read-only. The player may restore compatible scan settings or explicitly clone
  the plan into a new core; the product never silently removes or substitutes
  the favorite.
- Format becomes immutable when the first recommendation is shown. Changing
  format starts a new guided plan with the same favorites and no added partners.

#### Story 2: Understand The Next Need

As a casual player, I want the product to identify one important team need so
that I know what problem the next partner should solve.

**Acceptance Criteria**

- Exactly one primary need is presented at a time.
- The need has a plain-language title, a one-sentence explanation, and an
  expandable mechanical explanation.
- Need selection uses the chosen format. Singles guidance must not credit
  doubles-only ally interactions; doubles guidance may include them.
- The initial need vocabulary is finite, deterministic, and covered by tests.
- The interface does not present a heuristic score as a win probability.
- Need priority, minimum improvement, risk severity, and balanced-improvement
  behavior must come from the approved Phase 0 rules artifact. UI implementation
  cannot begin until its golden fixtures pass.

#### Story 3: Choose An Explained Partner

As a casual player, I want a small set of explained partners so that I can make
an informed choice without searching the entire catalog.

**Acceptance Criteria**

- The shortlist contains `min(5, improvingCandidates.length)` candidates. An
  improving candidate is legal, species-unique, non-excluded, not already on the
  path, and produces `improvement > 0` under the approved primary-need rule.
- Fewer-than-five and zero-candidate states explain why the list is short and
  link to the advanced browser without relabeling neutral candidates as fixes.
- Candidates are legal under the current regulation and scan settings.
- Already selected Pokemon, duplicate species, and user-excluded candidates do
  not appear.
- Each recommendation evaluates every available ability profile and returns the
  candidate with the ability that best improves the primary need. Ability ties
  follow primary-need improvement, introduced risk, existing candidate quality,
  then ability slug code-point order.
- Adding a recommendation stores exactly the returned ability. Guided mode does
  not read global browser ability overrides or expose ability editing in the
  MVP; changing an ability requires leaving for the advanced workflow.
- **Don't suggest this species** adds a plan-global exclusion used by both paths.
  Guided settings list excluded species and allow the player to restore them.
- Every candidate includes at least one reason tied to the primary need.
- Every candidate discloses the highest-severity new structural risk it adds,
  or explicitly states that the approved rules found no primary tradeoff.
- Recommendation order is deterministic for the same catalog, settings, core,
  and format.
- After rule deltas and existing candidate-quality terms, ties sort by canonical
  Pokemon variety slug using code-point order.
- The player can inspect equivalent detailed Pokemon information through the
  new read-only guided detail component before adding a candidate.
- Adding a candidate recalculates the next need and shortlist.
- After the second addition, the player can choose **Save for later** or **Add
  one more**. A saved path may resume; the third addition is the irreversible
  guided-addition limit for that path.
- Path state is one of `active`, `paused-after-two`, or `limit-reached`; reducer
  transitions and restore behavior are exhaustive over those states.
- A path cannot exceed six registered Pokemon. Additions are counted per path,
  including additions made before a fork.

#### Story 4: Compare Two Paths

As a returning experimenter, I want to try two partner choices from the same
core so that I can compare directions without destroying prior work.

**Acceptance Criteria**

- The MVP supports one fork and no more than two paths per guided plan.
- Forking copies the same locked favorites and pre-fork partner choices into
  both paths.
- A choice made after the fork affects only the active path.
- The player can switch paths, continue either path independently, and return to
  comparison without losing choices.
- The comparison view shows differences in weaknesses, resistances, strict
  immunities, STAB coverage, move reach, and modeled roles where applicable.
- The comparison shows each path's member count, locked favorites, strongest
  modeled improvement, highest current risk, and next primary need.
- The comparison uses directional statements such as "Path A covers more of
  your current weaknesses" rather than declaring an unexplained winner.
- Paths with different numbers of filled slots are labeled as incomplete and
  are not compared by aggregate score.
- Paths use the fixed labels **Path A** and **Path B** in the MVP.

#### Story 5: Resume Planning

As a returning player, I want my guided plan and both paths restored locally so
that I can continue experimenting later.

**Acceptance Criteria**

- Guided state is stored in a separate versioned `GuidedPlanArchiveV1` so the
  existing advanced workspace schema and recovery behavior remain unchanged.
- The archive holds independently validated plans keyed by random local plan ID,
  plus active and draft plan IDs. Corruption in one plan is salvaged without
  discarding other valid plans.
- Format, locked favorites, both paths, active path, exclusions, selected
  abilities, and the last completed guided step are restored.
- Each plan persists the scan-input snapshot that established its pool:
  regulation, region, stat floors, Mega setting, ability-immunity setting,
  move-coverage setting, and originating scan/catalog revision.
- Derived needs, recommendations, and comparison results are recomputed with
  the current engine rather than persisted as authoritative results.
- Missing or illegal Pokemon are reported and retained as unresolved references
  until the player chooses how to resolve them.
- Ability choices are stored on path members and always match the ability used
  to produce the accepted recommendation evidence.
- Corrupt guided or metric state cannot invalidate advanced named workspaces or
  the other guided record.

#### Story 6: Review Local Progress Metrics

As a product evaluator, I want non-identifying local funnel counters so that a
usability participant can report whether the guided loop worked without an
account or automatic telemetry.

**Acceptance Criteria**

- No metric leaves the browser automatically.
- Local metrics record event names, counts, session timestamps, and bounded
  elapsed durations, not Pokemon names, free text, or user identifiers.
- Required events are: plan started, favorites locked, recommendation shown,
  partner added, path forked, comparison viewed, plan resumed, and guided step
  exited.
- The evaluator can view or copy a human-readable summary during an opt-in
  usability session.
- Guided mode provides one explicit clear-local-guided-data action that clears
  guided plans and metrics without deleting advanced workspaces.

### Summative Validation Protocol

- Formative rounds use at least five participants and inform wording or flow;
  their results do not count toward release gates.
- Success criteria are evaluated on one unchanged release-candidate build with
  24 new participants: 12 singles and 12 doubles.
- The recruitment screener requires participants to understand basic type
  matchups, use a team builder no more than monthly, and not have competed in a
  rated tournament in the previous year.
- The timer starts when favorites are locked and ends when the second partner is
  added. Any hint beyond the standardized task prompt counts as facilitator
  help and fails the unaided criterion.
- The comprehension rubric awards one point for naming a displayed mechanical
  benefit and one for naming the displayed primary tradeoff. Both must be tied
  to evidence shown by the product.
- Every participant who starts a task remains in that metric's denominator;
  abandonment, timeout, or technical failure counts as unsuccessful.
- A second session begins after at least four hours without a guided event. The
  plan carries a random local plan ID and start/resume timestamps solely to
  distinguish the same local plan; these values are shown only in the opt-in
  summary and are never transmitted automatically.

### Non-Goals

- Building complete movesets, items, EV spreads, natures, or Tera choices.
- Predicting matchup win rates or tournament outcomes.
- Replacing locked favorites with globally stronger alternatives.
- Globally optimizing or claiming to complete a team of six. A path may happen
  to reach six members when three favorites receive three additions, but the
  guided flow makes no completeness or optimality claim.
- Supporting more than two branches or a general branch tree.
- Accounts, cloud synchronization, collaboration, or public sharing.
- Automatic analytics transmission.
- Replacing the advanced candidate browser, roster generator, or workbench.
- Recalibrating the existing scoring model as part of the guided UI project.

## 3. AI System Requirements (Not Applicable)

The MVP does not use a language model or generative AI. Needs, reasons, and
tradeoffs are deterministic outputs from explicit domain rules and explanation
templates. This avoids unsupported claims, network dependencies, variable cost,
and explanations that cannot be traced to the score.

### Evaluation Strategy

- Every need and explanation template must have fixture-based unit tests.
- Each recommendation reason must identify the rule and source facts that
  produced it.
- Golden tests must cover at least ten representative partial teams per format,
  including fragile favorites, defensive cores, role conflicts, and cases with
  fewer than five eligible partners.
- Product-quality evaluation uses the usability targets in the Executive
  Summary. Rule-engine tests do not replace those usability targets.

## 4. Technical Specifications

### Architecture Overview

The guided mode reuses the verified local catalog and existing scan engine. It
must not introduce another Pokemon data source or a second scoring model.

A guided path is a partial registered roster, not a brought team. Structural
needs are never calculated by passing an undersized path into the calibrated
full-team composite score. For candidate evidence, the engine enumerates legal
lines of size `min(pathSize + 1, format.broughtToBattle)` containing the
candidate and each locked favorite in turn.
This lets a partner support every favorite across the registration without
claiming that all six members enter battle together. Exact aggregation and
minimum-improvement rules belong to the Phase 0 rules artifact.

Proposed data flow:

1. Application scan orchestration supplies an already resolved, immutable
   `PokemonEntry[]` candidate pool and scan revision. The guided engine does not
   call `getResistantTypes` itself.
2. A dedicated guided-plan reducer owns format, locked favorites, active path,
   path-scoped abilities, and plan-global exclusions. It does not mutate
   `useTeamBuilder`.
3. A pure need-analysis function ranks the current partial roster's modeled gaps.
4. A pure partner-recommendation function evaluates eligible additions against
   the primary need and returns zero to five recommendations with structured
   evidence.
5. Explanation templates convert that evidence into plain and mechanical text.
6. Existing team-coverage and role analysis produce the two-path comparison.
7. A separate guided-plan store persists user choices; needs, scores,
   recommendations, and comparison results are recomputed.

The domain boundary must provide the following information; implementation
names may differ:

```ts
type StructuralNeedId =
  | 'shared-quadruple-weakness'
  | 'unanswered-weakness'
  | 'shared-weakness'
  | 'missing-coverage'
  | 'missing-modeled-role'
  | 'balanced-improvement';

type GuidedRuleId = keyof typeof GUIDED_RULES;

interface GuidedEvidence {
  ruleId: GuidedRuleId;
  dimension: string;
  sourceFacts: readonly string[];
  baselineValue: number;
  candidateValue: number;
  baselineContribution: number;
  candidateContribution: number;
  delta: number;
}

interface GuidedRecommendationRequest {
  format: 'singles' | 'doubles';
  scanRevision: string;
  scanSettings: GuidedScanSettings;
  lockedFavorites: readonly string[];
  pathMembers: readonly GuidedPathMember[];
  excludedSpecies: readonly string[];
  candidatePool: readonly PokemonEntry[];
}

interface StructuralNeed {
  id: StructuralNeedId;
  severity: number;
  evidence: readonly GuidedEvidence[];
}

interface PartnerRecommendation {
  varietyName: string;
  speciesName: string;
  abilityName: string;
  needId: StructuralNeedId;
  rank: number;
  improvement: number;
  reasons: readonly GuidedEvidence[];
  primaryTradeoff: GuidedEvidence | null;
}
```

Evidence is structured domain data, not prewritten prose. UI templates own the
wording so explanations remain testable and can later be revised without
changing ranking behavior.

For every evidence value, `delta = candidateContribution - baselineContribution`.
For penalty and opportunity-gap contributions, `improvement = -delta`; a newly
introduced risk has `delta > 0`. Phase 0 fixtures must assert this sign
convention directly.

### Recommendation Rules

- Phase 0 must extract a scoring-breakdown API from canonical coverage, role,
  and synergy rules. Guided needs and explanations consume that breakdown; they
  do not duplicate weights or infer reasons from a final scalar score.
- Recommendation ranking must be conditional on the active partial team and
  primary need; global candidate quality may be a tiebreaker but cannot be the
  sole score.
- Existing format-specific scoring rules remain authoritative. Doubles-only
  roles and ally interactions score zero in singles.
- Shortlists are unique by species. When several legal varieties exist, choose
  the variety with the largest primary-need improvement, then existing
  candidate quality, then variety slug code-point order.
- Need severity is the canonical weighted penalty or opportunity-gap
  contribution defined by the Phase 0 artifact. Needs sort by severity
  descending, then by `StructuralNeedId` code-point order.
- Candidate improvement is `baselineContribution - candidateContribution` for
  the primary need, aggregated across the candidate's favorite-containing legal
  lines by the approved Phase 0 rule. It must be greater than zero.
- Guided line breakdowns use `format.broughtToBattle` as the denominator for
  team-size-normalized terms, including partial lines. Adding a neutral member
  must not create improvement through denominator dilution.
- A shared weakness or shared quadruple weakness keeps its canonical raw
  penalty when a resistant partner is added. Its guided contribution also
  includes the same-type opportunity from the canonical resistance-breadth
  term, which the resistant partner can close. The interface must not claim the
  original weakness was removed.
- A newly introduced risk is any canonical penalty contribution with a positive
  `delta`. The largest weighted delta is the primary tradeoff; ties sort
  by `GuidedRuleId` code-point order.
- Candidates sort by primary-need improvement descending, introduced penalty
  ascending, existing `candidatePriority` descending, then variety slug
  code-point order.
- Ability profiles are evaluated before candidate ranking. One variety appears
  once with its best ability under the same comparator; ability slug is the
  final profile tiebreaker. Global browser overrides are not recommendation
  inputs.
- If no candidate improves a need, the UI explains the limitation and offers
  the advanced browser. It must not relabel a neutral candidate as a solution.
- `balanced-improvement` is selected only when no other modeled need has positive
  severity. It returns no recommendations and is not an alternate aggregate
  scoring model or a fallback for an unfixable primary need.
- Candidate and evidence ordering must be stable.

### Persistence

- Store `GuidedPlanArchiveV1` under a new key, independently from
  `WorkspaceSnapshotV1`. Existing workspaces are neither migrated nor interpreted
  as guided plans.
- The archive contains multiple plans keyed by local plan ID and identifies the
  active and draft plans. Each plan persists its complete scan-input snapshot
  and originating scan revision.
- Store locked favorites once at plan level. Store post-fork membership and
  ability choices independently on Path A and Path B. Exclusions are plan-global
  and apply immediately to both paths.
- Do not persist derived rankings or explanations as authoritative data.
- Preserve the current fail-closed behavior for removed regulations.
- Guided state and local metric state must be independently recoverable so
  damage to metrics cannot damage a workspace.
- Define latest-write-wins multi-tab behavior using storage events. A failed or
  quota-exceeded write leaves the previous valid guided record intact and
  reports the failure.

### Integration Points

- `src/lib/pokemonEntry.ts`: eligible flat Pokemon records and ability choices.
- `src/lib/teamCoverage.ts`: weakness, resistance, and coverage gaps; add
  explicit `immunityCounts` for strict-immunity comparison.
- `src/lib/abilityRoles.ts`: format-aware modeled roles and conflicts.
- `src/lib/teamScoring.ts`: extract traceable scoring contributions from the
  existing member-quality and synergy terms.
- `src/lib/rosterGeneration.ts`: reuse candidate-quality terms only; move shared
  species/exclusion predicates into a pure domain module.
- `src/lib/battleFormats.ts`: bring-size rules used to enumerate candidate lines.
- A new guided-plan reducer: enforce locked-favorite, branch, ability, format,
  and transition invariants.
- A new read-only guided candidate summary: reuse domain presentation data but
  not `PokemonCard` actions or remote sprite requests.

### Performance

- Recommendation calculation must run locally with no network request.
- Benchmarks use the pinned catalog, fixed golden path fixtures, Playwright's
  pinned Chromium, two warm-up runs, and 50 measured warm runs on
  `ubuntu-latest`. Timing starts at request dispatch and ends when the latest
  result is accepted; render time is reported separately.
- Recommendation acceptance must remain under 250 ms p95 and branch comparison
  under 100 ms p95 in that regression environment. These are CI regression
  guards, not hardware-independent SLAs.
- Results use request IDs and latest-result-wins semantics. If any benchmarked
  calculation blocks the main thread for more than 50 ms, a Web Worker with
  serializable request/response contracts is required before release.

### Accessibility

- The complete guided flow must be keyboard operable.
- Need severity cannot be communicated by color alone.
- The active path and locked favorites must have programmatic labels.
- Recommendation updates must use a non-interruptive live region.
- Focus must move predictably after adding a partner, forking, switching paths,
  and opening comparison.

### Security & Privacy

- Guided planning remains local-first and requires no account.
- No team composition, favorite, or free text is transmitted.
- Local metric summaries are opt-in to view or copy and contain no stable user
  identifier.
- Guided recommendation cards do not request remote sprites. They use text,
  local type assets, and locally available presentation data.
- Starting guided mode does not mount the advanced browser's remote-image cards;
  leaving for the advanced browser is an explicit user action.
- Catalog integrity, regulation freshness, and fail-closed legality behavior
  remain unchanged.

### Testing Requirements

- Unit tests for need prioritization, recommendation ranking, stable ties,
  format differences, tradeoff selection, and explanation evidence.
- Property tests or exhaustive fixtures proving locked favorites are never
  removed across all guided transitions.
- Guided-record corruption, quota failure, multi-tab, and unresolved-Pokemon
  tests that prove advanced workspaces remain independently recoverable.
- Component tests for keyboard flow, fewer-than-five results, no-improvement
  states, branch limits, and incomplete comparisons.
- Playwright coverage for the primary flow in singles and doubles, local reload,
  path comparison, and operation with all external requests blocked.
- Permutation tests proving candidate input order cannot change recommendation
  order, plus path-local ability and plan-global exclusion tests.
- Performance measurements in Playwright against fixed catalog fixtures.
- Formative usability rounds with at least five participants, followed by the
  fixed-build summative protocol defined above.

## 5. Risks & Roadmap

### Phased Rollout

**Phase 0: Language And Rule Validation**

- Produce an approved `guided-need-rules` artifact that defines finite need and
  rule IDs, evidence inputs, scoring-breakdown mappings, severity calculations,
  favorite-containing line aggregation, minimum improvement, risk ordering,
  balanced-improvement behavior, and complete tie order.
- Extract the traceable scoring-breakdown API without changing existing scores.
- Build and pass golden fixtures for singles and doubles. This is the entry gate
  for MVP UI implementation.
- Test plain-language labels with at least five casual players before building
  the complete UI.

**MVP: Guided Partner Loop**

- Deliver Stories 1 through 6 using the approved Phase 0 rules artifact and
  evaluate the release candidate against all six success criteria.

**v1.1: Recommendation And Comparison Refinement**

- Revise need priority and explanation language using usability findings.
- Add filtering within a shortlist only if observed choice overload warrants it.
- Improve comparison presentation for incomplete paths.
- Add explicit plan completion only if users consistently continue beyond the
  MVP's two or three partner additions.

**v2.0: Deferred Expansion, Conditional On Evidence**

- Consider shareable or synchronized plans only if local repeated planning is
  demonstrated.
- Consider more detailed set information only after the data model can support
  honest, validated recommendations.
- Consider matchup context only with an explicit metagame dataset and an
  evaluation method that distinguishes prediction from heuristics.

### Technical And Product Risks

**Casual-language risk:** Existing domain concepts may remain too technical.

- Mitigation: validate the need taxonomy and wording before the full UI; retain
  optional mechanical details for transparency.

**Model-trust risk:** Existing weights have not been validated against match
outcomes.

- Mitigation: promise structural guidance, expose evidence and tradeoffs, and
  never present scores as win probabilities or optimality.

**Format-breadth risk:** Supporting singles and doubles may produce generic
guidance or leak doubles assumptions into singles.

- Mitigation: require format-specific golden fixtures and prohibit ally-only
evidence in singles.

**Favorite feasibility risk:** Some locked cores may have no candidate that
meaningfully improves the primary need.

- Mitigation: explain the modeled limitation, preserve favorites, and offer the
advanced browser rather than fabricating a recommendation.

**Branch complexity risk:** Comparison state may overshadow partner discovery.

- Mitigation: permit one fork only, validate the guided loop before polishing
branch features, and defer arbitrary branch trees.

**Persistence isolation risk:** Guided state could damage existing local plans.

- Mitigation: use separate versioned storage, preserve unresolved identifiers,
  and test corrupt guided data independently from named workspace recovery.

**Metric validity risk:** Local counters do not provide population analytics and
pilot return behavior may be influenced by study prompts.

- Mitigation: treat local metrics as usability evidence, report sample size and
study conditions, and do not infer broad retention from a small pilot.
