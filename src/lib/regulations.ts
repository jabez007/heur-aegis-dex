/**
 * Pokemon Champions regulation data.
 *
 * Champions defines legality as a published whitelist per regulation set, not
 * as a property derivable from a Pokemon's stats, egg groups or origin game.
 * Approximating it with a heuristic drifts every time the roster changes, so
 * the rosters are recorded here as data and updated when a regulation ships.
 *
 * This is a *legality* filter and nothing more. It is deliberately independent
 * of the breedable-only preference applied elsewhere in the scan: a Pokemon can
 * be tournament legal and still be one you would rather not use, and the two
 * questions should never be conflated.
 *
 * ## Granularity
 *
 * Rosters are keyed by PokeAPI `pokemon-species` name. PokeAPI models regional
 * forms as *varieties* of a species — Alolan Raichu is a variety of `raichu`,
 * not a species of its own — so a legal species admits its regional forms. That
 * matches how the published lists read for M-B, which names the regional forms
 * of species already on the roster rather than introducing new species.
 *
 * Form-level legality is therefore not modelled. If a future regulation permits
 * one form of a species while banning another, this module needs a form layer
 * before it can express that.
 */

import type { BattleFormatId } from './battleFormats';

export type MechanicId = 'mega' | 'terastal' | 'dynamax' | 'z-move';

export type RegulationId = 'M-A' | 'M-B';

export interface RegulationRules {
  /** Formats this regulation is played in. Roster and bring sizes live on the format. */
  formats: readonly BattleFormatId[];
  /** Level every Pokemon is set to during battle. */
  battleLevel: number;
  allowDuplicateSpecies: boolean;
  allowDuplicateItems: boolean;
}

export interface Regulation {
  readonly id: RegulationId;
  readonly label: string;
  /** Inclusive ISO-8601 instant the regulation becomes active. */
  readonly activeFrom: string;
  /** Exclusive ISO-8601 instant the regulation stops being active. */
  readonly activeTo: string;
  readonly rules: RegulationRules;
  readonly mechanics: readonly MechanicId[];
  /** PokeAPI species names legal in this regulation. */
  readonly legalSpecies: ReadonlySet<string>;
  /** PokeAPI species names able to Mega Evolve in this regulation. */
  readonly megaCapableSpecies: ReadonlySet<string>;
  /**
   * Fields whose published data has not been captured. Treat these as unknown
   * rather than empty — an empty set here means "not recorded", not "none".
   */
  readonly incompleteFields: readonly string[];
  readonly sources: readonly string[];
  /** Date the rosters were checked against PokeAPI and the published lists. */
  readonly verifiedOn: string;
}

// Champions runs both formats off one roster; only the bring count differs, so
// the sizes live on the format rather than being duplicated per regulation.
const CHAMPIONS_RULES: RegulationRules = {
  formats: ['singles', 'doubles'],
  battleLevel: 50,
  allowDuplicateSpecies: false,
  allowDuplicateItems: false
};

/** Roster introduced with Champions at launch. M-B is a strict superset. */
const M_A_SPECIES = [
  'abomasnow', 'absol', 'aegislash', 'aerodactyl', 'aggron', 'alakazam', 'alcremie', 'altaria',
  'ampharos', 'appletun', 'araquanid', 'arbok', 'arcanine', 'archaludon', 'ariados', 'armarouge',
  'aromatisse', 'audino', 'aurorus', 'avalugg', 'azumarill', 'banette', 'basculegion',
  'bastiodon', 'beartic', 'beedrill', 'bellibolt', 'blastoise', 'camerupt', 'castform',
  'ceruledge', 'chandelure', 'charizard', 'chesnaught', 'chimecho', 'clawitzer', 'clefable',
  'cofagrigus', 'conkeldurr', 'corviknight', 'crabominable', 'decidueye', 'dedenne', 'delphox',
  'diggersby', 'ditto', 'dragapult', 'dragonite', 'drampa', 'emboar', 'emolga', 'empoleon',
  'espathra', 'espeon', 'excadrill', 'farigiraf', 'feraligatr', 'flapple', 'flareon', 'floette',
  'florges', 'forretress', 'froslass', 'furfrou', 'gallade', 'garbodor', 'garchomp', 'gardevoir',
  'garganacl', 'gengar', 'glaceon', 'glalie', 'glimmora', 'gliscor', 'golurk', 'goodra',
  'gourgeist', 'greninja', 'gyarados', 'hatterene', 'hawlucha', 'heliolisk', 'heracross',
  'hippowdon', 'houndoom', 'hydrapple', 'hydreigon', 'incineroar', 'infernape', 'jolteon',
  'kangaskhan', 'kingambit', 'kleavor', 'klefki', 'kommo-o', 'krookodile', 'leafeon', 'liepard',
  'lopunny', 'lucario', 'luxray', 'lycanroc', 'machamp', 'mamoswine', 'manectric', 'maushold',
  'medicham', 'meganium', 'meowscarada', 'meowstic', 'milotic', 'mimikyu', 'morpeko', 'mr-rime',
  'mudsdale', 'ninetales', 'noivern', 'oranguru', 'orthworm', 'palafin', 'pangoro', 'passimian',
  'pelipper', 'pidgeot', 'pikachu', 'pinsir', 'politoed', 'polteageist', 'primarina', 'quaquaval',
  'raichu', 'rampardos', 'reuniclus', 'rhyperior', 'roserade', 'rotom', 'runerigus', 'sableye',
  'salazzle', 'samurott', 'sandaconda', 'scizor', 'scovillain', 'serperior', 'sharpedo',
  'simipour', 'simisage', 'simisear', 'sinistcha', 'skarmory', 'skeledirge', 'slowbro',
  'slowking', 'slurpuff', 'sneasler', 'snorlax', 'spiritomb', 'starmie', 'steelix', 'stunfisk',
  'sylveon', 'talonflame', 'tauros', 'tinkaton', 'torkoal', 'torterra', 'toucannon', 'toxapex',
  'toxicroak', 'trevenant', 'tsareena', 'typhlosion', 'tyranitar', 'tyrantrum', 'umbreon',
  'vanilluxe', 'vaporeon', 'venusaur', 'victreebel', 'vivillon', 'volcarona', 'watchog',
  'weavile', 'whimsicott', 'wyrdeer', 'zoroark'
] as const;

/** The 22 species M-B adds on top of the M-A roster. */
const M_B_ADDITIONS = [
  'annihilape', 'barbaracle', 'blaziken', 'dragalge', 'eelektross', 'falinks', 'gholdengo',
  'grimmsnarl', 'houndstone', 'malamar', 'mawile', 'metagross', 'musharna', 'overqwil', 'pyroar',
  'qwilfish', 'sceptile', 'scolipede', 'scrafty', 'staraptor', 'swampert', 'vileplume'
] as const;

/** Species able to Mega Evolve under M-B. */
const M_B_MEGA_CAPABLE = [
  'abomasnow', 'absol', 'aerodactyl', 'aggron', 'alakazam', 'altaria', 'ampharos', 'audino',
  'banette', 'barbaracle', 'beedrill', 'blastoise', 'blaziken', 'camerupt', 'chandelure',
  'charizard', 'chesnaught', 'chimecho', 'clefable', 'crabominable', 'delphox', 'dragalge',
  'dragonite', 'drampa', 'eelektross', 'emboar', 'excadrill', 'falinks', 'feraligatr', 'floette',
  'froslass', 'gallade', 'garchomp', 'gardevoir', 'gengar', 'glalie', 'glimmora', 'golurk',
  'greninja', 'gyarados', 'hawlucha', 'heracross', 'houndoom', 'kangaskhan', 'lopunny', 'lucario',
  'malamar', 'manectric', 'mawile', 'medicham', 'meganium', 'meowstic', 'metagross', 'pidgeot',
  'pinsir', 'pyroar', 'raichu', 'sableye', 'sceptile', 'scizor', 'scolipede', 'scovillain',
  'scrafty', 'sharpedo', 'skarmory', 'slowbro', 'staraptor', 'starmie', 'steelix', 'swampert',
  'tyranitar', 'venusaur', 'victreebel'
] as const;

const REGULATION_LIST: readonly Regulation[] = [
  {
    id: 'M-A',
    label: 'Regulation Set M-A',
    activeFrom: '2026-04-08T00:00:00Z',
    activeTo: '2026-06-17T02:00:00Z',
    rules: CHAMPIONS_RULES,
    mechanics: ['mega'],
    legalSpecies: new Set<string>(M_A_SPECIES),
    // M-B is documented as adding 16 Mega Evolutions beyond M-A's pool, but the
    // M-A roster itself was not recovered from a source that lists it. Deriving
    // it by subtraction would be a guess, so it is left unrecorded. M-A expired
    // on 2026-06-17, so nothing prepares against it today.
    megaCapableSpecies: new Set<string>(),
    incompleteFields: ['megaCapableSpecies'],
    sources: ['https://www.serebii.net/pokemonchampions/rankedbattle/regulationm-a.shtml'],
    verifiedOn: '2026-07-27'
  },
  {
    id: 'M-B',
    label: 'Regulation Set M-B',
    activeFrom: '2026-06-17T02:00:00Z',
    activeTo: '2026-09-02T05:59:00Z',
    rules: CHAMPIONS_RULES,
    mechanics: ['mega'],
    legalSpecies: new Set<string>([...M_A_SPECIES, ...M_B_ADDITIONS]),
    megaCapableSpecies: new Set<string>(M_B_MEGA_CAPABLE),
    incompleteFields: [],
    sources: [
      'https://game8.co/games/Pokemon-Champions/archives/605482',
      'https://victoryroad.pro/champions-regulations/'
    ],
    verifiedOn: '2026-07-27'
  }
] as const;

export const REGULATIONS = REGULATION_LIST;

/** Lead time for replacing an expiring regulation before CI starts failing. */
export const REGULATION_FRESHNESS_HORIZON_DAYS = 21;

/**
 * Looks up a regulation by id.
 *
 * @param id Regulation identifier, for example `M-B`.
 * @returns The regulation, or undefined when unknown.
 */
export function getRegulation(id: string | null | undefined): Regulation | undefined {
  if (!id) return undefined;
  return REGULATION_LIST.find((regulation) => regulation.id === id);
}

/**
 * Finds the regulation in force at a given moment.
 *
 * @param at Instant to test. Defaults to now.
 * @returns The active regulation, or undefined when none covers that instant.
 */
export function getActiveRegulation(at: Date = new Date()): Regulation | undefined {
  const timestamp = at.getTime();
  return REGULATION_LIST.find((regulation) =>
    timestamp >= Date.parse(regulation.activeFrom) && timestamp < Date.parse(regulation.activeTo)
  );
}

/**
 * Finds the first instant not covered by a known regulation in a time window.
 *
 * @param from Inclusive start of the window.
 * @param to Exclusive end of the window.
 * @returns The first uncovered instant, or undefined when the full window is covered.
 */
export function getRegulationCoverageGap(from: Date, to: Date): Date | undefined {
  let coveredUntil = from.getTime();
  const end = to.getTime();

  for (const regulation of [...REGULATION_LIST].sort((a, b) =>
    Date.parse(a.activeFrom) - Date.parse(b.activeFrom)
  )) {
    const activeFrom = Date.parse(regulation.activeFrom);
    const activeTo = Date.parse(regulation.activeTo);
    if (activeTo <= coveredUntil) continue;
    if (activeFrom > coveredUntil) return new Date(coveredUntil);
    coveredUntil = Math.max(coveredUntil, activeTo);
    if (coveredUntil >= end) return undefined;
  }

  return coveredUntil < end ? new Date(coveredUntil) : undefined;
}

/**
 * Tests whether a species may be used under a regulation.
 *
 * @param regulation Regulation to test against.
 * @param speciesName PokeAPI `pokemon-species` name, not a variety name.
 * @returns True when the species is on the roster.
 */
export function isSpeciesLegal(regulation: Regulation, speciesName: string): boolean {
  return regulation.legalSpecies.has(speciesName);
}

/**
 * Tests whether a species may Mega Evolve under a regulation.
 *
 * @param regulation Regulation to test against.
 * @param speciesName PokeAPI `pokemon-species` name, not a variety name.
 * @returns True when the species can Mega Evolve. Always false when the
 *   regulation lists `megaCapableSpecies` in `incompleteFields`, in which case
 *   the answer is unknown rather than negative.
 */
export function canMegaEvolve(regulation: Regulation, speciesName: string): boolean {
  return regulation.megaCapableSpecies.has(speciesName);
}

/**
 * Reports whether a regulation field was captured from a published source.
 *
 * @param regulation Regulation to inspect.
 * @param field Field name to check.
 * @returns True when the field's data is complete and safe to rely on.
 */
export function hasCompleteData(regulation: Regulation, field: keyof Regulation): boolean {
  return !regulation.incompleteFields.includes(field);
}
