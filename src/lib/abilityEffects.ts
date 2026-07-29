/**
 * Abilities that change how much a Pokemon's stat line is worth.
 *
 * Three ability layers already exist here, and between them they miss a lot.
 * `pokedexAbilities` models type immunities, `abilityRoles` models field and
 * partner support, `statAbilities` models multipliers on the printed stats.
 * Nothing modelled Unaware, Multiscale, Sturdy or Thick Fat — abilities that do
 * not change a stat, do not grant an immunity and do not help a partner, but
 * plainly change how long a Pokemon lasts or how hard it hits.
 *
 * That gap had a visible cost. Skeledirge ranked below Typhlosion-Hisui despite
 * being the better competitive Pokemon: identical Fire/Ghost typing, so the
 * comparison came down to raw stats, and everything that makes Skeledirge good —
 * Unaware, and a signature move that snowballs — was worth exactly zero.
 *
 * ## What is applied, and what is not
 *
 * The bar is the same one `statAbilities` uses: the effect must land without
 * setup, without a specific moveset, and without the opponent cooperating.
 * Abilities that fail it are recorded with the condition that rules them out,
 * so their absence reads as a decision rather than an oversight.
 *
 * Move-dependent abilities are the largest excluded group, and deliberately so.
 * Prankster is among the strongest abilities in the format, but its value is
 * entirely in *which* moves it makes priority — and moves are not modelled here
 * beyond coverage types. Crediting it would be scoring a moveset this tool
 * cannot see.
 *
 * ## Opponent-dependent abilities, and why this file stops at one
 *
 * Mold Breaker, Unnerve, Pressure and their kin are worth nothing until an
 * opponent brings something for them to act on. They are not blocked by missing
 * data the way Prankster is — the pool this tool already scores is a reasonable
 * stand-in for the opponent, so their expected value can be *measured*. Mold
 * Breaker is recorded below with that measurement, and it came to 0.0046 against
 * a random legal Pokemon, a seventh of the smallest applied entry.
 *
 * The size is the reason it is rejected, but the category is worth a warning of
 * its own. Crediting any of these turns this file into a matchup model, and a
 * matchup model does not stop at one ability: Defiant answers Intimidate, Good as
 * Gold answers status, Unnerve answers berries, and each of those is a
 * *conditional* claim about a team that has not been chosen yet. This tool scores
 * the roster in front of it. Opening that door is a project, not an entry, and it
 * should be a decision made on purpose rather than one arrived at by adding a
 * seventh reasonable-looking multiplier.
 *
 * ## Multipliers are deliberately small
 *
 * These scale a component of `scoreMemberQuality`, which is already bounded to
 * 0..1 and compresses hard at the top. A 1.25 on bulk is a large effect in that
 * space, not a small one. They are sized to reorder Pokemon whose quality is
 * close — the same budget discipline `CANDIDATE_WEIGHTS` documents — and like
 * every other weight here they are reasoned rather than measured.
 *
 * ## Why speed is scored here rather than in statAbilities
 *
 * `statAbilities` applies a multiplier only when the Pokemon switches in and the
 * stat is *already* changed. Speed Boost fails that bar outright — turn one it is
 * a Pokemon at its printed Speed, and the ability has done nothing. It passes the
 * bar this file uses instead, which asks whether the effect lands without setup,
 * without a moveset assumption and without the opponent cooperating. Staying on
 * the field is not setup; it is the default.
 *
 * The distinction is worth keeping sharp, because the two files answer different
 * questions. `statAbilities` says what the stat *is*, and a Huge Power Azumarill
 * really does have 100 Attack from the first turn. This file says what a stat
 * line is *worth*, which is where an effect that accrues belongs.
 *
 * Enumerated on 2026-07-27 by walking the Regulation M-B roster's abilities, so
 * the recorded entries are ones a legal Pokemon actually carries.
 */

export type QualityComponent = 'bulk' | 'offense' | 'speed';

export interface AbilityQualityRule {
  /** PokeAPI ability name. */
  readonly ability: string;
  /** Which half of member quality the ability changes. */
  readonly component: QualityComponent;
  readonly multiplier: number;
  /** Whether the multiplier is applied, or merely recorded. */
  readonly applied: boolean;
  /** What has to happen first. Absent for the unconditional ones. */
  readonly condition?: string;
  readonly reason: string;
}

export const ABILITY_QUALITY_EFFECTS: readonly AbilityQualityRule[] = [
  {
    ability: 'multiscale',
    component: 'bulk',
    multiplier: 1.25,
    applied: true,
    reason:
      'Halves every hit taken at full HP. Dragonite is brought partly because it can switch in on almost anything '
      + 'once, which is a durability effect no stat shows. Sized below a true doubling because it lapses after the '
      + 'first hit and cannot be recovered mid-battle.'
  },
  {
    ability: 'unaware',
    component: 'bulk',
    multiplier: 1.18,
    applied: true,
    reason:
      'Ignores the opponent\'s stat boosts entirely, so a Pokemon that would otherwise be swept through holds its '
      + 'ground. Skeledirge and Clefable both trade on it. The effect is unconditional; how much it is worth depends '
      + 'on how much setup the opponent brought, which is why it is not sized higher.'
  },
  {
    ability: 'disguise',
    component: 'bulk',
    multiplier: 1.15,
    applied: true,
    reason:
      'Absorbs one hit outright, whatever it was. Unconditional and needs no support, and the closest thing in the '
      + 'game to a free turn.'
  },
  {
    ability: 'magic-guard',
    component: 'bulk',
    multiplier: 1.14,
    applied: true,
    reason:
      'Removes every source of indirect damage — weather, status, hazards, recoil. Clefable outlasts things it has '
      + 'no business outlasting because none of the chip damage that wears others down applies.'
  },
  {
    ability: 'thick-fat',
    component: 'bulk',
    multiplier: 1.12,
    applied: true,
    reason:
      'Halves both Fire and Ice damage, two of the most common attacking types. Unusual among resist abilities in '
      + 'covering two types at once, which is why it is here rather than treated as a near-immunity.'
  },
  {
    ability: 'purifying-salt',
    component: 'bulk',
    multiplier: 1.12,
    applied: true,
    reason:
      'Blocks all status and halves incoming Ghost damage. Status immunity is worth real bulk in a format where '
      + 'burn and paralysis are how bulky Pokemon are answered.'
  },
  {
    ability: 'water-bubble',
    component: 'bulk',
    multiplier: 1.10,
    applied: true,
    reason:
      'Halves Fire damage and blocks burn, on top of doubling the holder\'s Water moves. Only the defensive half is '
      + 'credited here; the offensive half depends on carrying a Water move, which is a moveset assumption.'
  },
  {
    ability: 'sturdy',
    component: 'bulk',
    multiplier: 1.08,
    applied: true,
    reason:
      'Guarantees surviving one hit from full HP. Real but narrow: it does nothing once chipped, and the Pokemon that '
      + 'carry it are usually bulky enough that the guarantee is redundant against everything but a clean OHKO.'
  },
  {
    ability: 'solid-rock',
    component: 'bulk',
    multiplier: 1.10,
    applied: true,
    reason:
      'Reduces super-effective damage by a quarter, which is exactly the damage that decides matches. Applies to '
      + 'whatever the Pokemon happens to be weak to, so it needs no prediction.'
  },
  {
    ability: 'adaptability',
    component: 'offense',
    multiplier: 1.15,
    applied: true,
    reason:
      'Raises STAB from 1.5x to 2x. It needs no setup and no specific move beyond one of the Pokemon\'s own types, '
      + 'which every attacker runs — the one offensive ability here that does not assume a moveset.'
  },
  {
    ability: 'protean',
    component: 'offense',
    multiplier: 1.12,
    applied: true,
    reason:
      'Retypes the user to the move it is about to use, so an attack that would have been neutral is fired at STAB. '
      + 'Like Adaptability it assumes no particular move — whatever Greninja clicks is the move that gets boosted — '
      + 'which is what separates it from Sheer Force and Technician below.\n\n'
      + 'Sized *below* Adaptability rather than above it, for two reasons. Recent generations restrict the retype to '
      + 'once per switch-in, turning it from an every-turn multiplier into roughly one free STAB per entry, and it is '
      + 'not settled which behaviour Champions uses. The retype also overwrites the defensive typing this tool scores '
      + 'statically, usually costing resistances — a real downside that nothing here charges for. Both unknowns point '
      + 'the same way, so the multiplier is set where being wrong is cheap.'
  },
  {
    ability: 'libero',
    component: 'offense',
    multiplier: 1.12,
    applied: true,
    reason:
      'Identical in effect to Protean; a separate ability only for flavour, and sized identically. No Regulation M-B '
      + 'species carries it today, but omitting it would be an oversight rather than a decision — the same reasoning '
      + 'that keeps Ice Scales in the stat-ability table.'
  },
  {
    ability: 'speed-boost',
    component: 'speed',
    multiplier: 1.4,
    applied: true,
    reason:
      'Raises Speed a stage at the end of every turn, with no setup, no item and nothing asked of the opponent. By '
      + 'turn two the holder is at 1.5x and climbing, and Speed is the stat that decides who acts at all.\n\n'
      + 'Set at 1.4 rather than the 1.5 a second turn would imply, because turn one collects nothing — the boost '
      + 'lands at end of turn — and the Pokemon carrying it are frail enough that turn four is not a plan. The '
      + 'already-fast carriers get proportionally less than the slow ones, since the term clamps at its observed '
      + 'ceiling: Espathra at 105 base is near the top of the range before the ability applies, while Blaziken at 80 '
      + 'has room to climb. That is the right shape. Speed past the point where you outrun the field buys nothing.'
  },

  // Recorded, not applied.
  {
    ability: 'prankster',
    component: 'bulk',
    multiplier: 1,
    applied: false,
    condition: 'carrying status moves worth using first',
    reason:
      'Among the strongest abilities in the format, and still not scoreable here: its entire value is which moves it '
      + 'makes priority. Whimsicott and Grimmsnarl are built on Tailwind, screens and Encore, none of which this tool '
      + 'models. Crediting it would be scoring a moveset that cannot be seen.'
  },
  {
    ability: 'regenerator',
    component: 'bulk',
    multiplier: 1.2,
    applied: false,
    condition: 'switching out',
    reason:
      'Restores a third of HP on switch, which is substantial across a game but depends on having somewhere to switch '
      + 'and a turn to spend. That is a property of how the team is piloted rather than of the Pokemon, and this '
      + 'ranking scores Pokemon.'
  },
  {
    ability: 'natural-cure',
    component: 'bulk',
    multiplier: 1.1,
    applied: false,
    condition: 'switching out while statused',
    reason:
      'Needs both a status to clear and a switch to spend clearing it. Same objection as Regenerator, with a second '
      + 'condition on top.'
  },
  {
    ability: 'marvel-scale',
    component: 'bulk',
    multiplier: 1.2,
    applied: false,
    condition: 'user is statused',
    reason:
      'Raises Defense by half only while statused, which means hoping the opponent does something. Milotic is a fine '
      + 'Pokemon without it; crediting it unconditionally would credit an opponent\'s mistake.'
  },
  {
    ability: 'poison-heal',
    component: 'bulk',
    multiplier: 1.25,
    applied: false,
    condition: 'user is poisoned, usually via a held item',
    reason:
      'Very strong, and entirely dependent on an item slot and a turn spent setting it up. That is a build decision '
      + 'this tool does not model.'
  },
  {
    ability: 'fluffy',
    component: 'bulk',
    multiplier: 1,
    applied: false,
    condition: 'attacker makes contact and is not Fire',
    reason:
      'Halves contact damage but doubles Fire damage. The net worth depends entirely on what is attacking, so a '
      + 'single multiplier would be wrong in both directions.'
  },
  {
    ability: 'sheer-force',
    component: 'offense',
    multiplier: 1.15,
    applied: false,
    condition: 'carrying moves with secondary effects',
    reason:
      'Boosts only moves with secondary effects, so its worth is set by the moveset. Same objection as Prankster.'
  },
  {
    ability: 'technician',
    component: 'offense',
    multiplier: 1.15,
    applied: false,
    condition: 'carrying moves of 60 base power or less',
    reason:
      'Boosts only weak moves, which is a deliberate moveset choice and directly at odds with the power floor the '
      + 'coverage table already applies.'
  },
  {
    ability: 'tough-claws',
    component: 'offense',
    multiplier: 1.1,
    applied: false,
    condition: 'carrying contact moves',
    reason: 'Moveset-dependent, and the coverage table records move types rather than whether they make contact.'
  },
  {
    ability: 'mold-breaker',
    component: 'offense',
    multiplier: 1.01,
    applied: false,
    condition: 'the opponent brought an ability worth ignoring',
    reason:
      'The one ability here rejected on measurement rather than on principle, and the multiplier records what it '
      + 'measured. Unlike Prankster it needs no moveset, and unlike Marvel Scale it does not need the opponent to '
      + 'blunder — only to have brought a Pokemon whose ability changes how a move lands. That is a fair condition, '
      + 'and the pool this tool already scores is a legitimate stand-in for the opponent, so the expected value is '
      + 'computable rather than guesswork.\n\n'
      + 'Computed 2026-07-28 across all 208 legal species: 20.7% carry a selected ability Mold Breaker would turn '
      + 'off, and those abilities are worth a mean 0.0224 of member quality — an expected **0.0046**. Sturdy, the '
      + 'smallest applied entry above, is worth roughly 0.033. Mold Breaker is a seventh of the weakest thing in '
      + 'this table, because the abilities it meets most often are the cheap ones (Sturdy seven times, Flash Fire '
      + 'six) while the ones worth taking off the field are singletons — one Dragonite at 0.0900, one Furfrou at '
      + '0.0816.\n\n'
      + 'The variance is the real objection. 79% of the time it does nothing at all, and an average that small '
      + 'bought at that spread is not a reason to prefer a Pokemon; it is a coin-flip dressed as a rating.'
  }
] as const;

/** Date the roster was walked for these abilities. */
export const VERIFIED_ON = '2026-07-27';

const APPLIED_BY_ABILITY = new Map(
  ABILITY_QUALITY_EFFECTS.filter((rule) => rule.applied).map((rule) => [rule.ability, rule])
);

/**
 * Returns the quality multiplier applied for an ability, if any.
 *
 * @param abilityName PokeAPI ability name.
 * @returns The rule, or undefined when the ability changes nothing this models.
 */
export function getAbilityQualityEffect(
  abilityName: string | undefined | null
): AbilityQualityRule | undefined {
  return abilityName ? APPLIED_BY_ABILITY.get(abilityName) : undefined;
}

/**
 * Reports whether an ability is recorded here at all, applied or not.
 *
 * @param abilityName PokeAPI ability name.
 * @returns Whether the table has considered this ability.
 */
export function hasAbilityQualityRule(abilityName: string | undefined | null): boolean {
  return !!abilityName && ABILITY_QUALITY_EFFECTS.some((rule) => rule.ability === abilityName);
}

/**
 * Multipliers to apply to each component of member quality.
 *
 * @param abilityName Ability selected for battle.
 * @returns Bulk, offense and speed multipliers, each 1 when nothing applies.
 */
export function getQualityMultipliers(
  abilityName: string | undefined | null
): Record<QualityComponent, number> {
  const neutral: Record<QualityComponent, number> = { bulk: 1, offense: 1, speed: 1 };
  const rule = getAbilityQualityEffect(abilityName);
  if (!rule) return neutral;
  return { ...neutral, [rule.component]: rule.multiplier };
}
