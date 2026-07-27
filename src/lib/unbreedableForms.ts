/**
 * Varieties that cannot be bred, where the species can.
 *
 * The scan's breedable-only rule reads `/pokemon-species`: egg groups, and the
 * legendary and mythical flags. Those are species-level properties, and for
 * almost every Pokemon that is the right place to ask — a species is breedable
 * or it is not, and its varieties inherit the answer.
 *
 * Some varieties do not inherit it. Floette-Eternal is a variety of a perfectly
 * ordinary Fairy-egg-group species, and asking the species returns "breedable"
 * for a form that has never been obtainable in any released game. Because the
 * regulation filter is species-keyed too, and because base Floette's 371 base
 * stat total fails the stat floor, the browser showed exactly one Floette: the
 * one nobody can have.
 *
 * PokeAPI models no variety-level breedability or obtainability. There is no
 * field to read and no signal to derive one from — the previously considered
 * proxy, "has no moves in the `champions` version group", conflates a form that
 * does not exist with a form PokeAPI has not filled in yet, and would delete
 * legitimate Pokemon (see the note in `pokemonEntry.collapseIndistinctVarieties`).
 * So this is recorded data, and like `battleForms.ts` it records the varieties
 * considered and *kept* alongside the excluded ones. A bare absence cannot be
 * told apart from an oversight.
 *
 * ## Scope
 *
 * Only varieties that survive every other filter are worth recording. A form
 * that is battle-only, Mega-gated, below the stat floors, or belongs to a
 * species that is already unbreedable never reaches this check, so listing it
 * here would imply a decision that nothing depends on.
 *
 * ## Staleness
 *
 * This is a whitelist of exclusions, which means it goes quiet rather than loud
 * when a new regulation adds a species carrying an event-only form. `VERIFIED_ON`
 * records when the roster was last walked so the gap is visible instead of
 * assumed away. Re-walk it whenever `REGULATION_LIST` gains an entry.
 */

export interface UnbreedableFormRule {
  /** PokeAPI `pokemon` variety name. Keyed on the variety, not the species. */
  readonly variety: string;
  /** PokeAPI `pokemon-species` name the variety belongs to. */
  readonly species: string;
  /**
   * Whether a player can breed this variety. `false` drops it from scans;
   * `true` records a variety that was considered and deliberately kept.
   */
  readonly breedable: boolean;
  /** Why, in terms of how the variety is obtained and whether it reproduces. */
  readonly reason: string;
}

/**
 * Every non-default variety of a Regulation M-B legal species that clears the
 * scan's other filters, where breedability is not what the species reports.
 *
 * Enumerated from PokeAPI on 2026-07-27 by walking the M-B roster's varieties
 * and keeping those that pass `isRegisterableForm` with `allowMegas: false` and
 * the default stat floors. That pass yielded 34 varieties, 30 of them distinct
 * enough to survive `collapseIndistinctVarieties`. The overwhelming majority are
 * regional forms, Rotom appliances, Gourgeist sizes and gender forms, all of
 * them ordinary and breedable; only the entries below needed a decision.
 */
export const UNBREEDABLE_FORMS: readonly UnbreedableFormRule[] = [
  {
    variety: 'floette-eternal',
    species: 'floette',
    breedable: false,
    reason:
      'AZ\'s Floette has never been obtainable in a released game — it exists in the game data and in PokeAPI, and '
      + 'nowhere a player can reach. There is nothing to breed from. It survived every other filter because the species '
      + 'is an ordinary Fairy-egg-group Pokemon and its 551 base stat total clears the floors comfortably, while base '
      + 'Floette at 371 does not, so the only Floette the browser showed was this one.'
  },
  {
    variety: 'greninja-battle-bond',
    species: 'greninja',
    breedable: false,
    reason:
      'Battle Bond Greninja is distribution-only, and the ability does not pass to offspring: breeding one yields '
      + 'Torrent or Protean. A player cannot produce this variety, only receive it. It survives collapsing because its '
      + 'lone ability differs from the registered Greninja\'s pair, so it reads as a distinct Pokemon rather than a '
      + 'duplicate. Note that `battleForms.ts` already rejects `greninja-ash` for a different reason — that form is '
      + 'unreachable in the current generation; this one is reachable and simply cannot be bred.'
  },
  {
    variety: 'basculegion-female',
    species: 'basculegion',
    breedable: true,
    reason:
      'A gender form, obtained and bred exactly as the male is. Kept as its own entry because the stat spreads differ '
      + 'meaningfully — 112 Attack / 80 Special Attack against 92 / 100 — which the damage-class split reads as two '
      + 'different attackers.'
  },
  {
    variety: 'meowstic-female',
    species: 'meowstic',
    breedable: true,
    reason:
      'A gender form with an identical stat line, bred normally. Kept because Prankster and Competitive are not the '
      + 'same Pokemon to build around, which is the same reasoning `collapseIndistinctVarieties` applies.'
  },
  {
    variety: 'lycanroc-dusk',
    species: 'lycanroc',
    breedable: true,
    reason:
      'The weakest entry in this table, recorded so the judgement is visible rather than silent. Dusk Form requires a '
      + 'Rockruff with Own Tempo, which was only ever event-distributed — but unlike Battle Bond, Own Tempo passes to '
      + 'offspring, so one event Rockruff reproduces indefinitely. That makes it obtainable-then-breedable rather than '
      + 'distribution-only, which is the line this table draws. If that reading is wrong, this is the entry to revisit.'
  }
] as const;

/** Date the M-B roster's varieties were last walked against PokeAPI. */
export const VERIFIED_ON = '2026-07-27';

/**
 * Distinct species across every regulation at the time of that walk.
 *
 * The date alone is not enough to hold this table honest. A date is a claim
 * about when someone looked; this is a claim about *what they looked at*, and it
 * is the one that catches a new regulation quietly widening the roster under a
 * table nobody re-walked. `unbreedableForms.test.ts` asserts both, because they
 * fail on different mistakes: the count catches species added without touching
 * dates, the date catches a roster re-verified against a PokeAPI that may have
 * gained varieties for species already on it.
 *
 * When either assertion fires, re-walk the roster — the audit is a filtered pass
 * over each species' varieties, keeping those that clear `isRegisterableForm`
 * with `allowMegas: false` and the default stat floors — and update both values
 * together with whatever the walk turned up.
 */
export const VERIFIED_SPECIES_COUNT = 208;

export const SOURCES: readonly string[] = [
  'https://pokeapi.co/api/v2/pokemon-species/',
  'https://bulbapedia.bulbagarden.net/wiki/List_of_Pok%C3%A9mon_with_form_differences',
  'https://bulbapedia.bulbagarden.net/wiki/Event_Pok%C3%A9mon'
];

/**
 * Variety names the scan must drop. Derived from the table so the reasoning and
 * the behaviour cannot drift apart.
 */
export const UNBREEDABLE_VARIETIES: ReadonlySet<string> = new Set(
  UNBREEDABLE_FORMS.filter((rule) => !rule.breedable).map((rule) => rule.variety)
);

/**
 * Reports whether a variety can be bred, given its species already can.
 *
 * This answers only the variety-level question. The species-level checks — egg
 * groups, legendary and mythical — are applied separately and neither replaces
 * the other, so a variety returning `true` here is not thereby breedable.
 *
 * @param varietyName PokeAPI `pokemon` variety name.
 * @returns Whether the variety is breedable. Unrecorded varieties return `true`,
 *          because the table is a list of exceptions and the species-level rule
 *          is the default answer.
 */
export function isVarietyBreedable(varietyName: string): boolean {
  return !UNBREEDABLE_VARIETIES.has(varietyName);
}

/**
 * Reports whether a variety is recorded here at all, excluded or kept.
 *
 * @param varietyName PokeAPI `pokemon` variety name.
 * @returns Whether the table has considered this variety.
 */
export function hasUnbreedableFormRule(varietyName: string): boolean {
  return UNBREEDABLE_FORMS.some((rule) => rule.variety === varietyName);
}
