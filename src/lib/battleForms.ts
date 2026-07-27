/**
 * Battle-only forms a Pokemon is rated on.
 *
 * Some Pokemon register as one form and fight as another. Palafin is the clear
 * case: it is registered as Palafin-Zero, but Zero to Hero converts it the first
 * time it leaves the field and never converts back, so every turn it actually
 * battles is spent as Palafin-Hero — a 193-point stat swing. Scoring the
 * registered form there describes a Pokemon that never takes a turn.
 *
 * The inverse mistake is worse, though. Most battle-only forms are *not* the
 * form a Pokemon fights in: some are transient, some are strictly a downgrade,
 * and some no longer exist in the current generation. Rating those on the battle
 * form would inflate the very Pokemon whose ratings the tool exists to compare.
 *
 * So this is a whitelist, not a rule. Each species is recorded with a decision
 * and the reason for it, including the ones deliberately left alone — a bare
 * absence cannot be told apart from an oversight, and the next person to read
 * this needs to know Aegislash was considered and rejected rather than missed.
 *
 * ## Conditions a merged form must satisfy
 *
 * 1. **The trigger is an ability the registered form actually has.** A form the
 *    Pokemon cannot reach in the current generation is not a form it fights in.
 * 2. **The typing is unchanged.** The scan indexes Pokemon by type combination,
 *    so a merged form that retyped would be filed under a grouping it does not
 *    belong to. `assertMergedFormsShareTyping` holds this at scan time rather
 *    than trusting the table.
 * 3. **The Pokemon spends the battle in it.** Not "can reach", not "is stronger
 *    in" — spends the battle in.
 */

export interface BattleFormRule {
  /** PokeAPI `pokemon-species` name of the registered Pokemon. */
  readonly species: string;
  /** PokeAPI variety name of the battle-only form. */
  readonly variety: string;
  /**
   * Ability that triggers the change. The registered form must list it, or the
   * form is unreachable and the rule does not apply.
   */
  readonly ability: string;
  /** Whether the Pokemon is rated on `variety` rather than its registered form. */
  readonly merged: boolean;
  /** Why, in the terms of the three conditions above. */
  readonly reason: string;
}

/**
 * Every battle-only form carried by a Regulation M-B legal species, Gigantamax
 * and Mega excluded — those are handled as their own mechanics.
 *
 * Enumerated from PokeAPI on 2026-07-27 by walking the M-B roster's varieties
 * and keeping those whose form resource reports `is_battle_only` without
 * `is_mega`. Recording the rejected entries alongside the merged one is the
 * point: it is the only way to see that the list is complete as of that date.
 */
export const BATTLE_FORMS: readonly BattleFormRule[] = [
  {
    species: 'palafin',
    variety: 'palafin-hero',
    ability: 'zero-to-hero',
    merged: true,
    reason:
      'Zero to Hero converts Palafin the first time it switches out and does not revert for the rest of the battle. '
      + 'Every turn it fights is spent as Hero, which is 193 base stat points above the registered Zero form. '
      + 'Both forms are pure Water, so the typing is unchanged.'
  },
  {
    species: 'aegislash',
    variety: 'aegislash-blade',
    ability: 'stance-change',
    merged: false,
    reason:
      'Stance Change flips forms turn by turn: Blade to attack, Shield otherwise. There is no single form it fights in, '
      + 'so either choice is wrong half the time. The two are near-identical to the scorer anyway — Blade rates about '
      + '0.06 higher on a 0..1 member scale, since the offense it gains is very nearly the bulk it loses — so merging '
      + 'would trade an understated attacker for an understated wall and buy almost nothing.'
  },
  {
    species: 'castform',
    variety: 'castform-sunny',
    ability: 'forecast',
    merged: false,
    reason:
      'Forecast retypes Castform to match the active weather, so the form depends on the rest of the field rather than '
      + 'on Castform. Baking one in would misreport it in every other game state, and it breaks the unchanged-typing '
      + 'condition outright. Weather is already modelled separately as an ability role. Rainy and Snowy are the same case.'
  },
  {
    species: 'greninja',
    variety: 'greninja-ash',
    ability: 'battle-bond',
    merged: false,
    reason:
      'Ash-Greninja does not exist in the current generation: Battle Bond was reworked into a stat boost that does not '
      + 'change form, and the registered Greninja does not list the ability at all. The form is unreachable.'
  },
  {
    species: 'mimikyu',
    variety: 'mimikyu-busted',
    ability: 'disguise',
    merged: false,
    reason:
      'Busted is what Mimikyu becomes after Disguise absorbs a hit, and it is stat-for-stat identical to the registered '
      + 'form. There is nothing to merge; the value of Disguise is the absorbed hit, which stats cannot express.'
  },
  {
    species: 'morpeko',
    variety: 'morpeko-hangry',
    ability: 'hunger-switch',
    merged: false,
    reason:
      'Hunger Switch alternates every turn but changes only the type of Aura Wheel. Stats and typing are identical to '
      + 'the registered form, so there is nothing to merge.'
  }
] as const;

/** Date the table was enumerated from PokeAPI and checked against the mechanics. */
export const VERIFIED_ON = '2026-07-27';

export const SOURCES: readonly string[] = [
  'https://pokeapi.co/api/v2/pokemon-form/',
  'https://bulbapedia.bulbagarden.net/wiki/List_of_Pok%C3%A9mon_with_form_differences'
];

const MERGED_BY_SPECIES = new Map(
  BATTLE_FORMS.filter((rule) => rule.merged).map((rule) => [rule.species, rule])
);

/**
 * Resolves the battle form a Pokemon should be rated on.
 *
 * @param speciesName PokeAPI species name of the registered Pokemon.
 * @param abilityNames Abilities the registered form actually has.
 * @returns The rule to apply, or undefined when the Pokemon is rated as registered.
 */
export function getMergedBattleForm(
  speciesName: string,
  abilityNames: readonly string[]
): BattleFormRule | undefined {
  const rule = MERGED_BY_SPECIES.get(speciesName);
  if (!rule) return undefined;
  // A form whose trigger the Pokemon does not have is a form it cannot reach.
  return abilityNames.includes(rule.ability) ? rule : undefined;
}

/**
 * Reports whether a species is recorded here at all, merged or not.
 *
 * @param speciesName PokeAPI species name.
 * @returns Whether the table has considered this species.
 */
export function hasBattleFormRule(speciesName: string): boolean {
  return BATTLE_FORMS.some((rule) => rule.species === speciesName);
}

/**
 * Guards the unchanged-typing condition at scan time.
 *
 * The scan files Pokemon under type combinations, so a merged form that retyped
 * would be indexed under a grouping it does not belong to and would quietly
 * corrupt every coverage calculation downstream. Rather than trust the table to
 * stay correct as it grows, the scan checks and declines the merge.
 *
 * @param registeredTypes Type names of the registered form.
 * @param battleFormTypes Type names of the battle form.
 * @returns Whether the merge preserves the Pokemon's typing.
 */
export function sharesTyping(
  registeredTypes: readonly string[],
  battleFormTypes: readonly string[]
): boolean {
  if (registeredTypes.length !== battleFormTypes.length) return false;
  const registered = [...registeredTypes].sort();
  const battleForm = [...battleFormTypes].sort();
  return registered.every((type, index) => type === battleForm[index]);
}
