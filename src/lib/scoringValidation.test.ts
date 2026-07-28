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
 *
 * ## Scope: the scoring, not the browser
 *
 * These judge `scoreMemberQuality` and `candidatePriority` **in general**, with
 * no type filter applied. That is why Garchomp, Dragonite, Kingambit and
 * Annihilape appear here despite `typeFilters` keeping them out of a default
 * scan: `maxDamageFromScore` and `limitQuadrupleDamage` are a lens the user
 * chooses over a sound ranking, not part of the ranking itself.
 *
 * Restricting the fixture to typings that survive those filters would be a
 * mistake in both directions. It would stop the fixture catching a scoring bug
 * that only shows on an excluded Pokemon, and it would quietly couple the
 * scoring's correctness to one particular filter setting — so changing a filter
 * default would read as a scoring regression. Recorded because it is not
 * obvious from the code, and reading the two files together suggests the
 * opposite conclusion.
 */

import { describe, expect, it } from 'vitest';
import { SCORING_FIXTURE_POKEMON, SCORING_FIXTURE_RAW_SCORES } from './scoring.fixture';
import { CANDIDATE_WEIGHTS, candidatePriority } from './rosterGeneration';
import {
  DEFAULT_BASE_SCORE, normalizeDamageFromScore, normalizeDamageToScore
} from './pokedexScoring';
import {
  COMPOSITE_BOUNDS,
  COMPOSITE_WEIGHTS,
  effectiveOffense,
  scoreMemberQuality,
  scoreTeamSynergy
} from './teamScoring';
import { evaluateRoster, type RosterMember } from './rosterScoring';
import { analyzeTeamCoverage } from './teamCoverage';
import { analyzeTeamRoles, isImmuneToAllyMoves } from './abilityRoles';
import { BATTLE_FORMATS, type BattleFormat } from './battleFormats';
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

/**
 * The two halves `composeTeamScore` blends, before weighting or rescaling.
 *
 * Recomputed here rather than read off a score, because the balance between them
 * is the thing under test and a composed score cannot be taken apart again.
 */
const compositeHalves = (members: PokemonEntry[], format: BattleFormat) => {
  const coverage = analyzeTeamCoverage(members.map((member) => ({
    ...toRosterMember(member),
    immuneToAllyMoves: format.hasAlly && isImmuneToAllyMoves(member.abilityName)
  })));
  const roles = analyzeTeamRoles(
    members.map((member) => ({ abilityName: member.abilityName })),
    { hasAlly: format.hasAlly }
  );
  const qualities = members.map((member) => scoreMemberQuality(member));

  return {
    quality: qualities.reduce((total, quality) => total + quality, 0) / qualities.length,
    synergy: scoreTeamSynergy({
      coverage,
      roles,
      format,
      typesTotal: new Set(members.flatMap((member) => member.types)).size,
      teamSize: members.length,
      typeCount: DEFAULT_BASE_SCORE
    })
  };
};

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
    why: 'Individually the strongest team here — the highest average member quality of any '
      + 'of them — and stacked three deep on the failure the model charges hardest for. '
      + 'Dragonite and Garchomp both fold to Ice, Kingambit and Tyranitar both to Fighting, '
      + 'Volcarona and Charizard both to Rock, every one of those a 4x. Three common moves '
      + 'two-for-one this roster. The case that separates synergy scoring from summing '
      + 'member quality.',
    members: team('dragonite', 'garchomp', 'kingambit', 'tyranitar', 'volcarona', 'charizard')
  },

  /**
   * This was `overlappingThreats` until the composite bounds were measured, on a
   * description that did not match it: it claimed the members shared a quadruple
   * weakness, and they do not. Garchomp, Sneasler, Kingambit and Glimmora carry
   * one *each* — to Ice, Psychic, Fighting and Ground — so `sharedQuadrupleWeakness`,
   * the heaviest penalty in the model at 1.5, never fired on it at all.
   *
   * Under the old compressed scale synergy outvoted its member quality anyway and
   * it scored below the defensive core, so the fixture agreed with its assertion
   * for a reason nobody had checked.
   */
  strongAttackers: {
    label: 'strong attackers',
    why: 'Bulky attackers with unshared weaknesses. Placed above the defensive core '
      + 'deliberately — see the assertion, which turns on the two teams having the same bulk.',
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

  it('ranks defensive walls above bulky Pokemon with ordinary typing', () => {
    // The reported symptom of the compressed typing signal, kept as the case
    // that has to stay fixed.
    //
    // Skarmory and Corviknight resist ten types and are immune to two. Blastoise
    // and Feraligatr resist four and are immune to none — but carry comparable
    // raw bulk, and more offence. Under the old formula-extreme normalization
    // that twelve-versus-four difference was worth a 3.6% multiplier on one
    // term, so the water starters won on offence and led both walls.
    //
    // This is the assertion the tool exists to get right: resisting most of the
    // chart is what defensive typing *is*, and it has to outweigh being merely
    // bulky. If it fails, check pokedexScoring's bounds before touching a weight.
    const walls = ['skarmory', 'corviknight'];
    const bulky = ['blastoise', 'feraligatr'];

    const worstWall = Math.min(...walls.map((n) => candidatePriority(mon(n))));
    const bestBulky = Math.max(...bulky.map((n) => candidatePriority(mon(n))));

    expect(worstWall).toBeGreaterThan(bestBulky);
  });

  it('rates a one-sided attacker on the stat it actually attacks with', () => {
    // Azumarill swings the 100 Attack Huge Power built for it and never touches
    // its 60 Special Attack. Blastoise has 83/85, neither notable. Under the old
    // `attack + special-attack` term that was 160 against 168 — Blastoise scored
    // *higher* on offence, describing a Pokemon that does not exist. It is the
    // same objection coverageMoves.ts already raised one layer up, where
    // getAttackerBias refuses to credit Pelipper with physical coverage.
    expect(effectiveOffense(mon('azumarill').stats))
      .toBeGreaterThan(effectiveOffense(mon('blastoise').stats));

    // Klefki is the sharper case. rosterGeneration.ts records "Klefki's unusable
    // 80/80 offences counted the same as Lucario's 110/115" as a defect it fixed
    // — but it only fixed the stat-blind half. The offence term went on crediting
    // 80/80 as a threat until effectiveOffense landed.
    expect(effectiveOffense(mon('azumarill').stats))
      .toBeGreaterThan(effectiveOffense(mon('klefki').stats));

    // Klefki is where it has to carry through to the final order, and it is the
    // cleanest test in this file for why the STAB `coverage` term was removed.
    //
    // Azumarill and Klefki hit the *same number* of types super-effectively off
    // their STAB — six each. The old stat-independent coverage term therefore
    // paid them identically, 4.5 points apiece, for Azumarill's 100 Attack and
    // Klefki's 80/80. Routing that charge through the offence term instead
    // scales it by effectiveOffense, so identical breadth stops being identical
    // value when one Pokemon cannot back it.
    expect(mon('azumarill').coverages.length).toBe(mon('klefki').coverages.length);
    expect(candidatePriority(mon('azumarill'))).toBeGreaterThan(candidatePriority(mon('klefki')));
  });

  it('does not pretend Azumarill wins on member quality', () => {
    // The counterweight to the assertion above, and the honest limit of it.
    //
    // Azumarill has the *lowest* member quality of that group — 260 bulk and 50
    // Speed are genuinely worse than Blastoise's 284 and 78, and the model is
    // right about that. It outranks them on coverage breadth, not on quality.
    //
    // What actually makes Azumarill good is Belly Drum and Aqua Jet: a setup
    // move and a priority move that between them answer the low Speed the model
    // penalises. Neither is visible to a scan that sees no moves beyond coverage
    // types, so no weight should be tuned until this reads "correct" — that
    // would be fitting the stat model to compensate for a missing move model.
    // The same trap as the documented Trick Room bias in MEMBER_WEIGHTS.
    //
    // Azumarill did briefly outrank Blastoise outright, on the STAB `coverage`
    // term that charged offensive breadth at 1.84x. Removing that double count
    // handed most of it back, which is the correct outcome and worth recording:
    // the ordering had been resting on an arithmetic error rather than on
    // anything the model believed.
    expect(scoreMemberQuality(mon('azumarill')))
      .toBeLessThan(scoreMemberQuality(mon('blastoise')));
    expect(candidatePriority(mon('azumarill')))
      .toBeLessThan(candidatePriority(mon('blastoise')));
  });

  it('does not demote a Pokemon for the weakness its typing already pays for', () => {
    // Scizor is nine resistances, one immunity and exactly one weakness. That
    // weakness being 4x Fire was charged three times over: by the defensive
    // score, by a flat penalty in candidatePriority, and again by team scoring.
    // The middle one put Scizor below Blastoise, Feraligatr and Klefki despite
    // beating all three on member quality, and has been removed.
    //
    // The assertion is on quality *and* rank together on purpose. If a later
    // change reintroduces a flat penalty, rank alone could be restored by
    // inflating something else; requiring the quality ordering to agree with the
    // final ordering is what makes this a claim about the model rather than a
    // claim about one number.
    const scizor = mon('scizor');
    ['blastoise', 'feraligatr', 'klefki'].forEach((name) => {
      expect(scoreMemberQuality(scizor)).toBeGreaterThan(scoreMemberQuality(mon(name)));
      expect(
        candidatePriority(scizor),
        `Scizor beats ${name} on member quality but not on final rank`
      ).toBeGreaterThan(candidatePriority(mon(name)));
    });
  });

  it('does not let a support role outrank a real quality gap', () => {
    // Staraptor has the lowest member quality of these three and led both, on
    // Intimidate paying +4 while their quadruple weaknesses charged -5 each.
    // Both weights were sized against a compressed quality scale; neither was
    // wrong in isolation, and the pair of them inverted a 4-point gap.
    //
    // Deliberately not asserting that Staraptor ranks last — it is a genuinely
    // fast attacker with a real ability, and the claim is only that a role does
    // not buy a Pokemon past two that beat it on the merits.
    expect(candidatePriority(mon('swampert')))
      .toBeGreaterThan(candidatePriority(mon('staraptor')));
    expect(candidatePriority(mon('scizor')))
      .toBeGreaterThan(candidatePriority(mon('staraptor')));
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

    // The worst case for one Pokemon: it gains a role and the broadest move
    // coverage in the pool while a rival has neither.
    //
    // The maxima are *measured* off the fixture rather than guessed. An earlier
    // version of this guard hardcoded "a few of each" — 4 coverage types and 6
    // move types — which understated the real spread and let the budget be
    // exceeded while the test stayed green. Deriving them is the same discipline
    // the spread below already uses, and it was inconsistent not to.
    const maxMoveCoverage = Math.max(
      ...Object.values(SCORING_FIXTURE_POKEMON).map((entry) => entry.moveCoverages.length)
    );
    const largestSwing = CANDIDATE_WEIGHTS.supportRole
      + (maxMoveCoverage * CANDIDATE_WEIGHTS.moveCoverage);

    expect(
      largestSwing,
      `adjustments can swing ${largestSwing} against a quality spread of ${spread.toFixed(1)}`
    ).toBeLessThan(spread / 2);
  });
});

describe('scoring validation — team ranking', () => {
  const strong = [TEAMS.balance, TEAMS.sun, TEAMS.defensiveCore, TEAMS.strongAttackers];
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

  it('ranks bulky attackers above walls that cannot threaten anything', () => {
    // The position, and the reasoning it stands on.
    //
    // This project's premise is a pipeline: a strong defensive typing, then
    // decent bulk within it, then a real attacking stat out of what survives.
    // Judge the two teams gate by gate and the answer is not close:
    //
    //   gate 1, defensive typing — the walls win, seventeen unique resistances
    //           to sixteen. This is the whole point of the team.
    //   gate 2, decent bulk      — a TIE. Averaged over the six, bulk is 0.651
    //           for the core and 0.649 for the attackers.
    //   gate 3, an attacking stat — the attackers win outright, 0.747 to 0.543.
    //
    // Gate 2 is the one that decides it, and it is the one that surprises. The
    // usual case against a team of attackers is that it trades a turn for a KO
    // and then dies. That is not this team: Garchomp is 108/95/85, Annihilape
    // 110/80/90, Kingambit 100/120/85. Only Lucario and Sneasler are frail. They
    // are bulky attackers, so the objection does not apply and the walls' one
    // advantage is a typing edge worth about a resistance.
    //
    // Gate 3 the walls fail outright. Their best attacking stats are 80, 90, 80,
    // 95, 100 and 77 — not one above 100 in a format where the attackers bring
    // four at 130 or better. A team that cannot KO does not win; it stalls until
    // the clock or chip damage decides, which is losing slowly.
    //
    // The margin should stay narrow, and the assertion below deliberately does
    // not demand otherwise. Both teams fail the pipeline, in opposite directions:
    // the walls at gate 3, the attackers on shared weaknesses that the synergy
    // term charges them for (-0.139 against the core's +0.094). Neither is the
    // answer, which is why the test that matters is the next one.
    expect(scoreTeam(TEAMS.strongAttackers.members))
      .toBeGreaterThan(scoreTeam(TEAMS.defensiveCore.members));
  });

  it('puts a team that passes every gate clearly above teams that fail one', () => {
    // The real claim behind the pair above. `balance` has the typing spread, the
    // bulk and the attacking stats; the other two each miss something. If the
    // model ever rates a one-sided team level with a complete one, the premise
    // this project is built on has stopped being expressed.
    const complete = scoreTeam(TEAMS.balance.members);

    expect(complete - scoreTeam(TEAMS.strongAttackers.members)).toBeGreaterThan(5);
    expect(complete - scoreTeam(TEAMS.defensiveCore.members)).toBeGreaterThan(5);
  });


  it('keeps both halves of the composite on the footing the weights claim', () => {
    // The structural invariant behind every team assertion above, and the one
    // that would have caught the original defect on its own.
    //
    // COMPOSITE_WEIGHTS says 45/55. For a long time it behaved as roughly 16/84,
    // because member quality is a mean of clamped terms averaged again across the
    // team and occupied a sliver of 0..1, while synergy used nearly all of -1..1.
    // A weight only means what it says if the quantity under it uses its range.
    //
    // Sampled rather than assumed, so it tracks the real distribution — the same
    // discipline as the adjunct-budget guard above. Deterministic sample, so a
    // failure here is reproducible rather than a flake.
    const pool = Object.values(SCORING_FIXTURE_POKEMON);
    const format = BATTLE_FORMATS.doubles;
    const bounds = COMPOSITE_BOUNDS[format.id];

    let seed = 20260728;
    const nextIndex = (limit: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % limit;
    };

    const qualities: number[] = [];
    const synergies: number[] = [];
    for (let i = 0; i < 3000; i++) {
      const picked = new Set<number>();
      while (picked.size < format.broughtToBattle) picked.add(nextIndex(pool.length));
      const members = [...picked].map((index) => pool[index]);
      const halves = compositeHalves(members, format);
      qualities.push(halves.quality);
      synergies.push(halves.synergy);
    }

    // The band real comparisons happen in, not the extremes.
    const band = (values: number[]) => {
      const sorted = [...values].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length * 0.99)] - sorted[Math.floor(sorted.length * 0.01)];
    };
    const swing = (values: number[], weight: number, range: { min: number; max: number }) =>
      100 * weight * (band(values) / (range.max - range.min));

    const qualitySwing = swing(qualities, COMPOSITE_WEIGHTS.memberQuality, bounds.quality);
    const synergySwing = swing(synergies, COMPOSITE_WEIGHTS.synergy, bounds.synergy);
    const realized = synergySwing / qualitySwing;
    const nominal = COMPOSITE_WEIGHTS.synergy / COMPOSITE_WEIGHTS.memberQuality;

    // Generous, deliberately: the point is to catch a half that stops deciding
    // anything, not to pin a ratio nobody measured against match outcomes. The
    // pre-bounds model sat at 5.2 and would fail this by a wide margin.
    expect(
      realized,
      `synergy swings ${synergySwing.toFixed(1)} points against quality's ` +
      `${qualitySwing.toFixed(1)} — a ${realized.toFixed(2)}:1 split under nominal ${nominal.toFixed(2)}:1`
    ).toBeLessThan(nominal * 2);
    expect(realized).toBeGreaterThan(nominal / 2);
  });

  it('charges a shared quadruple weakness more than an unshared one', () => {
    // The distinction the old fixture blurred. Both teams are six strong
    // attackers with quadruple weaknesses; only one has them *doubled up*, which
    // is what turns a bad matchup into a two-for-one.
    const shared = scoreTeam(TEAMS.overlappingThreats.members);
    const unshared = scoreTeam(TEAMS.strongAttackers.members);

    expect(
      unshared - shared,
      `stacked ${shared.toFixed(1)} vs unstacked ${unshared.toFixed(1)}`
    ).toBeGreaterThan(10);
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

  it('was generated under the normalization the tests are running against', () => {
    // Without this the fixture is blind to the stage most likely to be wrong.
    //
    // Every ordinal assertion above reads `normalizedDamageFromScore` straight
    // out of the fixture, so it exercises the weights but never the bounds those
    // numbers came from. Reverting `pokedexScoring` to the old formula-extreme
    // bounds — the miscalibration this whole rework exists to fix — left all
    // fifteen assertions green, because they were comparing values frozen under
    // the new bounds against each other.
    //
    // Re-normalizing the raw scores restores the link. Change the bounds without
    // running `npm run gen:scoring-fixture` and this fails, rather than the suite
    // quietly validating a scale that is no longer in use.
    Object.entries(SCORING_FIXTURE_POKEMON).forEach(([name, entry]) => {
      const raw = SCORING_FIXTURE_RAW_SCORES[name];
      expect(raw, `${name} has no raw scores — regenerate the fixture`).toBeDefined();

      expect(
        entry.normalizedDamageFromScore,
        `${name}: fixture holds ${entry.normalizedDamageFromScore}, current bounds give `
        + `${normalizeDamageFromScore(raw.from, DEFAULT_BASE_SCORE)}. Run npm run gen:scoring-fixture.`
      ).toBeCloseTo(normalizeDamageFromScore(raw.from, DEFAULT_BASE_SCORE));

      expect(
        entry.normalizedDamageToScore,
        `${name}: fixture holds ${entry.normalizedDamageToScore}, current bounds give `
        + `${normalizeDamageToScore(raw.to, DEFAULT_BASE_SCORE)}. Run npm run gen:scoring-fixture.`
      ).toBeCloseTo(normalizeDamageToScore(raw.to, DEFAULT_BASE_SCORE));
    });
  });

  it('names an ability the Pokemon actually has', () => {
    Object.entries(SCORING_FIXTURE_POKEMON).forEach(([name, entry]) => {
      expect(entry.abilities.map((a) => a.name), `${name}`).toContain(entry.abilityName);
    });
  });
});
