# ADR-0001: Persist Local Workspaces as Versioned Identifiers

## Status

Accepted

## Date

2026-07-29

## Context

Team building spans scan settings, type filters, browser ability choices, roster
members, bring selection, and generation exclusions. Losing that state on reload
makes experimentation costly, while copying complete PokeAPI records into browser
storage would preserve stale stats, coverage, legality, and scoring data after the
engine changes.

The application needs automatic draft recovery and named checkpoints without an
account or backend. Saves must also remain small enough for `localStorage` and be
validatable because browser storage is an untrusted boundary.

## Decision

Store a versioned workspace archive in `localStorage`. Version 1 records only
stable identifiers and explicit user choices:

- Scan settings and regulation identifier.
- Selected type filters.
- Pokemon-to-ability overrides.
- Battle format, ordered roster identifiers, selected roster abilities, manual
  bring identifiers, and generation exclusions.

Do not store scan results, sprites, stats, ability profiles, type matchups,
coverage, scores, generated alternatives, or loading state.

Restore scan-independent settings before the initial scan. After that scan
completes, resolve roster and ability identifiers against current data and
recompute every derived value. Keep unresolved identifiers in the saved snapshot
and report them instead of silently replacing the stored workspace with a partial
roster.

Named saves are immutable checkpoints until explicitly overwritten. Loading one
copies it into the automatic recovery draft; subsequent edits update only the
draft. Draft writes are debounced and flushed when the page or app unmounts.

## Alternatives Considered

### Persist Complete Pokemon Records

This would restore a roster without a successful scan, but cached derived data
could disagree with current regulation, ability, coverage, or scoring rules. It
was rejected in favor of current-data correctness.

### IndexedDB

IndexedDB offers transactions and more capacity, but workspace records are small
and infrequently written. Its additional asynchronous lifecycle is not justified
for the first local-only version.

### Cloud Accounts

Cloud storage would enable cross-device access and sharing, but requires
authentication, a backend, privacy policy, and operational ownership. It is
outside the local workspace requirement.

### Save Only the Roster

A roster without its regulation, scan thresholds, type filters, ability choices,
and exclusions does not reproduce the planning context that produced it.

## Consequences

- Workspace schemas require explicit versioning and future migrations.
- Restore is staged and autosave must remain suspended until hydration completes.
- A scan or valid scan cache is required to render saved roster members.
- Removed regulations, Pokemon forms, or abilities produce visible restore
  warnings while the named save remains intact.
- Derived data always reflects the currently shipped engine.
- Browser saves remain local to one origin and browser profile; import/export and
  cloud synchronization can be added later without changing the snapshot model.
