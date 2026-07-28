/**
 * Roster generation over Pokemon.
 *
 * The original generator searched *type combinations* and attached whichever
 * Pokemon happened to sort first within each. That made two Pokemon sharing a
 * typing mutually exclusive, and meant the search optimised typings while the
 * user cared about Pokemon.
 *
 * This searches the Pokemon directly, so two Pokemon sharing a typing both stay
 * in the running and the choice between them is made on their merits.
 *
 * Two constraints survive that. No duplicate species, which is a rule of the
 * format. And no two members on the same type combination, which is not — you
 * may register two Steel/Dragons — but which a *generated* roster should not
 * spend a slot on. See `typingKey` for why the synergy penalty alone did not
 * settle it. Both bind generation only; a hand-built roster is scored as it is.
 *
 * Like the type search this is a beam, not an exhaustive enumeration, and it
 * prunes twice over:
 *
 * 1. Candidates are ranked individually and only the strongest are considered,
 *    because the eligible pool runs to hundreds of Pokemon.
 * 2. Partial rosters are scored as if they were the whole team, since a
 *    half-built roster has no bring options to evaluate yet.
 *
 * Completed rosters are then re-scored properly with evaluateRoster. Pruning on
 * one metric and ranking on another is a heuristic, not a guarantee — callers
 * must not describe the result as optimal.
 */

import { evaluateRoster, scoreBring, type RosterEvaluation, type RosterMember } from './rosterScoring';
import { scoreMemberQuality } from './teamScoring';
import { DEFAULT_BASE_SCORE } from './pokedexScoring';
import { getAbilityEffect, getApplicableRoles, soloRoleValue } from './abilityRoles';
import type { BattleFormat } from './battleFormats';
import type { PokemonEntry } from './pokemonEntry';

/** Partial rosters kept at each expansion step. */
export const ROSTER_BEAM_WIDTH = 128;

/** How many individually-strongest Pokemon the search will consider. */
export const DEFAULT_CANDIDATE_LIMIT = 160;

/**
 * Weights for ranking a single Pokemon before the search begins.
 *
 * ## Why this is built on scoreMemberQuality
 *
 * The earlier version summed typing and stats as independent terms, and paid
 * for defensive typing three separate times: once as `defensiveTyping`, again
 * per resistance, and again per weakness. But `normalizedDamageFromScore` *is*
 * a summary of resistances and weaknesses — `calculateDamageFromScore` sums
 * exactly those buckets — so all three measured one property. Across a real
 * comparison that came to a 27-point spread on typing against 4 points on
 * stats, a ratio of roughly seven to one that nothing had chosen.
 *
 * Stats were the other half of the problem. `statsTotal` is stat-blind, so
 * Klefki's unusable 80/80 offences counted the same as Lucario's 110/115. The
 * result was a Pokemon with the best defensive typing in the game outranking
 * two that beat it comfortably in practice.
 *
 * `scoreMemberQuality` already solves this, is documented, and is what the team
 * scorer actually uses — so ranking a candidate now means asking the same
 * question the team scorer will ask later, rather than a parallel approximation
 * of it. Typing *modulates* stats there instead of being added beside them, so
 * elite typing multiplies bulk a Pokemon has without inventing offence it does
 * not. Typing stays central to the ranking, which is true to what this tool is
 * for; it simply stops being counted three times.
 *
 * ## The remaining terms, and the budget they share
 *
 * Each covers something member quality genuinely cannot see. Their sizes are
 * set against the *observed* spread of the quality term rather than picked
 * independently, because that is the mistake this file already made once.
 *
 * Across the validation fixture `quality * 100` runs from about 33 to 62 — a
 * span near 30 points. The adjuncts must therefore be able to reorder Pokemon
 * whose quality is close, and must never invert a real quality gap. Their
 * combined swing is held to roughly a third of that span.
 *
 * The first version of this rework failed exactly there: `supportRole` at 12
 * and `quadrupleWeakness` at 15 were carried over from the previous formula,
 * whose terms ran to 44. On the compressed scale they added up to 27 points of
 * adjustment against a 30-point base, and ranked Arbok above Garchomp. The
 * validation fixture caught it; nothing else would have.
 *
 * All of these are still reasoned rather than measured against match outcomes,
 * as with MEMBER_WEIGHTS and MIXED_ATTACKER_RATIO. The fixture constrains them;
 * it does not derive them.
 */
export const CANDIDATE_WEIGHTS = {
  /** scoreMemberQuality is 0..1; this puts it on a 0..100 scale. */
  quality: 100,
  /**
   * Support roles are invisible to a stat-and-typing score, and this ranking
   * decides which DEFAULT_CANDIDATE_LIMIT Pokemon the search ever looks at — so
   * without this a support Pokemon could be cut before team synergy, which does
   * weigh roles, had any chance to see it. Enough to lift a supporter past a
   * near-equal Pokemon without one; nowhere near enough to make Intimidate turn
   * an unusable Pokemon into a good one.
   *
   * Weather and terrain setters earn a fraction of this — see soloRoleValue.
   * Their payoff depends on teammates that want the field changed, which team
   * scoring evaluates and a solo ranking cannot.
   *
   * ## Why this fell 4 -> 2 -> 1
   *
   * It first claimed to be "about three resistances", a unit inherited from an
   * older formula where resistances were explicit terms. The rework onto
   * `scoreMemberQuality` folded them into the defensive score and nobody
   * restated the price, so 4 was quietly buying nine and a half. That took it
   * to 2.
   *
   * The invariant worth holding is that **a role never offsets a quadruple
   * weakness**, and 2 held it against a charge that was then a flat 2.52.
   *
   * `OBSERVED_STAT_TERMS` changed the shape of that charge rather than its size.
   * Defensive typing modulates the *bulk* term, so once bulk is measured against
   * its real range the charge scales with how much bulk there is to modulate:
   *
   * | raw bulk | quad-weakness charge |
   * | -------- | -------------------- |
   * | 200      | 1.02 points          |
   * | 250      | 1.69                 |
   * | 300      | 2.37                 |
   * | 400      | 3.66                 |
   *
   * So there is no single figure to sit under any more, and 2 broke the
   * invariant for anything under roughly 270 bulk — the frail Pokemon, where a
   * quadruple weakness is least survivable. Pinned at the weakest case instead.
   *
   * That the charge is *smaller* for frail Pokemon is a real quirk of routing it
   * through the bulk term, not a deliberate claim: it says a 4x weakness costs
   * less when there was less to lose. Defensible, since something that dies to a
   * neutral hit does not need a 4x one, but recorded because it is not obvious
   * and it is the reason this weight had to move.
   *
   * 1 is about 2% of the 48-point quality spread. Small on purpose: this
   * ranking's job is only to keep supporters from being pruned out of the
   * candidate pool before team synergy — which weighs roles properly — ever sees
   * them. It is not meant to rank them first on its own.
   */
  supportRole: 1,
  /**
   * Reachable coverage. A tiebreak: it says "can learn", never "would run".
   *
   * Not duplicated by anything, unlike the STAB `coverage` term that used to sit
   * beside it: this comes from `getMoveCoverage` reading the Champions movepool,
   * not from the type chart, and it is already read against the attacker's stats.
   */
  moveCoverage: 0.2
} as const;

// There is deliberately no `coverage` term in CANDIDATE_WEIGHTS.
//
// ## Why it was removed
//
// It paid a second time for a count the offensive score already contains.
// `coverages` is exactly `damage_relations.double_damage_to`, and
// `calculateDamageToScore` is `baseScore + double_damage_to.length - ...`. The
// same list fed both: 0.89 points per super-effective type through the score
// into the offence term, and 0.75 again on its own line. STAB breadth was
// charged at 1.84x.
//
// Its docstring claimed the offensive score "measures strength rather than
// spread". It counts the length of a list of types; that is spread. The
// justification had been wrong for as long as the weight existed — the same way
// `supportRole` claimed to be worth "about three resistances" while buying nine.
//
// This is the offensive mirror of the defect the rework above removed. That one
// found defensive typing being paid three times, once as its own term and twice
// more as the resistance and weakness lists `normalizedDamageFromScore` already
// summarises. Nobody checked whether the offensive side had the same shape. It
// did.
//
// Removing it rather than shrinking it, because the duplicate was also the
// worse-behaved of the two. The explicit term was **stat-independent**: it paid
// Klefki for hitting seven types super-effectively off an 80 Special Attack at
// the same rate it paid Kingambit. Routing the charge through the offence term
// scales it by `effectiveOffense`, which is the whole argument behind the
// damage-class split in `coverageMoves.ts` and behind `effectiveOffense` itself.
// Coverage a Pokemon cannot back with an attacking stat describes a threat that
// does not exist.
//
// STAB breadth is not thereby unmeasured. `normalizedDamageToScore` is the
// measure, and it is the offensive counterpart of `normalizedDamageFromScore` —
// modulating stats rather than sitting beside them, which is what this file
// already decided typing should do.
//
// There is deliberately no `quadrupleWeakness` term either.
//
// ## Why it was removed
//
// It was the third charge for one property. A 4x weakness was paid for by
// `calculateDamageFromScore`, which adds 3 against 1 for a double; again by a
// flat penalty in CANDIDATE_WEIGHTS; and again by team scoring, which charges it
// three separate ways — `quadrupleWeakness`, `uncoveredQuadrupleWeakness` and
// `sharedQuadrupleWeakness`. That is the same shape as the defect the previous
// rework of this file removed, where defensive typing was paid for three times
// over; it simply went unnoticed on a different property.
//
// The flat charge was also the worst-placed of the three. Whether a quadruple
// weakness matters is a question about the *team*: is the weakness covered, is
// it shared with another member, does anything switch into it. Team scoring can
// ask all of that. Ranking a Pokemon alone cannot, and the honest charge in
// isolation is the average-case one the defensive score already applies.
//
// It was also the most expensive place to be wrong. This ranking prunes the
// pool to `DEFAULT_CANDIDATE_LIMIT`, so a Pokemon dropped here is never seen by
// the scorer that could have judged the risk properly. Wrongly excluding
// Scizor — nine resistances, one immunity, one weakness — costs more than
// wrongly including it, because the team scorer can still reject it later and
// can never recover it.
//
// The visible symptom was Scizor ranking below Blastoise, Feraligatr and
// Klefki despite beating all three on member quality. Its entire deficit was
// this penalty.
//
// Removing it does not make the model blind to quadruple weaknesses: Dragonite
// and Garchomp still carry a materially worse defensive score than Skarmory for
// exactly this reason, and a roster that stacks the weakness is still penalised
// where the stacking can be seen.


export interface GenerateRostersOptions {
  /** Eligible Pokemon, already filtered by the scan. */
  pokemon: PokemonEntry[];
  format: BattleFormat;
  /** Defaults to the format's maximum roster size. */
  rosterSize?: number;
  /** Pokemon that must appear in every generated roster. */
  seed?: PokemonEntry[];
  /** Number of elemental types in play. */
  typeCount?: number;
  /** Champions forbids duplicate Pokedex numbers, so this defaults to false. */
  allowDuplicateSpecies?: boolean;
  /**
   * Allow two members to share a type combination. Defaults to false.
   *
   * Not a rule of the format — you may register two Steel/Dragons — but a
   * generated roster should not spend a slot on one. See TYPING_KEY below.
   */
  allowDuplicateTypings?: boolean;
  candidateLimit?: number;
}

/**
 * Identity used to keep a generated roster off the same typing twice.
 *
 * Sorted, so a combination read in either slot order is one typing. Species
 * entries carry `typeName` already, but it comes from the type chart in whatever
 * order that resource lists, and pinning identity to a display string would make
 * this silently stop working if the chart ever reordered.
 *
 * ## Why the score alone was not enough
 *
 * Redundancy is already scored: two members with one typing contribute one set
 * of resistances to `uniqueResistances` and one set of types to `typeDiversity`.
 * Holding a Pokemon's stats and ability fixed and moving only its typing, a
 * second Steel/Dragon beside Goodra-Hisui costs **about 5 points** against most
 * other typings — so the charge is real and roughly the right size.
 *
 * It is not enough because it competes with individual quality on a roster where
 * the alternatives are worse Pokemon. Seeded with Goodra-Hisui under the app's
 * default filters, the best roster was:
 *
 *   goodra-hisui, **archaludon**, dragapult, primarina, rotom-heat, overqwil  87.30
 *
 * and the best with six distinct typings was the same roster with Metagross in
 * place of Archaludon, at **86.77**. Archaludon's quality edge covered all but
 * 0.53 of the 5-point charge. Half a point out of 87 is inside the noise of
 * every weight in this model, and it bought a roster that answers the same
 * threats twice and folds to Ground and Fighting on both.
 *
 * Raising the synergy penalty until 0.53 became decisive would mean recalibrating
 * `COMPOSITE_BOUNDS` and every team score to fix a case a constraint states
 * directly. The scoring keeps saying "slightly worse", which is true; the
 * generator should not be *suggesting* it, which is a different question.
 *
 * The constraint binds generation only. A user who wants both can still add them
 * by hand, and the workbench will score that roster honestly.
 */
const typingKey = (entry: PokemonEntry): string => [...entry.types].sort().join('/');

export interface GeneratedRoster {
  members: PokemonEntry[];
  evaluation: RosterEvaluation;
  /** The roster's blended bring score, in 0..100. */
  score: number;
}

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

/**
 * Ranks one Pokemon on its own merits, to decide what the search looks at.
 *
 * Scores the role of the ability *currently selected*, not every role the
 * Pokemon could theoretically fill. Choosing Blaze over Intimidate on an
 * Incineroar should cost it the credit, and the browser applies the user's
 * ability override before ranking so the order responds to that choice.
 *
 * @param entry Pokemon to rank.
 * @param options Format traits. Redirection and ally protection do nothing without an ally, so singles must not credit them.
 * @returns A score on an arbitrary scale; only the ordering matters.
 */
export function candidatePriority(entry: PokemonEntry, options: { hasAlly?: boolean } = {}): number {
  const { hasAlly = true } = options;
  const w = CANDIDATE_WEIGHTS;

  // Scored in isolation, so a role that needs teammates to pay off earns less
  // than one that works the moment the Pokemon is on the field.
  const effect = getAbilityEffect(entry.abilityName);
  const roleValue = effect && getApplicableRoles(hasAlly).includes(effect.role)
    ? soloRoleValue(effect.role)
    : 0;

  // Stats modulated by typing, on the same terms the team scorer will use.
  // Resistances and weaknesses are not added separately: they are already what
  // normalizedDamageFromScore measures.
  const quality = scoreMemberQuality({
    stats: entry.stats,
    normalizedDamageToScore: entry.normalizedDamageToScore,
    normalizedDamageFromScore: entry.normalizedDamageFromScore,
    abilityName: entry.abilityName
  });

  return (quality * w.quality) +
    (roleValue * w.supportRole) +
    (entry.moveCoverages.length * w.moveCoverage);
}

/**
 * Builds rosters from a Pokemon pool, ranked by the bring options they offer.
 *
 * Runs the search twice at most: once refusing to put two members on the same
 * type combination, and again without that constraint if the first pass could
 * not fill a roster. A narrow pool — a user filtering the browser down to a
 * handful of typings — must still get a roster rather than an error, and in that
 * case doubling up is the honest answer rather than a failure.
 *
 * @param options Pool, format, roster size, seed and pruning limits.
 * @returns Rosters ordered by score, best first. May be empty.
 */
export function generateRosters(options: GenerateRostersOptions): GeneratedRoster[] {
  if (options.allowDuplicateTypings) return searchRosters(options, true);

  const distinct = searchRosters(options, false);
  return distinct.length > 0 ? distinct : searchRosters(options, true);
}

function searchRosters(
  options: GenerateRostersOptions,
  allowDuplicateTypings: boolean
): GeneratedRoster[] {
  const {
    pokemon,
    format,
    rosterSize = format.maxRosterSize,
    seed = [],
    typeCount = DEFAULT_BASE_SCORE,
    allowDuplicateSpecies = false,
    candidateLimit = DEFAULT_CANDIDATE_LIMIT
  } = options;

  if (rosterSize <= 0 || seed.length > rosterSize) return [];

  const scoringOptions = { format, typeCount };
  const seedNames = new Set(seed.map((entry) => entry.name));
  const seedSpecies = new Set(seed.map((entry) => entry.speciesName));

  const candidates = pokemon
    .filter((entry) => !seedNames.has(entry.name))
    .filter((entry) => allowDuplicateSpecies || !seedSpecies.has(entry.speciesName))
    // Pre-pruning is where a support Pokemon is most easily lost, so the format
    // has to reach it: crediting redirection in singles would be as wrong as
    // ignoring it in doubles.
    .sort((a, b) => candidatePriority(b, { hasAlly: format.hasAlly }) - candidatePriority(a, { hasAlly: format.hasAlly }))
    .slice(0, Math.max(candidateLimit, rosterSize));

  if (seed.length + candidates.length < rosterSize) return [];

  // Partial rosters are scored as a team of their current size. Memoized on the
  // member set, since the beam revisits the same partials constantly.
  const partialScores = new Map<string, number>();
  const keyOf = (members: PokemonEntry[]) => members.map((m) => m.name).sort().join('|');
  const scorePartial = (members: PokemonEntry[]): number => {
    const key = keyOf(members);
    const cached = partialScores.get(key);
    if (cached !== undefined) return cached;
    const score = scoreBring(members.map(toRosterMember), scoringOptions);
    partialScores.set(key, score);
    return score;
  };

  // Cached per entry: canAdd runs once per candidate per surviving partial, so
  // this is on the hot path of the beam.
  const typingOf = new Map<PokemonEntry, string>();
  const typing = (entry: PokemonEntry): string => {
    let key = typingOf.get(entry);
    if (key === undefined) {
      key = typingKey(entry);
      typingOf.set(entry, key);
    }
    return key;
  };

  const canAdd = (roster: PokemonEntry[], candidate: PokemonEntry): boolean => {
    if (roster.length >= rosterSize) return false;
    if (roster.some((member) => member.name === candidate.name)) return false;
    if (!allowDuplicateSpecies && roster.some((member) => member.speciesName === candidate.speciesName)) return false;
    // A seed that already doubles a typing keeps whatever the user chose; this
    // only stops the search from adding more of one.
    if (!allowDuplicateTypings && roster.some((member) => typing(member) === typing(candidate))) return false;
    return true;
  };

  let partials: PokemonEntry[][] = [[...seed]];

  candidates.forEach((candidate, index) => {
    const remaining = candidates.length - index - 1;
    const expanded = partials.flatMap((roster) => {
      const branches = [roster];
      if (canAdd(roster, candidate)) branches.push([...roster, candidate]);
      return branches;
    });

    const seen = new Set<string>();
    partials = expanded
      // Drop branches that can no longer reach a full roster.
      .filter((roster) => roster.length + remaining >= rosterSize)
      .filter((roster) => {
        const key = keyOf(roster);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => scorePartial(b) - scorePartial(a))
      .slice(0, ROSTER_BEAM_WIDTH);
  });

  return partials
    .filter((roster) => roster.length === rosterSize)
    .map((members) => {
      const evaluation = evaluateRoster(members.map(toRosterMember), scoringOptions);
      return { members, evaluation, score: evaluation.score };
    })
    .sort((a, b) => b.score - a.score);
}
