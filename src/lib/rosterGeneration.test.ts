import { describe, expect, it } from 'vitest';
import { BATTLE_FORMATS } from './battleFormats';
import {
  candidatePriority,
  countSharedWeaknesses,
  countTypeOverlap,
  countUnansweredWeaknesses,
  DEFAULT_UNANSWERED_WEAKNESS_SLACK,
  generateRosters,
  CANDIDATE_WEIGHTS
} from './rosterGeneration';
import { DEFAULT_BASE_SCORE, normalizeDamageFromScore } from './pokedexScoring';
import type { PokemonEntry } from './pokemonEntry';

const stats = { hp: 80, attack: 100, defense: 90, 'special-attack': 100, 'special-defense': 90, speed: 80 };

const mon = (name: string, overrides: Partial<PokemonEntry> = {}): PokemonEntry => ({
  name,
  speciesName: name,
  typeName: 'normal',
  types: ['normal'],
  sprite: `${name}.png`,
  stats,
  baseStats: stats,
  statsTotal: 540,
  abilities: [],
  abilityName: '',
  abilityProfiles: {},
  weaknesses: [],
  quadrupleWeaknesses: [],
  resistances: [],
  immunities: [],
  coverages: [],
  moveCoverages: [],
  normalizedDamageToScore: 0.5,
  normalizedDamageFromScore: 0.5,
  ...overrides
});

// A quadruple weakness adds 3 to `calculateDamageFromScore`, reaching member
// quality through defensive typing's modulation of the bulk term. The fixture
// has to move that normalized score with the weakness list; there is deliberately
// no second flat candidate penalty for the same property.
const QUAD_FREE = normalizeDamageFromScore(19, DEFAULT_BASE_SCORE);
const WITH_QUAD = normalizeDamageFromScore(19 + 3, DEFAULT_BASE_SCORE);

const pool = (count: number) =>
  Array.from({ length: count }, (_, i) => mon(`mon-${i}`, { typeName: `t${i}`, types: [`t${i}`] }));

const doubles = BATTLE_FORMATS.doubles;
const singles = BATTLE_FORMATS.singles;

describe('candidatePriority', () => {
  it('prefers better typing at equal stats', () => {
    const good = mon('good', { normalizedDamageToScore: 0.9, normalizedDamageFromScore: 0.1 });
    const bad = mon('bad', { normalizedDamageToScore: 0.1, normalizedDamageFromScore: 0.9 });

    expect(candidatePriority(good)).toBeGreaterThan(candidatePriority(bad));
  });

  it('punishes a quadruple weakness heavily', () => {
    const clean = mon('clean', { normalizedDamageFromScore: QUAD_FREE });
    const fragile = mon('fragile', {
      weaknesses: ['fire'], quadrupleWeaknesses: ['fire'], normalizedDamageFromScore: WITH_QUAD
    });

    expect(candidatePriority(fragile)).toBeLessThan(candidatePriority(clean));
  });

  it('does not let elite defensive typing outrank materially better stats', () => {
    // The Klefki case. Steel/Fairy resists nearly everything, but 80/80
    // offences threaten nobody. Defensive typing used to be paid for three
    // times — once as its own term and twice more as the resistance and
    // weakness lists it already summarises — which put Klefki above both.
    const klefki = mon('klefki', {
      stats: { hp: 57, attack: 80, defense: 91, 'special-attack': 80, 'special-defense': 87, speed: 75 },
      statsTotal: 470,
      resistances: Array.from({ length: 11 }, (_, i) => `resist-${i}`),
      weaknesses: ['fire', 'ground'],
      normalizedDamageToScore: 0.64,
      normalizedDamageFromScore: 0.18
    });
    const lucario = mon('lucario', {
      stats: { hp: 70, attack: 110, defense: 70, 'special-attack': 115, 'special-defense': 70, speed: 90 },
      statsTotal: 525,
      resistances: Array.from({ length: 9 }, (_, i) => `resist-${i}`),
      weaknesses: ['fire', 'fighting', 'ground'],
      normalizedDamageToScore: 0.67,
      normalizedDamageFromScore: 0.22
    });
    const incineroar = mon('incineroar', {
      stats: { hp: 95, attack: 115, defense: 90, 'special-attack': 80, 'special-defense': 90, speed: 60 },
      statsTotal: 530,
      resistances: Array.from({ length: 7 }, (_, i) => `resist-${i}`),
      weaknesses: ['water', 'fighting', 'ground', 'rock'],
      normalizedDamageToScore: 0.67,
      normalizedDamageFromScore: 0.25
    });

    // The assertion this test exists for: both beat Klefki comfortably.
    expect(candidatePriority(lucario)).toBeGreaterThan(candidatePriority(klefki));
    expect(candidatePriority(incineroar)).toBeGreaterThan(candidatePriority(klefki));

    // Incineroar above Lucario is a deliberate reversal, recorded rather than
    // dropped. It used to go the other way on the old `attack + special-attack`
    // offence term, which paid Lucario in full for a second attacking stat.
    //
    // The two have the *same* primary attacking stat, 115. Lucario's whole edge
    // was its 110 secondary against Incineroar's 80 — worth 9 effective points
    // once discounted — while Incineroar carries 65 more bulk on a term weighted
    // 0.45 against offence's 0.35. Bulk winning that trade is the model doing
    // what MEMBER_WEIGHTS says it should.
    expect(candidatePriority(incineroar)).toBeGreaterThan(candidatePriority(lucario));
  });

  it('does not pay for resistances or weaknesses twice', () => {
    // normalizedDamageFromScore is calculated from exactly these buckets, so
    // counting the lists again was charging for one property twice over.
    const plain = mon('plain');
    const listed = mon('listed', {
      resistances: ['fire', 'water', 'grass', 'ice', 'flying', 'bug', 'steel', 'psychic'],
      weaknesses: ['ground', 'rock']
    });

    expect(candidatePriority(listed)).toBe(candidatePriority(plain));
  });

  it('still rates a stronger stat line above a weaker one at equal typing', () => {
    const strong = mon('strong', {
      stats: { hp: 95, attack: 130, defense: 95, 'special-attack': 130, 'special-defense': 95, speed: 100 }
    });
    const weak = mon('weak', {
      stats: { hp: 55, attack: 60, defense: 55, 'special-attack': 60, 'special-defense': 55, speed: 50 }
    });

    expect(candidatePriority(strong)).toBeGreaterThan(candidatePriority(weak));
  });

  it('credits a support role', () => {
    // Otherwise the ranking is blind to the reason half these Pokemon get
    // brought at all.
    const supporter = mon('incineroar', { abilityName: 'intimidate' });
    const plain = mon('plain', { abilityName: 'blaze' });

    expect(candidatePriority(supporter)).toBeGreaterThan(candidatePriority(plain));
  });

  it('scores the selected ability, not every ability the Pokemon has', () => {
    // Choosing Blaze over Intimidate should cost the credit; the browser
    // applies the override before ranking so the order follows the choice.
    const abilities = [{ name: 'blaze', is_hidden: false }, { name: 'intimidate', is_hidden: true }];
    const chosen = mon('incineroar', { abilityName: 'blaze', abilities });
    const alternative = mon('incineroar', { abilityName: 'intimidate', abilities });

    // Compared against the same Pokemon rather than a bare fixture, because
    // roles now come from two places: Incineroar can also burn, which
    // `getMoveSourcedRoles` reads off its name and which no ability choice
    // changes. Holding the name fixed isolates the thing under test.
    expect(candidatePriority(chosen)).toBeLessThan(candidatePriority(alternative));
    expect(candidatePriority(alternative) - candidatePriority(chosen))
      .toBeCloseTo(CANDIDATE_WEIGHTS.supportRole, 6);
  });

  it('credits a weather setter less than a role that works alone', () => {
    // Intimidate lands the moment its holder switches in. Drought changes the
    // field, which is worth nothing until a teammate wants it changed — and
    // team scoring is where that gets evaluated.
    const setter = mon('torkoal', { abilityName: 'drought' });
    const intimidator = mon('incineroar', { abilityName: 'intimidate' });
    const plain = mon('plain', { abilityName: 'blaze' });

    expect(candidatePriority(setter)).toBeGreaterThan(candidatePriority(plain));
    expect(candidatePriority(setter)).toBeLessThan(candidatePriority(intimidator));
  });

  it('ignores doubles-only roles in singles', () => {
    const redirector = mon('togedemaru', { abilityName: 'lightning-rod' });
    const plain = mon('plain', { abilityName: 'blaze' });

    // No ally to pull attacks away from.
    expect(candidatePriority(redirector, { hasAlly: false }))
      .toBe(candidatePriority(plain, { hasAlly: false }));
    expect(candidatePriority(redirector, { hasAlly: true }))
      .toBeGreaterThan(candidatePriority(plain, { hasAlly: true }));
  });

  it('credits Intimidate in both formats', () => {
    // Intimidate drops Attack whether or not a partner is on the field.
    const supporter = mon('incineroar', { abilityName: 'intimidate' });
    const plain = mon('plain', { abilityName: 'blaze' });

    expect(candidatePriority(supporter, { hasAlly: false }))
      .toBeGreaterThan(candidatePriority(plain, { hasAlly: false }));
  });

  it('does not let one role outrank a quadruple weakness', () => {
    // A support role is worth real points, but not enough to promote a Pokemon
    // that folds to a common type.
    //
    // The whole charge now runs through the defensive score, which modulates the
    // bulk term — so it scales with bulk, from about 1.0 point at 200 raw bulk to
    // 3.7 at 400. There is no single figure for `supportRole` to sit under, and
    // it is pinned at the weakest case instead. `mon()` builds a middling stat
    // line, so this asserts the invariant somewhere in the middle of that range;
    // the low end is what actually constrains the weight.
    const fragileSupporter = mon('fragile', {
      abilityName: 'intimidate', weaknesses: ['fire'], quadrupleWeaknesses: ['fire'],
      normalizedDamageFromScore: WITH_QUAD
    });

    expect(candidatePriority(fragileSupporter))
      .toBeLessThan(candidatePriority(mon('clean', { normalizedDamageFromScore: QUAD_FREE })));
  });
});

describe('generateRosters', () => {
  it('builds a full roster for the format', () => {
    const rosters = generateRosters({ pokemon: pool(12), format: doubles });

    expect(rosters.length).toBeGreaterThan(0);
    expect(rosters[0].members).toHaveLength(6);
    expect(rosters[0].evaluation.optionCount).toBe(15);
  });

  it('ranks rosters best first', () => {
    const scores = generateRosters({ pokemon: pool(12), format: doubles }).map((r) => r.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it('can field two Pokemon sharing a typing', () => {
    // The old type-based search made this impossible by construction.
    const shared = [
      mon('pelipper', { typeName: 'water/flying', types: ['water', 'flying'] }),
      mon('gyarados', { typeName: 'water/flying', types: ['water', 'flying'] }),
      mon('rotom', { typeName: 'electric/ghost', types: ['electric', 'ghost'] }),
      mon('metagross', { typeName: 'steel/psychic', types: ['steel', 'psychic'] })
    ];
    const rosters = generateRosters({ pokemon: shared, format: doubles, rosterSize: 4 });

    expect(rosters[0].members.map((m) => m.name).sort())
      .toEqual(['gyarados', 'metagross', 'pelipper', 'rotom']);
  });

  it('never repeats a species', () => {
    const forms = [
      mon('charizard', { speciesName: 'charizard' }),
      mon('charizard-mega-x', { speciesName: 'charizard' }),
      mon('charizard-mega-y', { speciesName: 'charizard' }),
      mon('blastoise', { speciesName: 'blastoise' }),
      mon('venusaur', { speciesName: 'venusaur' }),
      mon('pikachu', { speciesName: 'pikachu' })
    ];
    const rosters = generateRosters({ pokemon: forms, format: doubles, rosterSize: 4 });

    rosters.forEach((roster) => {
      const species = roster.members.map((m) => m.speciesName);
      expect(new Set(species).size).toBe(species.length);
    });
  });

  it('allows duplicate species when a format permits it', () => {
    const forms = [
      mon('charizard', { speciesName: 'charizard' }),
      mon('charizard-mega-x', { speciesName: 'charizard' }),
      mon('blastoise', { speciesName: 'blastoise' })
    ];
    const rosters = generateRosters({
      pokemon: forms, format: doubles, rosterSize: 3, allowDuplicateSpecies: true
    });

    expect(rosters[0].members).toHaveLength(3);
  });

  it('does not spend a slot on a type combination the roster already has', () => {
    // Reported case: seeding Goodra-Hisui and filling the roster added
    // Archaludon, which is the same Steel/Dragon. Redundancy is scored — the
    // pair contributes one set of resistances — but the charge competes with
    // individual quality, and Archaludon's edge covered all but 0.53 points of
    // it. The constraint states directly what the score only implies.
    const seed = [mon('goodra-hisui', { types: ['steel', 'dragon'], typeName: 'steel/dragon' })];
    const pokemon = [
      // Same typing, and deliberately the strongest thing in the pool.
      mon('archaludon', {
        types: ['steel', 'dragon'],
        typeName: 'steel/dragon',
        stats: { hp: 90, attack: 105, defense: 130, 'special-attack': 125, 'special-defense': 65, speed: 85 },
        normalizedDamageFromScore: 0.2
      }),
      mon('a', { types: ['water'], typeName: 'water' }),
      mon('b', { types: ['fire'], typeName: 'fire' }),
      mon('c', { types: ['grass'], typeName: 'grass' }),
      mon('d', { types: ['ghost'], typeName: 'ghost' }),
      mon('e', { types: ['fairy'], typeName: 'fairy' }),
      mon('f', { types: ['bug'], typeName: 'bug' })
    ];

    const rosters = generateRosters({ pokemon, format: doubles, seed });

    expect(rosters.length).toBeGreaterThan(0);
    rosters.forEach((roster) => {
      const typings = roster.members.map((m) => [...m.types].sort().join('/'));
      expect(new Set(typings).size, roster.members.map((m) => m.name).join(',')).toBe(typings.length);
    });
    expect(rosters[0].members.map((m) => m.name)).not.toContain('archaludon');
  });

  it('does not spend a slot on a weakness the roster already carries', () => {
    // Reported case: seeding Goodra-Hisui and filling the roster added
    // Excadrill. They are not the same typing, so the rule above does not catch
    // it. What makes it a bad pick is the doubled Fire and Fighting, which is
    // what this rule reads directly — the shared Steel was only ever a proxy
    // for it.
    const seed = [mon('goodra-hisui', {
      types: ['steel', 'dragon'], typeName: 'steel/dragon',
      weaknesses: ['fire', 'fighting', 'ground']
    })];
    const pokemon = [
      // Doubles two of the seed's weaknesses, and deliberately the strongest
      // thing in the pool so quality alone would take it.
      mon('excadrill', {
        types: ['ground', 'steel'],
        typeName: 'ground/steel',
        weaknesses: ['fire', 'fighting', 'water'],
        stats: { hp: 110, attack: 135, defense: 120, 'special-attack': 50, 'special-defense': 65, speed: 88 },
        normalizedDamageFromScore: 0.2
      }),
      mon('a', { types: ['water'], typeName: 'water', weaknesses: ['electric'] }),
      mon('b', { types: ['fire'], typeName: 'fire', weaknesses: ['water'] }),
      mon('c', { types: ['grass'], typeName: 'grass', weaknesses: ['bug'] }),
      mon('d', { types: ['ghost'], typeName: 'ghost', weaknesses: ['dark'] }),
      mon('e', { types: ['fairy'], typeName: 'fairy', weaknesses: ['poison'] }),
      mon('f', { types: ['bug'], typeName: 'bug', weaknesses: ['flying'] })
    ];

    const rosters = generateRosters({ pokemon, format: doubles, seed, unansweredWeaknessSlack: 0 });

    expect(rosters.length).toBeGreaterThan(0);
    expect(countSharedWeaknesses(rosters[0].members)).toBe(0);
    expect(rosters[0].members.map((m) => m.name)).not.toContain('excadrill');
  });

  it('does not charge for a shared weakness the roster answers', () => {
    // The whole reason this counts unanswered weaknesses rather than shared
    // ones. Two members weak to Ground is a hole; two members weak to Ground
    // with a third resisting it is a hole somebody covers.
    const shared = [
      mon('x', { types: ['rock'], weaknesses: ['ground'] }),
      mon('y', { types: ['fire'], weaknesses: ['ground'] })
    ];
    expect(countSharedWeaknesses(shared)).toBe(1);
    expect(countUnansweredWeaknesses(shared)).toBe(1);

    const answered = [...shared, mon('z', { types: ['flying'], resistances: ['ground'] })];
    expect(countSharedWeaknesses(answered)).toBe(1);
    expect(countUnansweredWeaknesses(answered)).toBe(0);
  });

  it('treats an immunity as an answer', () => {
    // `resistances` is the broad reduced-damage set and already carries the 0x
    // bucket, so Levitate needs no special case. Pinned because a future change
    // to createTypeSummary could quietly narrow that set.
    const roster = [
      mon('x', { weaknesses: ['ground'] }),
      mon('y', { weaknesses: ['ground'] }),
      mon('z', { resistances: ['ground'], immunities: ['ground'] })
    ];
    expect(countUnansweredWeaknesses(roster)).toBe(0);
  });

  it('finds a roster whose answer arrives after the weakness', () => {
    // The non-monotonicity that makes this measure awkward to search. Two strong
    // members share a Ground weakness, and the member that resists Ground sorts
    // last in the pool. A beam pruning on the count itself would drop the pair
    // before ever seeing the answer, and return nothing at budget 0.
    const strong = {
      stats: { hp: 110, attack: 135, defense: 120, 'special-attack': 120, 'special-defense': 110, speed: 100 },
      normalizedDamageFromScore: 0.2
    };
    const weakStats = {
      stats: { hp: 50, attack: 50, defense: 50, 'special-attack': 50, 'special-defense': 50, speed: 50 },
      normalizedDamageFromScore: 0.8
    };
    const pokemon = [
      mon('a', { types: ['rock'], typeName: 'rock', weaknesses: ['ground'], ...strong }),
      mon('b', { types: ['fire'], typeName: 'fire', weaknesses: ['ground'], ...strong }),
      mon('c', { types: ['water'], typeName: 'water', weaknesses: ['grass'], ...strong }),
      mon('d', { types: ['ghost'], typeName: 'ghost', weaknesses: ['dark'], ...strong }),
      mon('e', { types: ['fairy'], typeName: 'fairy', weaknesses: ['poison'], ...strong }),
      // Deliberately the weakest thing here, so candidate ranking puts it last.
      mon('answerer', { types: ['flying'], typeName: 'flying', resistances: ['ground'], ...weakStats })
    ];

    const rosters = generateRosters({ pokemon, format: doubles, unansweredWeaknessSlack: 0 });

    expect(rosters.length).toBeGreaterThan(0);
    expect(countUnansweredWeaknesses(rosters[0].members)).toBe(0);
    // Both Ground-weak members and the answer, which only fits because the
    // search pruned on a bound rather than on the count.
    expect(rosters[0].members.map((m) => m.name).sort())
      .toEqual(['a', 'answerer', 'b', 'c', 'd', 'e']);
  });

  it('takes the doubled-up Pokemon once a teammate answers what it doubles', () => {
    // The other side of the reported case, and the point of counting unanswered
    // weaknesses rather than shared ones. The pool is identical to the test
    // above except that two members now resist Fire and Fighting — so the pair
    // Goodra-Hisui and Excadrill costs nothing, and the generator takes the
    // strongest thing available instead of refusing it on a technicality.
    //
    // Under countSharedWeaknesses this roster was impossible at the default: the
    // pair spent 2 whatever the rest of the team could cover.
    const seed = [mon('goodra-hisui', {
      types: ['steel', 'dragon'], typeName: 'steel/dragon',
      weaknesses: ['fire', 'fighting', 'ground']
    })];
    const pokemon = [
      mon('excadrill', {
        types: ['ground', 'steel'],
        typeName: 'ground/steel',
        weaknesses: ['fire', 'fighting', 'water'],
        stats: { hp: 110, attack: 135, defense: 120, 'special-attack': 50, 'special-defense': 65, speed: 88 },
        normalizedDamageFromScore: 0.2
      }),
      mon('a', { types: ['water'], typeName: 'water', weaknesses: ['electric'], resistances: ['fire'] }),
      mon('b', { types: ['fire'], typeName: 'fire', weaknesses: ['water'], resistances: ['fire'] }),
      mon('c', { types: ['grass'], typeName: 'grass', weaknesses: ['bug'], resistances: ['ground'] }),
      mon('d', { types: ['ghost'], typeName: 'ghost', weaknesses: ['dark'], resistances: ['fighting'] }),
      mon('e', { types: ['fairy'], typeName: 'fairy', weaknesses: ['poison'], resistances: ['fighting'] }),
      mon('f', { types: ['bug'], typeName: 'bug', weaknesses: ['flying'], resistances: ['water'] })
    ];

    const rosters = generateRosters({ pokemon, format: doubles, seed });

    expect(rosters[0].members.map((m) => m.name)).toContain('excadrill');
    expect(countUnansweredWeaknesses(rosters[0].members))
      .toBeLessThanOrEqual(DEFAULT_UNANSWERED_WEAKNESS_SLACK);
    // And it really is a roster the shared-weakness rule would have refused.
    expect(countSharedWeaknesses(rosters[0].members)).toBeGreaterThan(0);
  });

  it('allows a shared type when the weaknesses do not actually overlap', () => {
    // The 10.7% of type-sharing pairs the old proxy refused for no defensive
    // reason. Both are Steel; the second type undoes the first, so they share no
    // weakness at all and there is nothing to charge them for.
    const seed = [mon('goodra-hisui', {
      types: ['steel', 'dragon'], typeName: 'steel/dragon',
      weaknesses: ['fire', 'fighting', 'ground']
    })];
    const pokemon = [
      mon('skarmory', {
        types: ['steel', 'flying'], typeName: 'steel/flying',
        weaknesses: ['electric'],
        stats: { hp: 110, attack: 135, defense: 120, 'special-attack': 50, 'special-defense': 65, speed: 88 },
        normalizedDamageFromScore: 0.2
      }),
      mon('a', { types: ['water'], typeName: 'water', weaknesses: ['grass'] }),
      mon('b', { types: ['fire'], typeName: 'fire', weaknesses: ['water'] }),
      mon('c', { types: ['grass'], typeName: 'grass', weaknesses: ['bug'] }),
      mon('d', { types: ['ghost'], typeName: 'ghost', weaknesses: ['dark'] }),
      mon('e', { types: ['fairy'], typeName: 'fairy', weaknesses: ['poison'] })
    ];

    const rosters = generateRosters({ pokemon, format: doubles, seed });

    expect(rosters.length).toBeGreaterThan(0);
    expect(rosters[0].members.map((m) => m.name)).toContain('skarmory');
    // And the roster it produced really does double a type, which is exactly
    // what the old rule existed to prevent.
    expect(countTypeOverlap(rosters[0].members)).toBeGreaterThan(0);
  });

  it('spends the fewest shared weaknesses the pool allows', () => {
    // The budget must *loosen*, not switch off. Three strong Pokemon that
    // pairwise share a weakness, and four clean but weaker ones. Six members
    // means taking two of the three, so a zero-overlap roster does not exist —
    // but one repeat is enough, and the search must stop there rather than
    // taking all three strong ones and spending three.
    const strong = {
      stats: { hp: 110, attack: 135, defense: 120, 'special-attack': 120, 'special-defense': 110, speed: 100 },
      normalizedDamageFromScore: 0.2
    };
    const pokemon = [
      mon('a', { types: ['steel'], typeName: 'steel', weaknesses: ['fire', 'ground'], ...strong }),
      mon('b', { types: ['rock'], typeName: 'rock', weaknesses: ['fire', 'water'], ...strong }),
      mon('c', { types: ['ice'], typeName: 'ice', weaknesses: ['ground', 'water'], ...strong }),
      mon('d', { types: ['grass'], typeName: 'grass', weaknesses: ['bug'] }),
      mon('e', { types: ['ghost'], typeName: 'ghost', weaknesses: ['dark'] }),
      mon('f', { types: ['fairy'], typeName: 'fairy', weaknesses: ['poison'] }),
      mon('g', { types: ['bug'], typeName: 'bug', weaknesses: ['flying'] })
    ];

    const constrained = generateRosters({ pokemon, format: doubles, unansweredWeaknessSlack: 0 });
    const unconstrained = generateRosters({ pokemon, format: doubles, allowDuplicateTypings: true });

    expect(constrained.length).toBeGreaterThan(0);
    expect(constrained[0].members).toHaveLength(6);
    expect(countSharedWeaknesses(constrained[0].members)).toBe(1);
    // Non-vacuous: left alone the search takes all three strong ones and pays
    // three repeats for them.
    expect(countSharedWeaknesses(unconstrained[0].members))
      .toBeGreaterThan(countSharedWeaknesses(constrained[0].members));
  });

  it('finds the true minimum rather than the first budget it tries', () => {
    // The bisection replaced a scan from zero, and bisection is only correct
    // because feasibility is monotone in the budget. If it ever returned a
    // roster at B when one exists at B-1, this is what would catch it.
    const pokemon = [
      mon('a', { types: ['steel'], weaknesses: ['fire', 'ground'] }),
      mon('b', { types: ['rock'], weaknesses: ['fire', 'water'] }),
      mon('c', { types: ['ice'], weaknesses: ['ground', 'water'] }),
      mon('d', { types: ['grass'], weaknesses: ['bug'] }),
      mon('e', { types: ['ghost'], weaknesses: ['dark'] }),
      mon('f', { types: ['fairy'], weaknesses: ['poison'] }),
      mon('g', { types: ['bug'], weaknesses: ['flying'] })
    ];

    const best = generateRosters({ pokemon, format: doubles, unansweredWeaknessSlack: 0 });
    const achieved = countSharedWeaknesses(best[0].members);

    // Every six-member combination of this pool, checked exhaustively.
    let trueMinimum = Infinity;
    const combos = (start: number, picked: typeof pokemon): void => {
      if (picked.length === 6) {
        trueMinimum = Math.min(trueMinimum, countSharedWeaknesses(picked));
        return;
      }
      for (let i = start; i < pokemon.length; i++) combos(i + 1, [...picked, pokemon[i]]);
    };
    combos(0, []);

    expect(achieved).toBe(trueMinimum);
  });

  it('returns a roster rather than failing when every type must repeat', () => {
    // A user filtered down to one type. Refusing to answer is worse advice than
    // answering with the only roster available.
    const pokemon = Array.from({ length: 6 }, (_, i) =>
      mon(`steel-${i}`, { types: ['steel'], typeName: 'steel' }));

    const rosters = generateRosters({ pokemon, format: doubles });

    expect(rosters.length).toBeGreaterThan(0);
    expect(rosters[0].members).toHaveLength(6);
  });

  it('treats a type combination as the same in either slot order', () => {
    const seed = [mon('seeded', { types: ['steel', 'dragon'] })];
    const pokemon = [
      mon('reversed', { types: ['dragon', 'steel'] }),
      ...['water', 'fire', 'grass', 'ghost', 'fairy'].map((t) => mon(t, { types: [t] }))
    ];

    const rosters = generateRosters({ pokemon, format: doubles, seed });

    rosters.forEach((roster) => {
      expect(roster.members.map((m) => m.name)).not.toContain('reversed');
    });
  });

  it('doubles a typing rather than failing when the pool cannot avoid it', () => {
    // A user can filter the browser down to a handful of typings. Returning no
    // roster there would be worse advice than returning one that doubles up.
    const pokemon = [
      mon('p1', { types: ['steel', 'dragon'] }),
      mon('p2', { types: ['steel', 'dragon'] }),
      mon('p3', { types: ['steel', 'dragon'] }),
      mon('p4', { types: ['steel', 'dragon'] })
    ];

    const rosters = generateRosters({ pokemon, format: doubles, rosterSize: 4 });

    expect(rosters.length).toBeGreaterThan(0);
    expect(rosters[0].members).toHaveLength(4);
  });

  it('honours an explicit request to allow duplicate typings', () => {
    const pokemon = [
      mon('x', { types: ['steel', 'dragon'] }),
      mon('y', { types: ['steel', 'dragon'] }),
      mon('z', { types: ['water'] }),
      mon('w', { types: ['fire'] })
    ];

    const rosters = generateRosters({
      pokemon, format: doubles, rosterSize: 4, allowDuplicateTypings: true
    });

    expect(rosters[0].members.map((m) => m.name).sort()).toEqual(['w', 'x', 'y', 'z']);
  });

  it('keeps every seeded Pokemon', () => {
    const seed = [mon('locked-a', { typeName: 'ta' }), mon('locked-b', { typeName: 'tb' })];
    const rosters = generateRosters({ pokemon: pool(10), format: doubles, seed });

    rosters.forEach((roster) => {
      const names = roster.members.map((m) => m.name);
      expect(names).toContain('locked-a');
      expect(names).toContain('locked-b');
    });
  });

  it('never duplicates a seeded Pokemon already present in the pool', () => {
    const shared = pool(8);
    const rosters = generateRosters({ pokemon: shared, format: doubles, seed: [shared[0]] });

    rosters.forEach((roster) => {
      const names = roster.members.map((m) => m.name);
      expect(new Set(names).size).toBe(names.length);
    });
  });

  it('returns nothing when the pool cannot fill a roster', () => {
    expect(generateRosters({ pokemon: pool(2), format: doubles })).toEqual([]);
    expect(generateRosters({ pokemon: pool(10), format: doubles, rosterSize: 0 })).toEqual([]);
  });

  it('returns nothing when the seed exceeds the roster size', () => {
    const seed = pool(7);
    expect(generateRosters({ pokemon: pool(10), format: doubles, seed, rosterSize: 6 })).toEqual([]);
  });

  it('builds smaller rosters for singles when asked', () => {
    const rosters = generateRosters({ pokemon: pool(12), format: singles, rosterSize: 3 });

    expect(rosters[0].members).toHaveLength(3);
    expect(rosters[0].evaluation.optionCount).toBe(1);
  });

  it('stays tractable on a large pool', () => {
    const started = Date.now();
    const rosters = generateRosters({ pokemon: pool(600), format: doubles });

    expect(rosters.length).toBeGreaterThan(0);
    // Candidate pruning is what keeps this bounded; without it the beam would
    // expand across the whole pool.
    expect(Date.now() - started).toBeLessThan(15000);
  });
});
