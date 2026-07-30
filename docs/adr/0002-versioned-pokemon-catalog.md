# ADR-0002: Generate a Versioned Pokemon Catalog

## Status

Accepted

## Date

2026-07-30

## Context

The browser scan currently acquires the full national PokeAPI inventory before
regulation, region, form, breedability, and stat filters reduce it. A cold cache
miss makes thousands of requests, keeps large transport-shaped responses in
memory, and fails the whole scan when one required request fails.

The engine should remain able to recompute scores and filters when its rules
change. Precomputing final scan results would instead bind external facts to one
set of thresholds and scoring behavior. The published `getResistantTypes` result
shape and PokeAPI names are also existing compatibility contracts.

## Decision

Generate a full normalized Pokemon catalog from a pinned commit of
`PokeAPI/api-data` and commit the artifact to this repository.

The catalog contains only facts consumed by the engine: elemental type
relations, species legality inputs, regional Pokedex membership, varieties,
forms, ordered abilities, stats, and sprite URLs. It does not contain derived
scores, selected abilities, eligibility decisions, or final scan results.

Every artifact carries a schema version, upstream revision, content hash,
regulation digest, record counts, and source license. Missing upstream facts are
represented explicitly rather than dropped or interpreted as empty data.
Generation writes atomically only after all pinned resources have loaded and the
complete normalized candidate passes semantic validation.

Phase 1 creates and validates the artifact without changing runtime acquisition.
A later phase will compare catalog and live scan output before making the catalog
the default source. The existing public scan interface remains unchanged.

## Alternatives Considered

### Regulation-Scoped Catalog

Smaller, but it cannot preserve unrestricted and regional scans. Regulation
shards may be added later as an optimization after measuring the full catalog.

### Service-Worker Cache of Live PokeAPI Responses

Improves repeat availability but leaves the first visit dependent on thousands
of oversized mutable responses and can mix resources observed at different
times.

### Precomputed Scan Results

Rejected because numeric stat floors and scan settings create a combinatorial
set of outputs. It would also conflict with the workspace decision to recompute
derived data using the currently shipped engine.

## Consequences

- Catalog updates are reviewed data changes rather than runtime surprises.
- Regulation changes invalidate the artifact through its digest and tests.
- The generator must be rerun when the pinned upstream revision changes.
- PokeAPI names remain the join keys for regulations, forms, coverage, and saved
  workspaces.
- The readable artifact is about 1.5 MB and roughly 92 KB gzip; it must be lazy
  loaded when runtime cutover occurs.
- Remote sprite URLs remain a separate availability concern.
- Runtime PokeAPI dependencies remain until parity and offline tests support the
  later cutover.
