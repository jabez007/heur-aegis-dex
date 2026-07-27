/**
 * Validation fixture for the scoring weights.
 *
 * Every other test here checks that a formula computes what it says it
 * computes. None of them check whether the formula is *right* — and the weights
 * across MEMBER_WEIGHTS, CANDIDATE_WEIGHTS, MIXED_ATTACKER_RATIO and the
 * synergy sets were all argued from structure rather than measured against
 * anything. This file is the counterweight: real Pokemon, real teams, and
 * judgements about them that the scoring has to agree with.
 *
 * ## What these assertions are, and are not
 *
 * They are **ordinal**. A team judged stronger must score higher than one judged
 * weaker; no assertion names a number. Absolute thresholds would fail on every
 * weight change regardless of whether the change was an improvement, which
 * trains people to update the expected values without reading them.
 *
 * They are **judgement**, not ground truth. Nobody has played these teams. They
 * encode the reasoning a competitive player would apply — typing overlap,
 * shared weaknesses, role coverage, whether a Pokemon threatens anything — and
 * that reasoning is written next to each team so it can be argued with. A
 * failure here means the scoring and the stated judgement disagree; which of
 * the two is wrong is a question for whoever reads it, not a foregone
 * conclusion.
 *
 * The pairs are deliberately uneven in difficulty. Some are wide, to catch a
 * scoring change that breaks something basic. The narrow ones near the bottom
 * are where the weights actually get tested.
 */

import { describe, expect, it } from 'vitest';
import { SCORING_FIXTURE_POKEMON } from './scoring.fixture';
import { CANDIDATE_WEIGHTS, candidatePriority } from './rosterGeneration';
import { scoreMemberQuality } from './teamScoring';
import { evaluateRoster, type RosterMember } from './rosterScoring';
import { BATTLE_FORMATS } from './battleFormats';
import type { PokemonEntry } from './pokemonEntry';

const mon = (name: string): PokemonEntry => {
  const entry = SCORING_FIXTURE_POKEMON[name];
  if (!entry) throw new Error(`fixture has no ${name}; add it to scripts/gen-scoring-fixture.mjs`);
  return entry;
};

const team = (...names: string[]): PokemonEntry[] => names.map(mon);

const toRosterMember = (entry: PokemonEntry): RosterMember => ({
  name: entry.name,
  types: entry.types,
  abilityName: entry.abilityName,
  stats: entry.stats,
  weaknesses: entry.weaknesses,
  quadruple_weaknesses: entry.quadrupleWeaknesses,
  resistances: entry.resistances,
  immunities: entry.immunities,
  coverages: entry.coverages,
  moveCoverages: entry.moveCoverages,
  normalizedDamageToScore: entry.normalizedDamageToScore,
  normalizedDamageFromScore: entry.normalizedDamageFromScore
});

const scoreTeam = (members: PokemonEntry[], format = BATTLE_FORMATS.doubles) =>
  evaluateRoster(members.map(toRosterMember), { format }).score;

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

/**
 * Each team carries the reasoning behind its placement. Disagree with the
 * reasoning and the assertion should change with it.
 */
const TEAMS = {
  balance: {
    label: 'balance',
    why: 'Spread typings, no shared weakness worse than a pair, Intimidate on the front, '
      + 'and every member threatens something. The shape most VGC teams take.',
    members: team('incineroar', 'dragonite', 'garchomp', 'metagross', 'milotic', 'clefable')
  },
  sun: {
    label: 'sun',
    why: 'A weather setter with abusers behind it. Torkoal is individually mediocre; the '
      + 'team is not, because the ability is the point.',
    members: team('torkoal', 'venusaur', 'charizard', 'arcanine', 'sylveon', 'metagross')
  },
  defensiveCore: {
    label: 'defensive core',
    why: 'Steel and Fairy walls with real resistance coverage, but light on threats. '
      + 'Should beat the junk teams comfortably and lose to balance.',
    members: team('skarmory', 'forretress', 'klefki', 'clefable', 'milotic', 'whimsicott')
  },

  monoFire: {
    label: 'mono-Fire',
    why: 'Six Fire types. Every member folds to Water, Ground and Rock, and nothing on the '
      + 'team resists any of them. The clearest failure a coverage model should catch.',
    members: team('torkoal', 'charizard', 'arcanine', 'simisear', 'camerupt', 'salazzle')
  },
  junk: {
    label: 'junk',
    why: 'Legal, breedable, and hopeless: low stats, no roles, nothing threatened. If this '
      + 'ever outscores a real team the scoring is not measuring anything.',
    members: team('pikachu', 'castform', 'watchog', 'emolga', 'dedenne', 'liepard')
  },
  overlappingThreats: {
    label: 'overlapping threats',
    why: 'Six genuinely strong attackers that all fold to the same coverage. Ground hits four '
      + 'of them, Fighting and Psychic most of the rest, and two carry a 4x weakness. '
      + 'Individually the best team here; collectively one Landorus away from losing. This is '
      + 'the case that separates synergy scoring from summing member quality.',
    members: team('garchomp', 'sneasler', 'annihilape', 'kingambit', 'lucario', 'glimmora')
  }
} as const;

// ---------------------------------------------------------------------------

describe('scoring validation — member ranking', () => {
  it('ranks a strong attacker above an elite wall with no offence', () => {
    // The case that prompted this fixture. Klefki's Steel/Fairy resists nearly
    // everything; its 80/80 offences threaten nobody.
    expect(candidatePriority(mon('lucario'))).toBeGreaterThan(candidatePriority(mon('klefki')));
    expect(candidatePriority(mon('incineroar'))).toBeGreaterThan(candidatePriority(mon('klefki')));
  });

  it('ranks the better Pokemon ahead when typing is identical', () => {
    // Skeledirge and Typhlosion-Hisui are both Fire/Ghost, so typing cancels
    // exactly and the comparison is stats and abilities alone. Typhlosion-H has
    // the better raw line — more offence, more speed, less bulk — and used to
    // win on that. Skeledirge is the better Pokemon because of Unaware, which
    // nothing modelled until abilityEffects.ts existed.
    expect(mon('skeledirge').types).toEqual(mon('typhlosion-hisui').types);
    expect(candidatePriority(mon('skeledirge')))
      .toBeGreaterThan(candidatePriority(mon('typhlosion-hisui')));
  });

  it('ranks recognised threats above recognised filler', () => {
    const threats = ['garchomp', 'dragonite', 'metagross', 'kingambit', 'volcarona'];
    const filler = ['pikachu', 'watchog', 'emolga', 'dedenne', 'castform'];

    const worstThreat = Math.min(...threats.map((n) => candidatePriority(mon(n))));
    const bestFiller = Math.max(...filler.map((n) => candidatePriority(mon(n))));

    expect(worstThreat).toBeGreaterThan(bestFiller);
  });

  it('does not rank a support Pokemon above a comparable one without a role', () => {
    // Intimidate should be worth something, but not enough to invert a real
    // gap in stats and typing.
    expect(candidatePriority(mon('arbok'))).toBeLessThan(candidatePriority(mon('garchomp')));
  });

  it('keeps the adjustment terms small against the spread of member quality', () => {
    // The structural invariant behind the ordering assertions above, and the
    // one that would have caught the original miscalibration on its own.
    //
    // candidatePriority is `quality * 100` plus adjustments. The adjustments
    // exist to reorder Pokemon whose quality is close; if their combined swing
    // approaches the spread of quality itself, they stop adjusting and start
    // deciding. That is exactly how supportRole 12 and quadrupleWeakness 15 —
    // both carried over from a formula whose terms ran to 44 — put Arbok above
    // Garchomp on a scale that only spans about 30.
    //
    // Measured against the fixture rather than assumed, so it tracks the real
    // distribution instead of a remembered one.
    const qualities = Object.values(SCORING_FIXTURE_POKEMON)
      .map((entry) => scoreMemberQuality(entry) * CANDIDATE_WEIGHTS.quality);
    const spread = Math.max(...qualities) - Math.min(...qualities);

    // The worst case for one Pokemon: it gains a role while another loses a
    // quadruple weakness.
    const largestSwing = CANDIDATE_WEIGHTS.supportRole + CANDIDATE_WEIGHTS.quadrupleWeakness;

    expect(
      largestSwing,
      `adjustments can swing ${largestSwing} against a quality spread of ${spread.toFixed(1)}`
    ).toBeLessThan(spread / 2);
  });
});

describe('scoring validation — team ranking', () => {
  const strong = [TEAMS.balance, TEAMS.sun, TEAMS.defensiveCore];
  const weak = [TEAMS.monoFire, TEAMS.junk, TEAMS.overlappingThreats];

  it('scores every considered team above every discarded one', () => {
    // The full cross product, so one lucky pairing cannot hide a failure.
    strong.forEach((good) => {
      weak.forEach((bad) => {
        const goodScore = scoreTeam(good.members);
        const badScore = scoreTeam(bad.members);
        expect(
          goodScore,
          `${good.label} (${goodScore.toFixed(1)}) should beat ${bad.label} (${badScore.toFixed(1)})\n`
          + `  ${good.label}: ${good.why}\n  ${bad.label}: ${bad.why}`
        ).toBeGreaterThan(badScore);
      });
    });
  });

  it('punishes stacking one typing', () => {
    // Mono-Fire shares every weakness and resists none of them. It should sit
    // below a team of comparable individual quality with spread typings.
    const stacked = scoreTeam(TEAMS.monoFire.members);
    const spread = scoreTeam(TEAMS.balance.members);

    expect(spread - stacked, `mono-Fire ${stacked.toFixed(1)} vs balance ${spread.toFixed(1)}`)
      .toBeGreaterThan(5);
  });

  it('values a weather core built around a mediocre setter', () => {
    // Torkoal alone ranks poorly. A scoring model that only summed member
    // quality would reject the team it makes possible.
    expect(candidatePriority(mon('torkoal'))).toBeLessThan(candidatePriority(mon('metagross')));
    expect(scoreTeam(TEAMS.sun.members)).toBeGreaterThan(scoreTeam(TEAMS.overlappingThreats.members));
  });

  it('rates synergy above raw member quality', () => {
    // The narrow one, and the point of having synergy weights at all: a team of
    // individually stronger Pokemon that share weaknesses should lose to a
    // team of individually weaker Pokemon that cover each other.
    const individualQuality = (members: PokemonEntry[]) =>
      members.reduce((total, m) => total + candidatePriority(m), 0) / members.length;

    const frail = TEAMS.overlappingThreats.members;
    const core = TEAMS.defensiveCore.members;

    expect(individualQuality(frail)).toBeGreaterThan(individualQuality(core));
    expect(scoreTeam(core)).toBeGreaterThan(scoreTeam(frail));
  });
});

describe('scoring validation — format sensitivity', () => {
  it('scores the same roster differently in singles and doubles', () => {
    // Bring size and the synergy weights both change with the format, so a
    // roster that is identical in both is a sign the format is being ignored.
    const doubles = scoreTeam(TEAMS.balance.members, BATTLE_FORMATS.doubles);
    const singles = scoreTeam(TEAMS.balance.members, BATTLE_FORMATS.singles);

    expect(doubles).not.toBeCloseTo(singles, 5);
  });

  it('keeps the strong-beats-weak ordering in singles too', () => {
    const good = scoreTeam(TEAMS.balance.members, BATTLE_FORMATS.singles);
    const bad = scoreTeam(TEAMS.junk.members, BATTLE_FORMATS.singles);

    expect(good).toBeGreaterThan(bad);
  });
});

describe('scoring validation — fixture integrity', () => {
  it('carries the resolved fields scoring depends on', () => {
    Object.entries(SCORING_FIXTURE_POKEMON).forEach(([name, entry]) => {
      expect(entry.stats.hp, `${name} has no stats`).toBeGreaterThan(0);
      expect(entry.types.length, `${name} has no types`).toBeGreaterThan(0);
      expect(entry.abilityName, `${name} has no ability`).toBeTruthy();
      expect(entry.normalizedDamageFromScore, `${name} defensive score out of range`)
        .toBeGreaterThanOrEqual(0);
      expect(entry.normalizedDamageFromScore).toBeLessThanOrEqual(1);
      expect(entry.normalizedDamageToScore).toBeGreaterThanOrEqual(0);
      expect(entry.normalizedDamageToScore).toBeLessThanOrEqual(1);
    });
  });

  it('names an ability the Pokemon actually has', () => {
    Object.entries(SCORING_FIXTURE_POKEMON).forEach(([name, entry]) => {
      expect(entry.abilities.map((a) => a.name), `${name}`).toContain(entry.abilityName);
    });
  });
});
