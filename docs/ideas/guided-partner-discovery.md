# Guided Partner Discovery

## Problem

Players often know which Pokemon they want to use but not which partner would
help those favorites fit together. The existing browser exposes the underlying
facts but expects the player to interpret all of them at once.

## Direction

Build a guided current-session flow for both singles and doubles:

- Lock one to three favorites.
- Show one understandable structural vulnerability.
- Offer up to five legal partners with reasons and tradeoffs.
- Add a partner and recalculate, for at most three additions.
- Never replace the favorites.

The product promise is: **Build around the Pokemon you love, with guidance you
can understand.**

## MVP Questions

- Is one vulnerability easier to act on than a global score?
- Are five explained candidates enough choice without recreating the browser?
- Do singles and doubles remain understandable in one shared flow?
- Are recommendations still useful without complete movesets, items, EVs, or
  Tera choices?

Answer these through personal use, deterministic tests, and informal GitHub
feedback rather than analytics or a formal study.

## MVP Scope

- Singles and doubles.
- One to three locked favorites.
- Shared 4x weakness, unanswered weakness, and shared weakness needs.
- Up to five improving partner recommendations.
- One reason and one primary tradeoff per recommendation.
- Up to three additions in the current session.
- Honest no-improvement escape to the advanced browser.

## Deferred

- Branching and path comparison.
- Guided persistence and multi-plan management.
- Species exclusion settings.
- Dedicated guided detail views.
- Complete sets, opponent prediction, and optimal-team claims.
- Analytics, telemetry, and formal usability instrumentation.
