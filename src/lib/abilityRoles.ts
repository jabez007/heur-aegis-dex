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

export type AbilityRole =
  | 'intimidate'
  | 'redirection'
  | 'ally-protection'
  | 'weather-setter'
  | 'terrain-setter';

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
  'terrain-setter'
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
export const TEAM_DEPENDENT_ROLES: readonly AbilityRole[] = ['weather-setter', 'terrain-setter'];

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

  'electric-surge': { role: 'terrain-setter', fieldState: 'electric-terrain' },
  'psychic-surge': { role: 'terrain-setter', fieldState: 'psychic-terrain' },
  'grassy-surge': { role: 'terrain-setter', fieldState: 'grassy-terrain' },
  'misty-surge': { role: 'terrain-setter', fieldState: 'misty-terrain' }
};

export interface TeamRoleMember {
  /** The ability actually selected for battle, not the full learnable set. */
  abilityName?: string;
}

export interface TeamRoleAnalysis {
  /** Distinct support roles the team covers. */
  roles: AbilityRole[];
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

  return {
    roles: applicableRoles.filter((role) => (roleSources[role] || []).length > 0),
    roleSources,
    fieldConflicts,
    conflictingAbilities
  };
}
