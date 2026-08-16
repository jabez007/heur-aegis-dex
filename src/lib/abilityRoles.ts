/**
 * Doubles support roles granted by abilities.
 *
 * The type model answers "what happens when this attack lands". It cannot see
 * the other half of doubles, where a Pokemon's contribution is often that it
 * makes its *partner* better: dropping the opponents' Attack, pulling attacks
 * away from a frail ally, or setting the field the team is built around.
 *
 * Only abilities are modelled here. Fake Out, Tailwind, Trick Room and the rest
 * of speed control are moves, and this project has no move data yet — see the
 * coverage-move work for where that would come from.
 *
 * Ability names are PokeAPI `ability` names, all verified to resolve on
 * 2026-07-27.
 */

import { getUtilityRoles } from './utilityMoves';

export type AbilityRole =
  | 'intimidate'
  | 'redirection'
  | 'ally-protection'
  | 'weather-setter'
  | 'terrain-setter'
  /**
   * Tailwind and Trick Room. The only role with no ability form in this roster,
   * and the reason the vocabulary grew rather than being reused: speed control
   * is bought with a moveslot or not at all. See `utilityMoveData.ts`.
   */
  | 'speed-control'
  /**
   * Doubles the holder's Speed or its damage while a weather it wants is up.
   * The other half of `weather-setter`, which was scored alone for a long time —
   * see the note above DOUBLES_ABILITIES.
   */
  | 'weather-abuser';

export interface AbilityEffect {
  role: AbilityRole;
  /**
   * Field state the ability creates. Two members setting *different* states of
   * the same kind overwrite each other, which is a build error rather than a
   * missed bonus, so the state is recorded to make the clash detectable.
   */
  fieldState?: string;
  /**
   * The holder takes no damage from its ally's moves. Distinct from resisting
   * them: only this makes a partner's spread move entirely free.
   */
  immuneToAllyMoves?: boolean;
}

/** Every modelled role. */
export const ABILITY_ROLES: readonly AbilityRole[] = [
  'intimidate',
  'redirection',
  'ally-protection',
  'weather-setter',
  'terrain-setter',
  'speed-control',
  'weather-abuser'
];

/**
 * Roles that need an ally on the field to do anything.
 *
 * Redirection pulls attacks away from a partner and ally protection blunts
 * damage aimed at one. In singles there is no partner, so crediting a team for
 * either would reward a capability the format cannot use. Intimidate and the
 * field setters work the same in both formats.
 */
export const DOUBLES_ONLY_ROLES: readonly AbilityRole[] = ['redirection', 'ally-protection'];

/**
 * Roles whose payoff depends on the rest of the team rather than on the holder.
 *
 * Intimidate drops the opponent's Attack the moment its holder switches in, and
 * redirection pulls attacks off whatever partner happens to be beside it. A
 * weather or terrain setter does neither: it changes the field, and that is
 * worth nothing until something on the team wants the field changed. Drought on
 * Ninetales is the whole reason to bring it *and* worth zero without the sun
 * abusers behind it.
 *
 * The distinction matters when ranking a Pokemon on its own, where a setter's
 * payoff has not happened yet. Team scoring credits these properly through its
 * own support-role synergy term, which is the right place for it.
 */
export const TEAM_DEPENDENT_ROLES: readonly AbilityRole[] = [
  'weather-setter',
  'terrain-setter',
  // Setting Tailwind helps whatever is behind it, not the setter — the same
  // argument that puts the field setters here. Trick Room is the sharper case:
  // it is worth less than nothing to a team that is not built slow.
  'speed-control',
  // The mirror of the setters, and it has to take the same discount for the
  // same reason: Sand Rush is the whole point of Excadrill and worth nothing
  // without something putting sand up.
  'weather-abuser'
];

/**
 * How much of a solo support bonus a team-dependent role earns.
 *
 * Not zero: the solo ranking decides which Pokemon the roster search looks at
 * in the first place, and a setter pruned there can never be credited by the
 * team scoring that would have valued it. Not full either, for the reason
 * above. Reasoned, not measured.
 */
export const TEAM_DEPENDENT_ROLE_DISCOUNT = 0.5;

/**
 * Fraction of the solo support bonus a role earns when scored in isolation.
 *
 * @param role Role to weigh, or undefined for no role.
 * @returns 1 for roles that pay off alone, the discount for ones that need teammates, 0 for none.
 */
export function soloRoleValue(role: AbilityRole | undefined): number {
  if (!role) return 0;
  return TEAM_DEPENDENT_ROLES.includes(role) ? TEAM_DEPENDENT_ROLE_DISCOUNT : 1;
}

/**
 * Roles worth scoring in a given format.
 *
 * @param hasAlly Whether an ally shares the field.
 * @returns The applicable roles, used both to filter and to normalize breadth.
 */
export function getApplicableRoles(hasAlly: boolean): readonly AbilityRole[] {
  return hasAlly ? ABILITY_ROLES : ABILITY_ROLES.filter((role) => !DOUBLES_ONLY_ROLES.includes(role));
}

/**
 * ## Both halves of the weather interaction, finally
 *
 * The setters were scored here for a long time while the abusers were worth
 * nothing, and the docblock on TEAM_DEPENDENT_ROLES stated the asymmetry without
 * closing it: a setter is discounted *because* "Drought on Ninetales is the whole
 * reason to bring it and worth zero without the sun abusers behind it". The
 * abusers behind it earned zero.
 *
 * The cost was concrete. Excadrill's Sand Rush doubles its Speed and read as a
 * blank, so it ranked below Mamoswine — which the format has at C-tier against
 * Excadrill's B — on the strength of Ice/Ground being the best offensive typing
 * in the format. Twenty-two of the 146 Pokemon in a default scan carry a
 * weather-dependent ability.
 *
 * ### What counts as abusing weather
 *
 * The weather has to change what the Pokemon *does* — how fast it moves or how
 * hard it hits. Abilities that change how likely it is to be hit, or hand back a
 * sixteenth of its HP, are recorded below and deliberately excluded. That line is
 * doing real work rather than tidying: **Snow Cloak is why Mamoswine is over
 * Excadrill in the first place**, and crediting evasion here would raise both and
 * fix nothing.
 */
export const DOUBLES_ABILITIES: Readonly<Record<string, AbilityEffect>> = {
  intimidate: { role: 'intimidate' },

  // Redirection pulls single-target attacks off the partner. These also grant a
  // type immunity, which pokedexAbilities already applies separately.
  'lightning-rod': { role: 'redirection' },
  'storm-drain': { role: 'redirection' },

  // Friend Guard reduces damage the ally takes from opponents but does nothing
  // about the ally's own spread moves, so it is not immuneToAllyMoves.
  'friend-guard': { role: 'ally-protection' },
  telepathy: { role: 'ally-protection', immuneToAllyMoves: true },

  drought: { role: 'weather-setter', fieldState: 'sun' },
  drizzle: { role: 'weather-setter', fieldState: 'rain' },
  'sand-stream': { role: 'weather-setter', fieldState: 'sandstorm' },
  'snow-warning': { role: 'weather-setter', fieldState: 'snow' },

  // Speed doubled in the weather they want. The reason to bring the setter.
  'sand-rush': { role: 'weather-abuser', fieldState: 'sandstorm' },
  'swift-swim': { role: 'weather-abuser', fieldState: 'rain' },
  chlorophyll: { role: 'weather-abuser', fieldState: 'sun' },
  'slush-rush': { role: 'weather-abuser', fieldState: 'snow' },
  // Damage rather than Speed: Rock, Ground and Steel moves gain 30% in sand.
  // Smaller than the Speed doublers and still a change to what the Pokemon does.
  'sand-force': { role: 'weather-abuser', fieldState: 'sandstorm' },
  // Recorded and excluded, all four. Sand Veil and Snow Cloak buy evasion, which
  // changes whether the Pokemon is hit rather than what it does, and is a
  // coin-flip besides. Ice Body and Rain Dish return a sixteenth of maximum HP
  // per turn, which is chip healing and not a reason to build a team around the
  // weather. Listed so their absence reads as a decision:
  //   'sand-veil'  — evasion in sandstorm
  //   'snow-cloak' — evasion in snow
  //   'ice-body'   — 1/16 HP per turn in snow
  //   'rain-dish'  — 1/16 HP per turn in rain

  'electric-surge': { role: 'terrain-setter', fieldState: 'electric-terrain' },
  'psychic-surge': { role: 'terrain-setter', fieldState: 'psychic-terrain' },
  'grassy-surge': { role: 'terrain-setter', fieldState: 'grassy-terrain' },
  'misty-surge': { role: 'terrain-setter', fieldState: 'misty-terrain' }
};

export interface TeamRoleMember {
  /** The ability actually selected for battle, not the full learnable set. */
  abilityName?: string;
  /**
   * PokeAPI variety name, used to find roles the Pokemon can fill with a move
   * rather than an ability. Omitting it scores abilities only, which is what
   * this function did before `utilityMoveData.ts` existed.
   */
  varietyName?: string;
}

export interface TeamRoleAnalysis {
  /** Distinct support roles the team covers. */
  roles: AbilityRole[];
  /**
   * Roles covered *only* by a move, with no ability on the team supplying them.
   * Kept apart from `roles` because they are not worth the same: an ability
   * works for free and a move costs one of four slots, so the consumer charges
   * the difference rather than this function pretending they are equal.
   */
  moveRoles: AbilityRole[];
  /** Ability names providing each covered role. */
  roleSources: Partial<Record<AbilityRole, string[]>>;
  /**
   * Roles where members are competing to set incompatible field states, so the
   * later switch-in simply overwrites the earlier one.
   */
  fieldConflicts: AbilityRole[];
  /** Ability names involved in a field conflict. */
  conflictingAbilities: string[];
}

/**
 * Looks up the doubles role an ability grants.
 *
 * @param abilityName PokeAPI ability name.
 * @returns The effect, or undefined when the ability has no modelled role.
 */
export function getAbilityEffect(abilityName: string | undefined | null): AbilityEffect | undefined {
  if (!abilityName) return undefined;
  return DOUBLES_ABILITIES[abilityName];
}

/**
 * Reports whether an ability makes its holder immune to its ally's moves.
 *
 * @param abilityName PokeAPI ability name.
 * @returns True when the holder cannot be damaged by its partner.
 */
export function isImmuneToAllyMoves(abilityName: string | undefined | null): boolean {
  return getAbilityEffect(abilityName)?.immuneToAllyMoves === true;
}

/**
 * Analyses the doubles support roles a team's selected abilities provide.
 *
 * Roles are counted as distinct rather than tallied: a second Intimidate is
 * perfectly playable but adds no new capability, so breadth is the useful
 * measure and diminishing returns fall out naturally.
 *
 * @param members Team members with their selected ability.
 * @param options Set hasAlly false for singles, which drops the roles that need a partner.
 * @returns Covered roles, their sources, and any field-setting conflicts.
 */
export function analyzeTeamRoles(
  members: TeamRoleMember[],
  options: { hasAlly?: boolean } = {}
): TeamRoleAnalysis {
  const { hasAlly = true } = options;
  const applicableRoles = getApplicableRoles(hasAlly);
  const roleSources: Partial<Record<AbilityRole, string[]>> = {};
  const fieldStatesByRole: Partial<Record<AbilityRole, Map<string, string>>> = {};

  const moveRoleSources: Partial<Record<AbilityRole, string[]>> = {};
  members.forEach((member) => {
    getUtilityRoles(member.varietyName).forEach((role) => {
      if (!applicableRoles.includes(role)) return;
      const sources = moveRoleSources[role] || [];
      if (member.varietyName && !sources.includes(member.varietyName)) sources.push(member.varietyName);
      moveRoleSources[role] = sources;
    });
  });

  members.forEach((member) => {
    const effect = getAbilityEffect(member.abilityName);
    if (!effect || !member.abilityName) return;
    if (!applicableRoles.includes(effect.role)) return;

    const sources = roleSources[effect.role] || [];
    if (!sources.includes(member.abilityName)) sources.push(member.abilityName);
    roleSources[effect.role] = sources;

    if (effect.fieldState) {
      const states = fieldStatesByRole[effect.role] || new Map<string, string>();
      states.set(effect.fieldState, member.abilityName);
      fieldStatesByRole[effect.role] = states;
    }
  });

  const fieldConflicts: AbilityRole[] = [];
  const conflictingAbilities: string[] = [];

  applicableRoles.forEach((role) => {
    const states = fieldStatesByRole[role];
    if (states && states.size > 1) {
      fieldConflicts.push(role);
      conflictingAbilities.push(...states.values());
    }
  });

  // An abuser is only a capability the team *has* when something on the team puts
  // its weather up. Sand Rush with no sand is a blank, and counting it as role
  // breadth would credit a team for an interaction it cannot perform.
  //
  // This gate is on the team analysis only, and deliberately not on
  // `soloRoleValue`. Ranking a Pokemon alone, a setter is worth half credit with
  // no abuser beside it yet; symmetry says an abuser is worth half credit with no
  // setter beside it yet. Both are bets on a teammate that has not been chosen.
  const setStates = new Set(
    [...(fieldStatesByRole['weather-setter']?.keys() ?? [])]
  );
  const abuserStates = fieldStatesByRole['weather-abuser'];
  const abuserSatisfied = !!abuserStates
    && [...abuserStates.keys()].some((state) => setStates.has(state));
  if (!abuserSatisfied) delete roleSources['weather-abuser'];

  const roles = applicableRoles.filter((role) => (roleSources[role] || []).length > 0);
  return {
    roles,
    // Only roles no ability already covers. A team with Lightning Rod *and*
    // Follow Me has redirection once, not one and a half times.
    moveRoles: applicableRoles.filter((role) =>
      !roles.includes(role) && (moveRoleSources[role] || []).length > 0),
    roleSources,
    fieldConflicts,
    conflictingAbilities
  };
}
