/**
 * GENERATED FILE — do not edit by hand.
 *
 * Non-volatile status conditions each Pokemon can reliably inflict, keyed by
 * PokeAPI *variety* name, from the `champions` version group.
 *
 * This table exists to answer a question the model could not previously ask.
 * Every status-facing ability — Purifying Salt, Magic Guard's status half, Guts,
 * Marvel Scale, Natural Cure — was priced by a hand-picked constant, because
 * nothing in the repo knew how often status actually happens. `coverageMoveData`
 * deliberately drops status moves, and abilities alone reach only 11% of the
 * roster, which badly understates it.
 *
 * ## What counts as inflicting a status
 *
 * The bar is reliability, the same argument the coverage table's power floor
 * makes: a move that lands its status one time in ten describes a Pokemon that
 * does not really have that tool. So a status-class move whose purpose *is* the
 * ailment counts — Will-O-Wisp, Thunder Wave, Spore — and so does a damaging
 * move that inflicts it every time, which is Nuzzle at 100%. Flamethrower's 10%
 * burn does not.
 *
 * Accuracy is not folded in. Will-O-Wisp at 85% is still a Pokemon that burns
 * things, and pricing the miss here would make this a damage calculator rather
 * than a capability table.
 *
 * ## Why only the five non-volatile conditions
 *
 * Burn, paralysis, poison, sleep and freeze persist and are what a status
 * immunity blocks. Confusion and its kin are volatile, are not blocked by the
 * same abilities, and counting them alike would overstate every number
 * downstream. Freeze has no entry anywhere in this table: nothing in Champions
 * freezes reliably, only on secondary chance, so it drops out on the rule above
 * rather than by being excluded.
 *
 * Regenerate with `npm run gen:coverage-moves`, then paste the emitted
 * status-table.txt into the literal below and update the line that follows. The
 * generator does not write this file: the header above it is hand-written and
 * would be lost.
 *
 * Generated 2026-08-13 from 208 legal species / 359 varieties.
 */

/** The non-volatile status conditions, as PokeAPI names them. */
export type Ailment = 'burn' | 'paralysis' | 'poison' | 'sleep' | 'freeze';

export const STATUS_MOVE_AILMENTS: Readonly<Record<string, readonly Ailment[]>> = {
  'absol': ['burn', 'paralysis'],
  'absol-mega': ['burn', 'paralysis'],
  'aggron': ['paralysis'],
  'aggron-mega': ['paralysis'],
  'alakazam': ['paralysis'],
  'alakazam-mega': ['paralysis'],
  'altaria': ['burn', 'sleep'],
  'altaria-mega': ['burn', 'sleep'],
  'ampharos': ['paralysis'],
  'ampharos-mega': ['paralysis'],
  'arbok': ['paralysis', 'poison'],
  'arcanine': ['burn'],
  'arcanine-hisui': ['burn'],
  'archaludon': ['paralysis'],
  'ariados': ['poison'],
  'armarouge': ['burn'],
  'aromatisse': ['sleep'],
  'audino': ['paralysis'],
  'audino-mega': ['paralysis'],
  'aurorus': ['paralysis'],
  'azumarill': ['sleep'],
  'banette': ['burn', 'paralysis'],
  'banette-mega': ['burn', 'paralysis'],
  'beedrill': ['poison'],
  'beedrill-mega': ['poison'],
  'bellibolt': ['paralysis', 'poison'],
  'blaziken': ['burn'],
  'blaziken-mega': ['burn'],
  'camerupt': ['burn'],
  'camerupt-mega': ['burn'],
  'castform': ['paralysis'],
  'castform-rainy': ['paralysis'],
  'castform-snowy': ['paralysis'],
  'castform-sunny': ['paralysis'],
  'ceruledge': ['burn'],
  'chandelure': ['burn'],
  'chandelure-mega': ['burn'],
  'charizard': ['burn'],
  'charizard-mega-x': ['burn'],
  'charizard-mega-y': ['burn'],
  'chimecho': ['paralysis', 'sleep'],
  'chimecho-mega': ['paralysis', 'sleep'],
  'clefable': ['paralysis', 'sleep'],
  'clefable-mega': ['paralysis', 'sleep'],
  'cofagrigus': ['burn'],
  'dedenne': ['paralysis'],
  'delphox': ['burn', 'sleep'],
  'delphox-mega': ['burn', 'sleep'],
  'dragalge': ['poison'],
  'dragalge-mega': ['poison'],
  'dragapult': ['burn', 'paralysis'],
  'dragonite': ['paralysis'],
  'dragonite-mega': ['paralysis'],
  'drampa': ['paralysis'],
  'drampa-mega': ['paralysis'],
  'eelektross': ['paralysis'],
  'eelektross-mega': ['paralysis'],
  'emboar': ['burn'],
  'emboar-mega': ['burn'],
  'emolga': ['paralysis'],
  'espathra': ['sleep'],
  'espeon': ['paralysis'],
  'farigiraf': ['paralysis'],
  'flareon': ['burn'],
  'forretress': ['paralysis'],
  'froslass': ['burn', 'paralysis'],
  'froslass-mega': ['burn', 'paralysis'],
  'furfrou': ['paralysis'],
  'gallade': ['burn', 'paralysis', 'sleep'],
  'gallade-mega': ['burn', 'paralysis', 'sleep'],
  'garbodor': ['poison'],
  'gardevoir': ['burn', 'paralysis', 'sleep'],
  'gardevoir-mega': ['burn', 'paralysis', 'sleep'],
  'gengar': ['burn', 'paralysis', 'poison', 'sleep'],
  'gengar-mega': ['burn', 'paralysis', 'poison', 'sleep'],
  'glimmora': ['poison'],
  'glimmora-mega': ['poison'],
  'gliscor': ['poison'],
  'goodra': ['poison'],
  'gourgeist-average': ['burn', 'sleep'],
  'gourgeist-large': ['burn', 'sleep'],
  'gourgeist-small': ['burn', 'sleep'],
  'gourgeist-super': ['burn', 'sleep'],
  'grimmsnarl': ['burn'],
  'gyarados': ['paralysis'],
  'gyarados-mega': ['paralysis'],
  'hatterene': ['paralysis'],
  'heliolisk': ['paralysis'],
  'houndoom': ['burn', 'poison'],
  'houndoom-mega': ['burn', 'poison'],
  'houndstone': ['burn'],
  'hydreigon': ['paralysis'],
  'incineroar': ['burn'],
  'infernape': ['burn'],
  'jolteon': ['paralysis'],
  'kingambit': ['paralysis'],
  'klefki': ['paralysis'],
  'liepard': ['burn', 'paralysis'],
  'lopunny': ['paralysis'],
  'lopunny-mega': ['paralysis'],
  'luxray': ['paralysis'],
  'malamar': ['sleep'],
  'malamar-mega': ['sleep'],
  'manectric': ['paralysis'],
  'manectric-mega': ['paralysis'],
  'maushold-family-of-four': ['paralysis'],
  'maushold-family-of-three': ['paralysis'],
  'meganium': ['poison'],
  'meganium-mega': ['poison'],
  'meowstic-female': ['paralysis'],
  'meowstic-female-mega': ['paralysis'],
  'meowstic-male': ['paralysis'],
  'meowstic-male-mega': ['paralysis'],
  'milotic': ['sleep'],
  'mimikyu-busted': ['burn', 'paralysis'],
  'mimikyu-disguised': ['burn', 'paralysis'],
  'morpeko-full-belly': ['paralysis'],
  'morpeko-hangry': ['paralysis'],
  'mr-rime': ['paralysis', 'sleep'],
  'musharna': ['paralysis', 'sleep'],
  'ninetales': ['burn', 'sleep'],
  'ninetales-alola': ['sleep'],
  'overqwil': ['poison'],
  'pikachu': ['paralysis'],
  'politoed': ['sleep'],
  'polteageist': ['burn'],
  'primarina': ['sleep'],
  'pyroar-male': ['burn'],
  'pyroar-mega': ['burn'],
  'qwilfish': ['paralysis', 'poison'],
  'raichu': ['paralysis'],
  'raichu-alola': ['paralysis'],
  'raichu-mega-x': ['paralysis'],
  'raichu-mega-y': ['paralysis'],
  'reuniclus': ['paralysis'],
  'roserade': ['paralysis', 'poison', 'sleep'],
  'rotom': ['burn', 'paralysis'],
  'rotom-fan': ['burn', 'paralysis'],
  'rotom-frost': ['burn', 'paralysis'],
  'rotom-heat': ['burn', 'paralysis'],
  'rotom-mow': ['burn', 'paralysis'],
  'rotom-wash': ['burn', 'paralysis'],
  'runerigus': ['burn'],
  'sableye': ['burn', 'paralysis'],
  'sableye-mega': ['burn', 'paralysis'],
  'salazzle': ['burn', 'paralysis', 'poison'],
  'sandaconda': ['paralysis'],
  'scolipede': ['poison'],
  'scolipede-mega': ['poison'],
  'scovillain': ['burn'],
  'scovillain-mega': ['burn'],
  'serperior': ['paralysis'],
  'simisear': ['burn'],
  'sinistcha': ['paralysis'],
  'skeledirge': ['burn', 'sleep'],
  'slowbro': ['paralysis'],
  'slowbro-galar': ['paralysis', 'poison'],
  'slowbro-mega': ['paralysis'],
  'slowking': ['paralysis'],
  'slowking-galar': ['paralysis', 'poison'],
  'sneasler': ['poison'],
  'spiritomb': ['burn', 'poison', 'sleep'],
  'starmie': ['paralysis'],
  'starmie-mega': ['paralysis'],
  'stunfisk': ['paralysis'],
  'stunfisk-galar': ['paralysis'],
  'talonflame': ['burn'],
  'tauros-paldea-blaze-breed': ['burn'],
  'tinkaton': ['paralysis'],
  'torkoal': ['burn'],
  'toxapex': ['poison'],
  'toxicroak': ['poison'],
  'trevenant': ['burn', 'poison'],
  'typhlosion': ['burn'],
  'typhlosion-hisui': ['burn'],
  'tyranitar': ['paralysis'],
  'tyranitar-mega': ['paralysis'],
  'umbreon': ['paralysis', 'poison'],
  'venusaur': ['poison', 'sleep'],
  'venusaur-mega': ['poison', 'sleep'],
  'victreebel': ['paralysis', 'poison', 'sleep'],
  'victreebel-mega': ['paralysis', 'poison', 'sleep'],
  'vileplume': ['paralysis', 'poison', 'sleep'],
  'vivillon': ['paralysis', 'poison', 'sleep'],
  'volcarona': ['burn'],
  'watchog': ['paralysis', 'sleep'],
  'whimsicott': ['paralysis', 'poison'],
  'wyrdeer': ['paralysis', 'sleep'],
  'zoroark': ['burn', 'poison'],
  'zoroark-hisui': ['burn']
};
