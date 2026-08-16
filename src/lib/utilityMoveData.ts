/**
 * GENERATED FILE — do not edit by hand.
 *
 * Support roles a Pokemon can fill with a *move*, keyed by PokeAPI variety name.
 *
 * `abilityRoles.ts` reads every modelled role off an ability, which left the
 * model blind to the Pokemon whose support is a move it learns. Corviknight
 * ranks on its attacking stat while the format plays it for Tailwind; the same
 * gap sits under Whimsicott and Pelipper. This is the other source for the same
 * vocabulary — the split `coverageMoves.ts` already makes between what a typing
 * threatens and what a moveslot can reach, applied to support instead of damage.
 *
 * ## An ability is free and a move is not
 *
 * Nothing here should be scored as heavily as its ability equivalent. Lightning
 * Rod redirects every turn for nothing; Follow Me redirects because one of four
 * moveslots was spent on it, and that slot is not attacking. The two are the
 * same capability at different prices, and the consumer is responsible for
 * charging the difference.
 *
 * ## Selected by role, never by frequency
 *
 * A move appears here when it supplies a role the model scores. That rule is why
 * this table cannot repeat the coverage defect: it is not a maximum over
 * anything, and a common move earns no entry. **Protect is on 100% of the
 * roster** and is absent; Rain Dance and Sunny Day are on ~75% and are absent,
 * because setting weather by move costs a turn and a slot for five turns of what
 * an ability grants permanently. See UTILITY_MOVE_ROLES in
 * scripts/gen-coverage-moves.mjs for the full selection and the measured shares.
 *
 * Regenerate with `npm run gen:coverage-moves`, then paste the emitted
 * utility-move-table.txt into the literal below and update the line that
 * follows. The generator does not write this file: the header is hand-written
 * and would be lost.
 *
 * Generated 2026-08-16 from the 208-species Champions Pokedex / 359 varieties.
 * 130 have at least one: speed control 85, ally protection 76, redirection 10.
 * Redirection is rare because redirection is rare — four varieties learn Follow
 * Me and six learn Rage Powder — and that scarcity is the reason it is worth
 * something rather than a reason to doubt the table.
 */

import type { AbilityRole } from './abilityRoles';

export const UTILITY_MOVE_ROLES: Readonly<Record<string, readonly AbilityRole[]>> = {
  'aegislash-blade': ['ally-protection'],
  'aegislash-shield': ['ally-protection'],
  'aerodactyl': ['ally-protection', 'speed-control'],
  'aerodactyl-mega': ['ally-protection', 'speed-control'],
  'alakazam': ['ally-protection', 'speed-control'],
  'alakazam-mega': ['ally-protection', 'speed-control'],
  'altaria': ['speed-control'],
  'altaria-mega': ['speed-control'],
  'araquanid': ['ally-protection'],
  'ariados': ['redirection'],
  'armarouge': ['ally-protection', 'speed-control'],
  'aromatisse': ['ally-protection', 'speed-control'],
  'audino': ['ally-protection', 'speed-control'],
  'audino-mega': ['ally-protection', 'speed-control'],
  'avalugg': ['ally-protection'],
  'avalugg-hisui': ['ally-protection'],
  'banette': ['speed-control'],
  'banette-mega': ['speed-control'],
  'bastiodon': ['ally-protection'],
  'ceruledge': ['ally-protection'],
  'chandelure': ['speed-control'],
  'chandelure-mega': ['speed-control'],
  'chesnaught': ['ally-protection'],
  'chesnaught-mega': ['ally-protection'],
  'chimecho': ['ally-protection', 'speed-control'],
  'chimecho-mega': ['ally-protection', 'speed-control'],
  'clefable': ['redirection'],
  'clefable-mega': ['redirection'],
  'cofagrigus': ['ally-protection', 'speed-control'],
  'conkeldurr': ['ally-protection'],
  'corviknight': ['speed-control'],
  'crabominable': ['ally-protection'],
  'crabominable-mega': ['ally-protection'],
  'decidueye': ['speed-control'],
  'decidueye-hisui': ['speed-control'],
  'delphox': ['speed-control'],
  'delphox-mega': ['speed-control'],
  'dragonite': ['speed-control'],
  'dragonite-mega': ['speed-control'],
  'espathra': ['ally-protection', 'speed-control'],
  'espeon': ['speed-control'],
  'farigiraf': ['ally-protection', 'speed-control'],
  'gallade': ['ally-protection', 'speed-control'],
  'gallade-mega': ['ally-protection', 'speed-control'],
  'gardevoir': ['speed-control'],
  'gardevoir-mega': ['speed-control'],
  'garganacl': ['ally-protection'],
  'gengar': ['speed-control'],
  'gengar-mega': ['speed-control'],
  'gliscor': ['speed-control'],
  'gourgeist-average': ['ally-protection', 'speed-control'],
  'gourgeist-large': ['ally-protection', 'speed-control'],
  'gourgeist-small': ['ally-protection', 'speed-control'],
  'gourgeist-super': ['ally-protection', 'speed-control'],
  'hatterene': ['speed-control'],
  'hawlucha': ['ally-protection'],
  'hawlucha-mega': ['ally-protection'],
  'heliolisk': ['ally-protection'],
  'houndstone': ['ally-protection'],
  'hydreigon': ['speed-control'],
  'kingambit': ['ally-protection'],
  'kleavor': ['ally-protection', 'speed-control'],
  'klefki': ['speed-control'],
  'lucario': ['ally-protection'],
  'lucario-mega': ['ally-protection'],
  'lycanroc-dusk': ['ally-protection'],
  'lycanroc-midday': ['ally-protection'],
  'machamp': ['ally-protection'],
  'malamar': ['speed-control'],
  'malamar-mega': ['speed-control'],
  'maushold-family-of-four': ['redirection'],
  'maushold-family-of-three': ['redirection'],
  'medicham': ['ally-protection', 'speed-control'],
  'medicham-mega': ['ally-protection', 'speed-control'],
  'meowscarada': ['ally-protection', 'speed-control'],
  'meowstic-female': ['speed-control'],
  'meowstic-female-mega': ['speed-control'],
  'meowstic-male': ['ally-protection', 'speed-control'],
  'meowstic-male-mega': ['ally-protection', 'speed-control'],
  'mimikyu-busted': ['speed-control'],
  'mimikyu-disguised': ['speed-control'],
  'mr-rime': ['ally-protection', 'speed-control'],
  'musharna': ['ally-protection', 'speed-control'],
  'noivern': ['speed-control'],
  'oranguru': ['speed-control'],
  'pangoro': ['ally-protection'],
  'passimian': ['ally-protection'],
  'pelipper': ['ally-protection', 'speed-control'],
  'pidgeot': ['speed-control'],
  'pidgeot-mega': ['speed-control'],
  'polteageist': ['ally-protection', 'speed-control'],
  'reuniclus': ['ally-protection', 'speed-control'],
  'runerigus': ['ally-protection', 'speed-control'],
  'sceptile': ['ally-protection'],
  'sceptile-mega': ['ally-protection'],
  'scizor': ['ally-protection', 'speed-control'],
  'scizor-mega': ['ally-protection', 'speed-control'],
  'scovillain': ['redirection'],
  'scovillain-mega': ['redirection'],
  'scrafty': ['ally-protection'],
  'scrafty-mega': ['ally-protection'],
  'sinistcha': ['redirection', 'speed-control'],
  'skarmory': ['speed-control'],
  'skarmory-mega': ['speed-control'],
  'slowbro': ['speed-control'],
  'slowbro-galar': ['speed-control'],
  'slowbro-mega': ['speed-control'],
  'slowking': ['speed-control'],
  'slowking-galar': ['speed-control'],
  'sneasler': ['ally-protection'],
  'spiritomb': ['ally-protection', 'speed-control'],
  'staraptor': ['speed-control'],
  'staraptor-mega': ['speed-control'],
  'starmie': ['ally-protection', 'speed-control'],
  'starmie-mega': ['ally-protection', 'speed-control'],
  'steelix': ['ally-protection'],
  'steelix-mega': ['ally-protection'],
  'swampert': ['ally-protection'],
  'swampert-mega': ['ally-protection'],
  'talonflame': ['ally-protection', 'speed-control'],
  'torterra': ['ally-protection'],
  'toucannon': ['speed-control'],
  'toxapex': ['ally-protection'],
  'toxicroak': ['ally-protection'],
  'trevenant': ['ally-protection', 'speed-control'],
  'vanilluxe': ['ally-protection'],
  'vivillon': ['redirection', 'speed-control'],
  'volcarona': ['redirection', 'speed-control'],
  'whimsicott': ['speed-control'],
  'wyrdeer': ['speed-control']
};
