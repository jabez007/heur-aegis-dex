/**
 * Abilities that change a Pokemon's stats.
 *
 * The ability layer elsewhere in this codebase models type immunities and
 * support roles. Neither touches the stat line, so a Huge Power Azumarill was
 * judged on 50 Attack — the number it never fights with. That is not a rounding
 * error for these Pokemon: Huge Power and Pure Power exist precisely to make an
 * otherwise unremarkable stat line viable, so ignoring them filters out the
 * Pokemon the ability was designed to carry.
 *
 * ## Only unconditional abilities are applied
 *
 * Most stat abilities need something to happen first — weather, terrain, a
 * status, a consumed item, an ally. Applying those unconditionally would claim
 * a Chlorophyll Venusaur is always at doubled Speed, which is true only in sun
 * that something else has to set. They are recorded here with `applied: false`
 * so the omission is visible, and so nobody has to rediscover which abilities
 * were considered.
 *
 * An ability is applied only when it needs no setup whatsoever: the Pokemon
 * switches in and the stat is already changed.
 *
 * ## These are base-stat multipliers, not damage multipliers
 *
 * Abilities that scale a *move's* power rather than a stat — Transistor,
 * Steelworker, Dragon's Maw — are deliberately absent. They do not belong in a
 * stat line, and folding them in would double-count against move coverage.
 */

import type { PokemonStats } from './pokedexTypes';

export type ModifiableStat = 'attack' | 'defense' | 'special-attack' | 'special-defense' | 'speed';

export interface StatAbilityRule {
  /** PokeAPI ability name. */
  readonly ability: string;
  readonly stat: ModifiableStat;
  readonly multiplier: number;
  /** Whether the multiplier is applied, or merely recorded. */
  readonly applied: boolean;
  /** What has to happen first. Absent for the unconditional ones. */
  readonly condition?: string;
  readonly reason: string;
}

/**
 * Enumerated on 2026-07-27 by walking the Regulation M-B roster's abilities,
 * so the conditional entries are the ones a legal Pokemon actually carries
 * rather than a general catalogue.
 */
export const STAT_ABILITIES: readonly StatAbilityRule[] = [
  {
    ability: 'huge-power',
    stat: 'attack',
    multiplier: 2,
    applied: true,
    reason:
      'Doubles Attack from the moment the Pokemon is on the field, with no setup and no drawback. Azumarill, '
      + 'Diggersby, Medicham and Mega Mawile are all built around it — Azumarill fights at 100 Attack, not 50.'
  },
  {
    ability: 'pure-power',
    stat: 'attack',
    multiplier: 2,
    applied: true,
    reason:
      'Identical in effect to Huge Power; a separate ability only for flavour. Medicham is a 60 Attack Pokemon '
      + 'that hits at 120, and is otherwise unremarkable enough to be filtered out entirely.'
  },
  {
    ability: 'fur-coat',
    stat: 'defense',
    multiplier: 2,
    applied: true,
    reason: 'Doubles Defense unconditionally. Furfrou is a 60 Defense Pokemon that takes physical hits like a 120.'
  },
  {
    ability: 'ice-scales',
    stat: 'special-defense',
    multiplier: 2,
    applied: true,
    reason:
      'Doubles Special Defense unconditionally. No Regulation M-B species carries it today, but it is the exact '
      + 'defensive counterpart to Fur Coat and would be an oversight rather than a decision if omitted.'
  },
  {
    ability: 'hustle',
    stat: 'attack',
    multiplier: 1.5,
    applied: true,
    reason:
      'Raises Attack by half with no setup, so it is applied — but it also cuts physical accuracy to 80%, which a '
      + 'stat line cannot express. The effective gain is nearer 1.2x than 1.5x, so Hustle Pokemon read slightly '
      + 'stronger here than they play.'
  },

  // Recorded, not applied. Each needs something to happen first.
  {
    ability: 'swift-swim',
    stat: 'speed',
    multiplier: 2,
    applied: false,
    condition: 'rain',
    reason: 'Needs rain on the field, which something else has to set and an opponent can replace.'
  },
  {
    ability: 'chlorophyll',
    stat: 'speed',
    multiplier: 2,
    applied: false,
    condition: 'harsh sunlight',
    reason:
      'Needs sun, exactly as Swift Swim needs rain. The tool already tracks weather setters as a support role, so '
      + 'this becomes answerable once a team is known — but not as a property of the Pokemon on its own.'
  },
  {
    ability: 'sand-rush',
    stat: 'speed',
    multiplier: 2,
    applied: false,
    condition: 'sandstorm',
    reason:
      'Needs a sandstorm, which in Champions means bringing something to set it. Doubling Speed for an Excadrill '
      + 'that may never see sand would overstate exactly the Pokemon a sand team is built to enable.'
  },
  {
    ability: 'slush-rush',
    stat: 'speed',
    multiplier: 2,
    applied: false,
    condition: 'snow',
    reason:
      'Needs snow on the field, which something else must set. Beartic also carries Swift Swim, so its Speed '
      + 'depends on which weather a team actually runs — not on Beartic.'
  },
  {
    ability: 'surge-surfer',
    stat: 'speed',
    multiplier: 2,
    applied: false,
    condition: 'electric terrain',
    reason:
      'Needs Electric Terrain, which something else has to set and which any other terrain setter can overwrite '
      + 'mid-battle. A terrain is even less durable than weather.'
  },
  {
    ability: 'unburden',
    stat: 'speed',
    multiplier: 2,
    applied: false,
    condition: 'held item consumed',
    reason: 'Needs the held item gone, so it is a mid-battle state rather than a property of the Pokemon.'
  },
  {
    ability: 'guts',
    stat: 'attack',
    multiplier: 1.5,
    applied: false,
    condition: 'user is statused',
    reason: 'Needs a status condition, usually self-inflicted with an item, and comes with that status attached.'
  },
  {
    ability: 'quick-feet',
    stat: 'speed',
    multiplier: 1.5,
    applied: false,
    condition: 'user is statused',
    reason:
      'Needs a status condition, same as Guts, and carries the same hidden cost: the burn or poison that switches '
      + 'it on is itself a liability the stat line cannot show.'
  },
  {
    ability: 'solar-power',
    stat: 'special-attack',
    multiplier: 1.5,
    applied: false,
    condition: 'harsh sunlight',
    reason: 'Needs sun, and drains HP each turn while it is up.'
  },
  {
    ability: 'flower-gift',
    stat: 'attack',
    multiplier: 1.5,
    applied: false,
    condition: 'harsh sunlight',
    reason: 'Needs sun. Also raises Special Defense, which a single-stat rule could not express anyway.'
  },
  {
    ability: 'plus',
    stat: 'special-attack',
    multiplier: 1.5,
    applied: false,
    condition: 'ally with Plus or Minus',
    reason: 'Needs a specific partner on the field, so it is a property of the pair rather than the Pokemon.'
  },
  {
    ability: 'minus',
    stat: 'special-attack',
    multiplier: 1.5,
    applied: false,
    condition: 'ally with Plus or Minus',
    reason:
      'Needs a specific partner, same as Plus, and only ever in doubles. Manectric and Ampharos would have to be '
      + 'brought together for either to see it.'
  }
] as const;

/** Date the roster was walked for stat-modifying abilities. */
export const VERIFIED_ON = '2026-07-27';

const APPLIED_BY_ABILITY = new Map(
  STAT_ABILITIES.filter((rule) => rule.applied).map((rule) => [rule.ability, rule])
);

/**
 * Returns the rule applied for an ability, if any.
 *
 * @param abilityName PokeAPI ability name.
 * @returns The rule, or undefined when the ability does not change stats unconditionally.
 */
export function getStatAbility(abilityName: string | undefined | null): StatAbilityRule | undefined {
  return abilityName ? APPLIED_BY_ABILITY.get(abilityName) : undefined;
}

/**
 * Reports whether an ability is recorded here at all, applied or not.
 *
 * @param abilityName PokeAPI ability name.
 * @returns Whether the table has considered this ability.
 */
export function hasStatAbilityRule(abilityName: string | undefined | null): boolean {
  return !!abilityName && STAT_ABILITIES.some((rule) => rule.ability === abilityName);
}

/**
 * Applies every unconditional stat ability among the supplied names.
 *
 * Returns the original object when nothing applies, so callers can compare by
 * identity to tell "unmodified" from "modified to the same numbers".
 *
 * Multipliers round down, matching how the games truncate stat calculations.
 *
 * @param stats Base stats as published.
 * @param abilityNames Abilities to consider — one name to score a specific choice, or all of them to ask what the Pokemon is capable of.
 * @returns The stats the Pokemon actually fights with.
 */
export function getEffectiveStats(
  stats: PokemonStats,
  abilityNames: readonly (string | undefined)[]
): PokemonStats {
  const rules = abilityNames
    .map((name) => getStatAbility(name))
    .filter((rule): rule is StatAbilityRule => !!rule);

  if (rules.length === 0) return stats;

  const effective: PokemonStats = { ...stats };
  rules.forEach((rule) => {
    effective[rule.stat] = Math.floor((stats[rule.stat] || 0) * rule.multiplier);
  });
  return effective;
}

/**
 * Names the ability responsible for a modified stat line, for disclosure.
 *
 * @param abilityNames Abilities in play.
 * @returns The first applied ability found, or undefined.
 */
export function getStatAbilityName(
  abilityNames: readonly (string | undefined)[]
): string | undefined {
  return abilityNames.find((name) => getStatAbility(name)) || undefined;
}

/**
 * Sums a stat line.
 *
 * @param stats Stats to total.
 * @returns The base stat total.
 */
export function totalStats(stats: PokemonStats): number {
  return Object.values(stats).reduce((total, stat) => total + (Number(stat) || 0), 0);
}
