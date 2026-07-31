# Guided Partner Discovery

## Problem Statement

Casual players can choose favorite Pokemon but often cannot tell which shared
weakness, missing resistance, unanswered attacking type, or unfilled modeled
role to address next. They need a way to explore useful partners without the
product pretending to predict matches or build complete competitive sets.

## Recommended Direction

Build a format-aware guided planning mode for singles and doubles. The player
locks one to three favorites; the product identifies the most important
structural need, presents up to five partners with plain-language reasons and
tradeoffs, and repeats after each addition. A structural need is a traceable gap
such as a shared weakness, missing resistance, unanswered attacking type, or
unfilled modeled role. Favorites are never replaced.

The player may finish after adding two partners; the guided MVP stops after the
third. At one decision, the
player can fork into two paths and compare how each changes strengths, risks,
and remaining needs. Both paths persist locally for later return.

The product promise is: **Build around the Pokemon you love, with guidance you
can understand.**

## Key Assumptions To Validate

- [ ] Casual players understand recommendations better when framed as one
  current need rather than a global score. Test whether at least 70% of
  usability participants can explain one recommendation tradeoff unaided.
- [ ] Up to five explained candidates provide enough agency without recreating the
  existing browser. Test whether at least 80% of participants add two partners
  within five minutes.
- [ ] Singles and doubles can share one flow while using format-specific
  recommendations and language. Test both formats in every usability round.
- [ ] Comparing two paths creates useful repeated planning behavior. Test
  whether at least 60% of participants can create and compare two paths without
  assistance.
- [ ] Structural guidance remains useful without moves, items, EVs, Tera
  choices, or opponent prediction. Ask participants whether any omitted layer
  prevented a partner decision.

## MVP Scope

- Choose singles or doubles.
- Lock one to three favorite Pokemon.
- Show one prioritized structural need at a time.
- Present five eligible partner candidates when available; otherwise present
  every eligible candidate and explain why the list is shorter.
- Allow the player to finish after two additions and stop guided additions after
  the third.
- Fork once and compare two paths.
- Persist both paths locally.
- Record non-identifying local funnel counters for usability evaluation.

## Not Doing (And Why)

- Complete moves, items, EVs, or Tera sets: the current model does not contain
  enough facts to make those recommendations honestly.
- Matchup win prediction: structural heuristics are not calibrated win
  probabilities.
- Automatic replacement of favorites: preserving player ownership is part of
  the core promise.
- Unlimited branch trees: two paths test the comparison value without building
  a version-control system.
- Accounts, cloud sync, or sharing: local persistence is enough to test the
  planning loop.
- A guaranteed optimal team: generation is heuristic and should be presented as
  decision support.
- Replacing the existing advanced browser and workbench: the guided mode is a
  focused entry path that can reuse those capabilities.

## Open Questions

- Which structural needs can be translated into casual language without losing
  their mechanical meaning?
- Should a recommendation explain only the need it addresses, or also disclose
  every major risk it introduces?
- How should two paths be compared when one has more filled slots than the
  other?
- What local event summary should a usability participant be able to export or
  report without sending telemetry automatically?
