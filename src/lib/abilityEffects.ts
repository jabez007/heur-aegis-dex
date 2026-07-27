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
 * ## Multipliers are deliberately small
 *
 * These scale a component of `scoreMemberQuality`, which is already bounded to
 * 0..1 and compresses hard at the top. A 1.25 on bulk is a large effect in that
 * space, not a small one. They are sized to reorder Pokemon whose quality is
 * close — the same budget discipline `CANDIDATE_WEIGHTS` documents — and like
 * every other weight here they are reasoned rather than measured.
 *
 * Enumerated on 2026-07-27 by walking the Regulation M-B roster's abilities, so
 * the recorded entries are ones a legal Pokemon actually carries.
 */

export type QualityComponent = 'bulk' | 'offense';

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
 * Multipliers to apply to each half of member quality.
 *
 * @param abilityName Ability selected for battle.
 * @returns Bulk and offense multipliers, both 1 when nothing applies.
 */
export function getQualityMultipliers(
  abilityName: string | undefined | null
): { bulk: number; offense: number } {
  const rule = getAbilityQualityEffect(abilityName);
  if (!rule) return { bulk: 1, offense: 1 };
  return {
    bulk: rule.component === 'bulk' ? rule.multiplier : 1,
    offense: rule.component === 'offense' ? rule.multiplier : 1
  };
}
