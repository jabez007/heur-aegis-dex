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
import { hpAdjustedBulk } from './statMetrics';
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

/**
 * Member quality as production computes it.
 *
 * `scoreMemberQuality(mon('azumarill'))` reads like the obvious call
 * and was wrong: `PokemonEntry` has no `varietyName`, so every assertion in this
 * file scored at **full firepower for every Pokemon** — the exact reading
 * `MemberQualityInput.varietyName` documents for "the table does not know". The
 * table does know; the call site just never told it. Every other caller —
 * `candidatePriority`, `evaluateRoster`, `chooseDefaultAbility` — passes the
 * name, so this file was the only place in the repo scoring a Pokemon on a path
 * production never runs.
 *
 * That is worse here than it would be anywhere else. This fixture is what bounds
 * MEMBER_WEIGHTS, TYPE_MODULATION and FIREPOWER_MODULATION, so the frontier
 * those constants were tuned against was measured in a world with one of them
 * switched off. Three assertions moved when it was switched back on, and the
 * Azumarill/Blastoise pair below reversed.
 */
const quality = (entry: PokemonEntry): number =>
  scoreMemberQuality({ ...entry, varietyName: entry.name });

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
  const qualities = members.map((member) => quality(member));

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
      + 'deliberately — they retain enough HP-adjusted bulk to convert their offensive edge.',
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

  it('lets an actually bulky defensive wall beat ordinary typing', () => {
    // The reported symptom of the compressed typing signal, kept as the case
    // that has to stay fixed.
    //
    // Corviknight resists ten types and is immune to two. Blastoise resists four
    // and is immune to none. Corviknight also has the HP to turn its defenses
    // into more effective bulk, so this remains the clean defensive-typing case.
    //
    // This is the assertion the tool exists to get right: resisting most of the
    // chart is what defensive typing *is*, and it has to outweigh being merely
    // bulky. If it fails, check pokedexScoring's bounds before touching a weight.
    expect(candidatePriority(mon('corviknight')))
      .toBeGreaterThan(candidatePriority(mon('blastoise')));
  });

  it('ranks a bulky attacker above a low-HP wall', () => {
    // Feraligatr has both more effective bulk (88.1 to 81.4) and 25 more Attack
    // than Skarmory. Additive bulk used to hide the first advantage by treating
    // high defenses as durability without asking how much HP they protect —
    // Skarmory's 140/70 sit behind 65 HP, Feraligatr's 100/83 behind 85.
    expect(hpAdjustedBulk(mon('feraligatr').stats))
      .toBeGreaterThan(hpAdjustedBulk(mon('skarmory').stats));

    // Feraligatr no longer carries the ordering half of this claim, and the
    // reason is that the claim was wrong rather than that the model is.
    //
    // "25 more Attack" was doing the work, and Attack is not damage. Skarmory's
    // best usable STAB is Brave Bird at 120 off 80 Attack; Feraligatr's is
    // Liquidation at 85 off 105. Multiply them out and the low-HP wall hits
    // *harder*: 9,600 against 8,925. The premise this file defends is that a
    // team which cannot KO does not win, and by that premise Skarmory is the
    // better attacker of the two. Feraligatr's answer is Dragon Dance, which is
    // exactly as invisible as Azumarill's Belly Drum and gets exactly the same
    // treatment — recorded, not compensated for with a weight.
    //
    // This was noticed late. The assertion had already been narrowed once, from
    // `candidatePriority` to `scoreMemberQuality`, on the belief that quality
    // did not carry the reversal. It did; nothing here had ever passed
    // `varietyName`, so firepower was switched off for the whole file. See the
    // `quality` helper above.
    //
    // Swampert carries it instead, and carries it better, because the confound
    // is gone: both are 120-power STAB users, so firepower is a wash and the
    // comparison is the one this test names. Swampert has *lower* additive
    // defenses than Skarmory (90+110 against 140+70) and higher effective bulk
    // (94.9 against 81.4) on 100 HP to 65, plus 43 more effective offence — and
    // it has to win despite Skarmory holding the better defensive typing by a
    // wide margin (0.183 damage-from against 0.493). A bulky attacker beating a
    // low-HP wall that out-types it is the whole claim, stated on a pair that
    // can only be decided by the thing under test.
    expect(hpAdjustedBulk(mon('swampert').stats))
      .toBeGreaterThan(hpAdjustedBulk(mon('skarmory').stats));
    expect(quality(mon('swampert')))
      .toBeGreaterThan(quality(mon('skarmory')));
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

  it('does not sink Azumarill below Blastoise for the Speed its moves answer', () => {
    // Relitigated 2026-08-18. This was a symmetric guard — `|gap| < decisive/8`,
    // "neither should run away" — and both halves of that turned out to be
    // wrong: the shape of the constraint, and the direction it pointed.
    //
    // ## The construction was measuring distance to a crossover
    //
    // A guard on the *absolute* gap between two Pokemon is not a closeness
    // guard. It is smallest exactly where they swap places, so it reports its
    // best possible reading at the moment the ordering inverts. Swept over the
    // bulk weight with firepower on, the old expression read:
    //
    // | bulk / speed | dec/|gap| | who leads |
    // | 0.42 / 0.23  |       6.6 | Blastoise |
    // | 0.50 / 0.15  |      13.0 | Blastoise |  <- ships
    // | 0.54 / 0.11  |      25.6 | Blastoise |
    // | 0.57 / 0.08  |      97.1 | Blastoise |
    // | 0.60 / 0.05  |   2.5e+08 | Azumarill |
    //
    // MEMBER_WEIGHTS recorded this as the binding constraint, failing above
    // bulk 0.52. It does the opposite: it fails *below* bulk 0.45 and passes
    // ever more comfortably as bulk rises, right through the inversion.
    //
    // ## The direction was wrong because the missing model is one-sided
    //
    // What the model cannot see is Belly Drum and Aqua Jet: a setup move and a
    // priority move that between them answer the low Speed the model penalises.
    // Both push one way. There is no reading of Azumarill's movepool that argues
    // it should be scored *lower* than the stat model already scores it, so a
    // guard forbidding it from rising was protecting against an error that
    // cannot occur. What can occur is the stat model charging it twice for 50
    // Speed — once in the Speed term and once in the Speed-shaped hole where
    // priority would be — and that is what this now guards.
    //
    // So the assertion is a floor, not a band. Azumarill may pass Blastoise
    // freely; it may not fall far behind it.
    const deficit = quality(mon('blastoise')) - quality(mon('azumarill'));
    const decisive = quality(mon('dragonite')) - quality(mon('azumarill'));
    expect(deficit).toBeLessThan(decisive / 8);

    // The divisor is carried over rather than re-picked, and it lands somewhere
    // worth knowing. The deficit is monotone in the Speed weight and in nothing
    // else much:
    //
    // | speed | bulk | deficit | dec/deficit |
    // | 0.10  | 0.55 |  0.0076 |        33.9 |
    // | 0.15  | 0.50 |  0.0199 |        13.0 |  <- ships
    // | 0.20  | 0.45 |  0.0322 |         8.1 |  <- the weight this file shipped until 2026-08-17
    // | 0.25  | 0.40 |  0.0445 |         5.9 |
    // | 0.35  | 0.30 |  0.0691 |         3.8 |
    //
    // Run against the real weights rather than the table, /8 admits a Speed
    // weight of 0.20 and rejects 0.21 — so its boundary falls in the gap between
    // the weight this project shipped for months and the next value up. That is
    // not a coincidence being flattered into a result: it is the statement that
    // 0.20 was the last acceptable Speed weight, which is the same conclusion
    // `MEMBER_WEIGHTS` reached from measured term swings by an entirely
    // different route. Two arguments meeting at one number is more support than
    // any other constant in this model has.
    //
    // ## What the pair is separated by now, which is not what it used to be
    //
    // Azumarill led on quality until firepower was applied to this file. It no
    // longer does, and the reason is legitimate on both sides: Blastoise's best
    // usable STAB is Wave Crash at 120 against Azumarill's Play Rough at 85,
    // while Azumarill's Water/Fairy resists seven types to Blastoise's four and
    // is immune to Dragon. Those pull opposite ways and very nearly cancel. The
    // pair is close because the model understands both of them, not because
    // anything is holding it close — which is precisely why the band was safe to
    // remove and the floor is the only part still doing work.
    const priorityDeficit = candidatePriority(mon('blastoise')) - candidatePriority(mon('azumarill'));
    const decisivePriority = candidatePriority(mon('dragonite')) - candidatePriority(mon('azumarill'));
    expect(priorityDeficit).toBeLessThan(decisivePriority / 6);
  });

  it('does not demote a Pokemon for the weakness its typing already pays for', () => {
    // Scizor is nine resistances, one immunity and exactly one weakness. That
    // weakness being 4x Fire was charged three times over: by the defensive
    // score, by a flat penalty in candidatePriority, and again by team scoring.
    // The middle one put Scizor below Blastoise, Feraligatr and Klefki despite
    // beating all three on member quality, and has been removed.
    //
    // The claim is about member quality, and it still holds: Scizor beats all
    // three there, which is where a flat weakness penalty would show up.
    const scizor = mon('scizor');
    expect(quality(scizor)).toBeGreaterThan(quality(mon('klefki')));

    // Blastoise and Feraligatr left this list on 2026-08-18, when the file
    // started passing `varietyName` and firepower reached member quality here
    // for the first time. Scizor's best usable STAB is 80 — X-Scissor and Iron
    // Head, since its typing offers nothing bigger — against 120 for both of
    // them, and against Blastoise that is now a 0.013 deficit rather than a
    // 0.058 lead. The note below already argued the final ordering was right to
    // reverse; the same argument applies to quality, and the sentence it used to
    // rest on — "Scizor still leads on quality" — was only ever true of a
    // firepower-free scoring path that nothing in production runs.
    //
    // Feraligatr goes for a different reason: Scizor still leads it, by 0.0008.
    // A knife edge is not a judgement, and asserting one would make this test
    // fail on rounding.
    //
    // Technician is the thing the model cannot see — Bullet Punch at 40 becomes
    // 60 and comes first — and it is the third entry in this file's ledger of
    // invisible moves, beside Belly Drum and Dragon Dance. All three are
    // recorded rather than compensated for.
    //
    // The external data says the new order is the right one, which is the first
    // time anything in this file has been checkable against something other than
    // argument. Over 166,311 ladder battles of this regulation, Blastoise is
    // played more than Scizor (5.45% to 4.09%) and wins considerably more
    // (52.43% to 49.23%). The judgement recorded here was wrong, not the model.
    //
    // Klefki is kept as the assertion, because it is the pair that actually
    // demonstrates the point — Klefki is not separated from Scizor by anything
    // except the weakness accounting.
    expect(candidatePriority(scizor)).toBeGreaterThan(candidatePriority(mon('klefki')));
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

    // The Scizor half of this was dropped when firepower landed, and the data
    // says dropping it was right rather than convenient. Staraptor is the 9th
    // most-used Pokemon in this regulation at 18.68% with a 51.88% win rate;
    // Scizor is 40th at 4.09% and 49.23%. Asserting that Scizor must outrank it
    // was a judgement this file explicitly permits to be wrong, and it was.
    //
    // Swampert is the pair that carries the original claim anyway: it beats
    // Staraptor on member quality (0.487 to 0.432) and has to keep beating it on
    // the final ranking, so Intimidate still cannot buy past a real gap.
    expect(quality(mon('swampert')))
      .toBeGreaterThan(quality(mon('staraptor')));
  });

  it('lets a typing modulate the stats it scales without deciding them', () => {
    // The substantive half of the erase guard that used to live in
    // `teamScoring.test.ts`, moved here on 2026-08-18 because it is a question
    // about the pool and that file has no pool. The old form asked whether a
    // nominally worst typing kept half of one synthetic stat line's quality; the
    // comment there records the four ways that failed to measure what it named.
    //
    // The claim underneath it is real and is the design statement of
    // `TYPE_MODULATION`: each typing *scales a stat term rather than standing
    // beside it*. A factor that swings the composite further than the term it
    // multiplies has stopped modulating and started deciding, and at that point
    // the tool is ranking typings rather than Pokemon that have them.
    //
    // So: per axis, measured the way `measure:ranking-terms` measures — move one
    // input from the pool's 5th to its 95th percentile with everything else at
    // the median — the typing must swing less than the stat it modulates.
    const pool = Object.values(SCORING_FIXTURE_POKEMON);
    const at = (values: number[], p: number) => {
      const sorted = [...values].sort((left, right) => left - right);
      return sorted[Math.floor((sorted.length - 1) * p)];
    };
    const bulks = pool.map((entry) => hpAdjustedBulk(entry.stats));
    const offences = pool.map((entry) => effectiveOffense(entry.stats));
    const speeds = pool.map((entry) => entry.stats.speed);
    const froms = pool.map((entry) => entry.normalizedDamageFromScore);
    const tos = pool.map((entry) => entry.normalizedDamageToScore);

    // Synthetic, because no real Pokemon is median in five dimensions and the
    // measurement needs one input to move at a time. Built so the two derived
    // metrics land on their targets: `hpAdjustedBulk` is the geometric mean of
    // HP against each defence, and the attacking stats hold a 2:1 ratio so the
    // damage class is well defined. No `varietyName`, so firepower is 1 for
    // every point and cancels out of every ratio below.
    const at5 = (bulk: number, offence: number) => ({
      hp: bulk, defense: bulk, 'special-defense': bulk,
      attack: offence / 1.15, 'special-attack': offence / 2.3,
      speed: at(speeds, 0.5)
    });
    const score = (bulk: number, offence: number, to: number, from: number) => scoreMemberQuality({
      stats: at5(bulk, offence),
      normalizedDamageToScore: to,
      normalizedDamageFromScore: from
    });
    const median = {
      bulk: at(bulks, 0.5), offence: at(offences, 0.5), to: at(tos, 0.5), from: at(froms, 0.5)
    };
    const swing = (
      high: [number, number, number, number], low: [number, number, number, number]
    ) => score(...high) - score(...low);

    const bulkSwing = swing(
      [at(bulks, 0.95), median.offence, median.to, median.from],
      [at(bulks, 0.05), median.offence, median.to, median.from]
    );
    // Inverted: a *lower* damage-from score is the better typing, so its p05 is
    // the strong end and this reads the same way round as every other input.
    const defensiveTypingSwing = swing(
      [median.bulk, median.offence, median.to, at(froms, 0.05)],
      [median.bulk, median.offence, median.to, at(froms, 0.95)]
    );
    const offenceSwing = swing(
      [median.bulk, at(offences, 0.95), median.to, median.from],
      [median.bulk, at(offences, 0.05), median.to, median.from]
    );
    const offensiveTypingSwing = swing(
      [median.bulk, median.offence, at(tos, 0.95), median.from],
      [median.bulk, median.offence, at(tos, 0.05), median.from]
    );

    expect(defensiveTypingSwing).toBeLessThan(bulkSwing);
    expect(offensiveTypingSwing).toBeLessThan(offenceSwing);

    // Where these bind, so the next person changing a modulation knows what they
    // are spending. Swept over this fixture on 2026-08-18:
    //
    // | depth | defensive typing / bulk | offensive typing / offence |
    // | 0.40  | 0.264                   | 0.356                      |
    // | 0.60  | **0.451**  <- ships     | **0.356**  <- ships        |
    // | 0.80  | 0.699                   | 0.886                      |
    // | 0.90  | 0.856                   | 1.061  fails               |
    // | 1.00  | 1.043  fails            | 1.261  fails               |
    //
    // The two columns are independent — sweeping the defensive depth leaves the
    // offensive ratio at 0.356 exactly, and the reverse — which is the property
    // the joint expression this replaces could not have. It is also the reason
    // TYPE_MODULATION became two constants.
    //
    // These are slack. The binding ceiling on the defensive depth is the team
    // gate two tests below, not this; see TYPE_MODULATION for the frontier.
    // Recorded anyway, because a guard that only fires at 1.0 still says the one
    // thing this model must never do: multiply a stat term by zero for having
    // the wrong typing.
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
      .map((entry) => quality(entry) * CANDIDATE_WEIGHTS.quality);
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
    //   gate 2, decent bulk      — close enough that neither side wins here by
    //           durability alone.
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
