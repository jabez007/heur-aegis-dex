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
 * Three constraints survive that. No duplicate species, which is a rule of the
 * format. No two members on the same type combination, which is not — you may
 * register two Steel/Dragons — but which a *generated* roster should not spend a
 * slot on. And a budget on how often the roster repeats a weakness *nothing on
 * it resists*, searched strictest-first so a repeat is spent only when nothing
 * cleaner fits. All three bind generation only; a hand-built roster is scored as
 * it is.
 *
 * That third constraint has been rewritten twice, and the pattern is worth
 * naming because it will probably happen again. It began as `countTypeOverlap`,
 * a budget on repeated elemental types. That was a proxy for repeated
 * weaknesses, and wrong for 10.7% of type-sharing pairs. Repeated weaknesses
 * were in turn a proxy for repeated *unanswered* weaknesses, and overstated the
 * threat in 96% of generated rosters. Each stage measured the stand-in for the
 * next one down. See `countTypeOverlap`, `countSharedWeaknesses` and
 * `countUnansweredWeaknesses` — the first two are kept, unused by the search,
 * because the reasoning that retired them is the reasoning that would retire
 * this one.
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

import { coverageBeyondStab } from './coverageMoves';
import { evaluateRoster, scoreBring, type RosterEvaluation, type RosterMember } from './rosterScoring';
import type { TypeMatchupValues } from './teamCoverage';
import { MOVE_ROLE_CREDIT, offenseStatTerm, PRANKSTER_ROLE_CREDIT, scoreMemberQuality } from './teamScoring';
import { getMoveSourcedRoles } from './utilityMoves';
import { DEFAULT_BASE_SCORE } from './pokedexScoring';
import {
  getAbilityEffect,
  getApplicableRoles,
  RELIABLE_STATUS_ABILITIES,
  soloRoleValue
} from './abilityRoles';
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
   * ## Swept against real usage, and deliberately not raised
   *
   * This weight is the binding constraint on three separate corrections — move
   * sourced support roles, Mirror Armor, and now weather abusers — each of which
   * measured as real and then moved almost nothing, because a role is worth one
   * point against a quality term spanning thirty. So it was swept directly,
   * against the 166,311-battle usage table:
   *
   * | weight | vs usage | vs win | excadrill / mamoswine | grimmsnarl | rotom-wash |
   * | ------ | -------- | ------ | --------------------- | ---------- | ---------- |
   * | 0      | 0.245    | 0.262  | 27 / 17               | 77         | 170        |
   * | **1**  | 0.249    | 0.259  | 30 / 21               | 81         | 176        |
   * | 3      | 0.268    | 0.261  | 28 / **29**           | 88         | 178        |
   * | 8      | 0.289    | 0.259  | 27 / 40               | 111        | 191        |
   *
   * Raising it would fix the case that prompted the sweep: Excadrill passes
   * Mamoswine at 3, matching the tier lists that put them at B and C. Usage
   * correlation climbs the whole way.
   *
   * It is not raised, for three reasons that only mean anything together. The
   * climb has no peak, which usually means a term is picking up a correlate
   * rather than a cause — here, that support Pokemon are heavily played in
   * doubles. Win rate is flat across the entire sweep, so the one target not
   * compressed by usage sees nothing. And most tellingly, **the Pokemon this was
   * meant to rescue get worse**: Grimmsnarl and Rotom-Wash are 18th and 38th in
   * the format, and both fall as the weight rises, because their support is
   * Prankster, screens and Will-O-Wisp — none of which the model can see.
   *
   * That is the finding. Widening the channel amplifies the fraction of support
   * the model knows and penalizes the rest, so more support has to be modelled
   * *before* this weight is worth revisiting. Raising it now would buy a better
   * correlation by making the two clearest errors on the board bigger.
   *
   * It would also break the invariant above: at 3 a role is worth roughly three
   * times the quadruple-weakness charge on a frail Pokemon.
   *
   * ### Swept again once screens and status were modelled, and it changed shape
   *
   * The argument above predicted that the sweep misbehaved *because* most of
   * support was invisible. Adding screens and status infliction tested that
   * prediction directly, and it held:
   *
   * | weight | usage (before / after) | grimmsnarl | rotom-wash |
   * | ------ | ---------------------- | ---------- | ---------- |
   * | **1**  | 0.249 / 0.249          | 81 -> 77   | 176 -> 168 |
   * | 4      | 0.271 / 0.263          | 92 -> 77   | 183 -> 162 |
   * | 8      | 0.289 / 0.261          | 111 -> 74  | 191 -> 152 |
   *
   * Both objections are gone. Rotom-Wash now *improves* as the weight rises
   * where it used to degrade, and the usage curve has a peak at 6 instead of
   * climbing without one — the signature of a term measuring a cause rather than
   * a correlate.
   *
   * It is still not raised, and the reason is now much narrower than before. At
   * the peak the usage gain over 1 is 0.017, win rate is unchanged at 0.258
   * against 0.260, and a weight of 6 is roughly six times the quadruple-weakness
   * charge on a frail Pokemon. A documented invariant is not worth trading for
   * 0.017 on the more compressed of two targets.
   *
   * ### Swept a third time with Prankster in, and the answer is no
   *
   * The last piece of support landed and the sweep was rerun. It does not need
   * the invariant argued with, because the term does not earn the raise:
   *
   * | weight | vs usage | vs win rate |
   * | ------ | -------- | ----------- |
   * | 0      | 0.245    | **0.262**   |
   * | **1**  | 0.250    | 0.260       |
   * | 3      | 0.256    | 0.261       |
   * | 6      | 0.263    | 0.250       |
   * | 10     | 0.258    | 0.228       |
   *
   * The two targets now point in opposite directions. Usage peaks around 4 to 6
   * and win rate declines steadily from 3 onward, losing more than it ever
   * gained by 10. Raising this makes the ranking better at predicting what
   * people *play* and worse at predicting what *wins*.
   *
   * Checking the term directly rather than through the composite says why, and
   * it is the result that closes this line of work. Support-role count on its
   * own correlates **-0.043 with usage and -0.104 with win rate**, and the group
   * means fall monotonically:
   *
   * | roles filled | n  | mean usage | mean win rate |
   * | ------------ | -- | ---------- | ------------- |
   * | 0            |  9 | 7.78%      | 49.76%        |
   * | 1            | 28 | 5.68%      | 49.23%        |
   * | 2            | 30 | 5.39%      | 49.07%        |
   * | 3            | 18 | 7.28%      | 49.02%        |
   * | 4            |  5 | 1.86%      | 48.63%        |
   *
   * Filling more support roles predicts winning slightly *less*. The tail is thin
   * and the win-rate column is compressed, so this is suggestive rather than
   * settled — but there is no reading of it that argues for paying support more.
   * Whatever lifts the usage correlation as the weight rises, it is not the
   * support term predicting usage, because support does not predict usage either.
   * The likeliest mechanism is that support Pokemon are slow and the speed term
   * anti-correlates with win rate at -0.114, so weighting support partly cancels
   * a different error. Fixing one error with another is not a calibration.
   *
   * ### And the two cases that started this were not both errors
   *
   * Grimmsnarl wins 49.76% and Rotom-Wash 48.68%, both below the field, while
   * being played 18th and 38th. Ranking them low is defensible on performance and
   * wrong only against popularity, which this tool does not claim to predict.
   * Excadrill at 50.75% against Mamoswine's 48.60% is the real error in that pair
   * — and it is an error about Sand Rush, now scored, not about this weight.
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
   * Reachable coverage *beyond STAB*. A tiebreak: it says "can learn", never
   * "would run".
   *
   * ## The claim that used to be here was wrong
   *
   * It read: "Not duplicated by anything, unlike the STAB `coverage` term that
   * used to sit beside it: this comes from `getMoveCoverage` reading the
   * Champions movepool, not from the type chart." Both halves are true and the
   * conclusion does not follow. The move tables include moves of the Pokemon's
   * **own** types, so a Pokemon with a real STAB move reaches everything its
   * typing reaches, plus more — and `normalizedDamageToScore` had already
   * scored the first part inside the offence term.
   *
   * Measured by `npm run measure:ranking-terms`: **145 of the 146** entries in a
   * default M-B view have their STAB coverage wholly inside their move coverage.
   * So this was the same double count that removed the `coverage` weight below,
   * arriving by a different route — through the movepool rather than off the
   * chart, which is exactly why the note above thought it was safe.
   *
   * Now counts only `coverageBeyondStab`, the quantity `PokemonCard` was already
   * displaying. The card had shown STAB coverage and extra coverage as separate
   * rows since it was written; the ranking is what disagreed with it.
   *
   * ## The weight does not move, and that is the interesting part
   *
   * Subtracting shrinks every count — Mamoswine 16 -> 7, Excadrill 15 -> 8 —
   * and the term's swing across the pool goes *up*, 2.20 points to 2.40, because
   * what it removes is concentrated in the Pokemon whose typings already hit
   * everything. The spread widens (p05 7 -> 3) while the top barely moves.
   *
   * The sign of what it measures flips, which is the real repair. Against the
   * offensive typing score the raw count correlates at **+0.22** and the
   * remainder at **-0.23**: a Pokemon whose STAB already covers the format has
   * less left to gain from a coverage move, and that is the thing worth paying
   * for. Correlation with STAB power falls from 0.36 to 0.15 over the same
   * change.
   *
   * ## It is no longer stat-independent, and the pair that argued for that was
   * the wrong pair
   *
   * The note here used to read: "Klefki reaching seven extra types off an 80
   * Special Attack is paid at the same rate as Kingambit reaching seven." That
   * example does not survive being looked up. Measured in Regulation M-B:
   *
   * | Pokemon   | attack stats | STAB reach | move reach | **extra** | paid |
   * | Klefki    | 80 / 80      | 6          | 10         | **4**     | 0.80 |
   * | Kingambit | 135 / 60     | 5          | 15         | **10**    | 2.00 |
   *
   * They are not paid the same rate; Kingambit is paid 2.5x more, and they sit
   * 199 places apart. The sentence was carried word for word from the removed
   * `coverage` weight below, where it was a claim about STAB `coverages` — and
   * even there the numbers are 6 and 5, not seven and seven. It was a slogan
   * that outlived its measurement. Kingambit is also not in the default view at
   * all: Dark/Steel is 4x weak to Fighting, so the pair can only be seen side by
   * side with the type filters opened.
   *
   * The **defect** it named is real; only its exemplars were wrong. The honest
   * pair is Audino and Snorlax. Both reach 18 types beyond STAB — the widest in
   * the pool, and the largest payment this term makes anywhere at 3.6 points —
   * off offence terms of 0.119 and 0.512. Aegislash-Shield collects 2.2 points
   * of reach on an offence term of 0.02.
   *
   * So the charge is now scaled by `offenseStatTerm`, through
   * MOVE_COVERAGE_MODULATION. Reach that nothing can be done with is not a
   * threat, which is the same argument that removed the `coverage` weight and
   * the same argument behind the damage-class split in `coverageMoves.ts`.
   *
   * ## Why 0.26 rather than 0.2
   *
   * Modulating multiplies by a number below 1 for everyone but the very top of
   * the offence range, so applying it at the old weight would have shrunk the
   * term for the whole pool — a quiet weight cut wearing a repricing's clothes,
   * which is the exact side effect that forced TYPE_MODULATION to be split into
   * an offensive and a defensive half. The weight is raised to keep the term
   * worth what it was worth to a *median* Pokemon, so the change rotates the
   * term about the median instead of shrinking it: the p05-to-p95 swing of
   * reach lands at 2.37 points against the 2.40 it was, and the term holds its
   * 4.6% share of what decides the order. Measured, not derived: see the sweep
   * in MOVE_COVERAGE_MODULATION.
   */
  moveCoverage: 0.26
} as const;

/**
 * How strongly `offenseStatTerm` modulates the reachable-coverage charge.
 *
 * Same shape as TYPE_MODULATION: `(1 - depth) + depth * term`, so 0 is the old
 * stat-independent flat charge and 1 makes coverage worth literally nothing to
 * a Pokemon at the floor of the offence range. Neither end is right. The floor
 * is *pool-relative* — OBSERVED_STAT_TERMS.offense starts at 0.32 of the stat
 * ceiling, so a term of 0 means "worst attacker in the format", not "cannot
 * attack" — and a wall that can still click a super-effective move has done
 * something, even if not much.
 *
 * Swept over the Regulation M-B pool with the type filters opened, 236 entries,
 * on 2026-08-18. `rho(cov, offTyp)` is the anti-correlation the previous fix
 * bought and this one must not spend: a Pokemon whose STAB already covers the
 * format has less left to gain from a coverage move.
 *
 * | depth | rho(cov, offTerm) | rho(cov, offTyp) | Audino | Lopunny | Sinistcha |
 * | 0.00  | 0.070             | **-0.308**       | 157    | 193     | 60        |
 * | 0.30  | 0.204             | -0.287           | 164    | 199     | 59        |
 * | 0.40  | 0.260             | -0.272           | 165    | 201     | 56        |
 * | 0.50  | 0.320             | **-0.254**       | 169    | 202     | 55        |
 * | 0.60  | 0.389             | -0.226           | 171    | 203     | 55        |
 * | 0.75  | 0.501             | -0.175           | 177    | 205     | 55        |
 * | 1.00  | 0.684             | **-0.070**       | 180    | 208     | 53        |
 *
 * The right-hand column is why this stops at 0.5. Past it the term starts
 * turning back into a proxy for the offence stat and hands back the sign the
 * double-count repair was worth doing for: at depth 1 the anti-correlation with
 * offensive typing has almost vanished, which would leave the term measuring
 * "is a good attacker" — something two other terms already measure — rather
 * than "has reach its typing does not give it". 0.5 buys most of the
 * stat-dependence for a fifth of that cost, and matches TYPE_MODULATION.defensive.
 *
 * ## What this is worth, which is not much, recorded so it is not overclaimed
 *
 * Top-20 churn in the default view is **zero** at every depth swept, and zero
 * in the opened view too. The Pokemon this repricing demotes — Audino,
 * Lopunny, Aegislash-Shield, Bastiodon, Pikachu — are almost all filtered out
 * of the default browser view already, by the damage-from ceiling and the
 * quadruple-weakness filter. The defect was real and is now fixed, but the
 * product's own filters were already hiding most of it, and the correction is
 * worth about ten places in the middle of an opened list.
 *
 * That is the honest size of it. It is recorded here rather than in a commit
 * message because the next person tempted to reach for this term to fix a
 * ranking they dislike should know it cannot move one.
 *
 * ## And it costs something, which is the reason to keep the depth low
 *
 * Premise alignment falls from 0.692 to **0.683**, top-20 overlap unchanged at
 * 12/20. That is the expected direction and it is a real cost: attacking stat
 * is not one of the three things the tool was built to find, so pricing any
 * term by it pulls the order a little away from the premise order. The trade is
 * taken because the alternative is a term that pays for threats that do not
 * exist, and a premise score that rewards fictional threats is not measuring
 * the premise either. It is also the second reason not to go deeper than 0.5.
 */
export const MOVE_COVERAGE_MODULATION = 0.5;

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
  /** What each type is worth in the metagame, for the synergy half of the score. */
  typeValues?: TypeMatchupValues;
  /** Champions forbids duplicate Pokedex numbers, so this defaults to false. */
  allowDuplicateSpecies?: boolean;
  /**
   * Allow two members to share a type combination. Defaults to false.
   *
   * Not a rule of the format — you may register two Steel/Dragons — but a
   * generated roster should not spend a slot on one. See TYPING_KEY below.
   */
  allowDuplicateTypings?: boolean;
  /**
   * Unanswered shared weaknesses allowed *above* the fewest the pool can manage.
   * Defaults to `DEFAULT_UNANSWERED_WEAKNESS_SLACK`, which is 0.
   *
   * Expressed as slack rather than an absolute budget because the floor depends
   * on the pool: a user filtered down to Steel and Dragon cannot reach zero on
   * the raw count, and an absolute cap would either fail there or be vacuous on
   * the full roster. Raising this trades defensive tidiness for the individual
   * quality of the members.
   */
  unansweredWeaknessSlack?: number;
  candidateLimit?: number;
}

/**
 * How much unanswered redundancy the generator will accept for a better roster.
 *
 * Zero, and the reason it can afford to be is that the constraint became almost
 * free once it stopped counting weaknesses the roster already covers:
 *
 * | slack | doubles | singles |
 * | ----- | ------- | ------- |
 * | 0     | 89.70   | 90.48   |
 * | 1     | 89.79   | 90.48   |
 * | 2     | 89.79   | 90.48   |
 * | none  | 89.79   | 90.48   |
 *
 * Strict costs **0.09 points in doubles and nothing at all in singles**, where
 * the singles roster the generator picks *is* the unconstrained optimum. There
 * is no purity to buy: a roster with no unanswered redundancy is simply also the
 * best roster.
 *
 * ## Why this was briefly 2
 *
 * The same table against `countSharedWeaknesses` read 88.88 / 88.56 at strict,
 * against 89.79 / 90.48 unconstrained — 0.91 and 1.92 points, which is a lot on
 * a scale where every weight in this model carries less uncertainty than that.
 * A default of 2 was the right answer to that measurement.
 *
 * The measurement was the problem. Nearly all of that cost was being charged for
 * shared weaknesses the roster *answered*, and once the count dropped them the
 * justification for slack went with it. The singles roster at strict carries
 * four shared weaknesses and a repeated type, every one of them covered by a
 * teammate; the previous rule refused it and charged 1.92 points to do so.
 *
 * The knob is kept because the floor mechanism still needs it and a user may
 * reasonably want to trade defensive tidiness for individual quality. It is
 * simply no longer paying for anything by default.
 *
 * Measured 2026-08-13 over the app's default candidate pool.
 */
export const DEFAULT_UNANSWERED_WEAKNESS_SLACK = 0;

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

/**
 * How many times a roster repeats an elemental type.
 *
 * A roster of Steel/Dragon, Steel/Psychic and Psychic/Fairy repeats Steel once
 * and Psychic once, so it scores 2. Counted per repetition rather than per
 * repeated type, so a third Steel costs again.
 *
 * ## Why this is not already covered by the shared-weakness penalty
 *
 * It very nearly is, and that was the thing to check before adding it. Team
 * scoring charges shared weaknesses directly, and across the default pool the
 * proxy is a strong one — pairs sharing a type average **1.96** shared
 * weaknesses against **0.49** for pairs that share none, four times as many.
 *
 * So this is not new information, and it must not become a second charge on the
 * same property. That is the defect this file has already found twice, in the
 * `coverage` and `quadrupleWeakness` terms removed above. **It binds generation
 * only and enters no score**, exactly as `typingKey` does. The team scorer keeps
 * saying what it said; the generator stops *suggesting* the roster.
 *
 * The charge was demonstrably not enough on its own. Under the app's default
 * filters the best generated roster was:
 *
 *   archaludon, metagross, annihilape, primarina, kleavor, oranguru  86.91
 *
 * which doubles both Steel and Psychic. The best with no repeated type at all is
 *
 *   archaludon, annihilape, primarina, kleavor, overqwil, oranguru   86.79
 *
 * — **0.12 points** worse, on a scale where every weight in this model carries
 * more uncertainty than that. As with the typing rule, the scoring is right that
 * the difference is small and the generator should still not be spending a slot
 * on it.
 *
 * ## Why a budget rather than a ban
 *
 * 8.9% of type-sharing pairs share *no* weakness at all — the second type can
 * undo the first, and Steel/Dragon against Ground/Steel resist Fire differently
 * despite both being Steel. A flat prohibition would be wrong for those, and
 * would fail outright on a pool a user has filtered down to a few types.
 *
 * `generateRosters` therefore searches strictest-first and loosens one
 * repetition at a time, so a repeated type is spent only when nothing cleaner
 * fits. On a pool narrowed to Steel and Dragon — 32 Pokemon, where six disjoint
 * types do not exist — it degrades to a roster at overlap 4 rather than falling
 * straight through to unconstrained.
 *
 * @param roster Members to inspect.
 * @returns Total repetitions, 0 when every member's types are its own.
 */
export function countTypeOverlap(roster: { types: string[] }[]): number {
  const counts = new Map<string, number>();
  roster.forEach((member) => member.types.forEach((type) => {
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }));
  return [...counts.values()].reduce((total, count) => total + count - 1, 0);
}

/**
 * How many times a roster repeats a weakness.
 *
 * Same shape as `countTypeOverlap` and the same rules — counted per repetition,
 * so a third member weak to Ground costs again, and it binds generation only and
 * enters no score. It replaces that function in the search, and the reason is
 * that `countTypeOverlap` was a *proxy* for this.
 *
 * ## Why measure the thing rather than the stand-in
 *
 * The proxy is good. Across the legal pool, pairs sharing an elemental type
 * average 1.86 shared weaknesses against 0.48 for pairs that share none. But it
 * is wrong in both directions, and the errors are not rare:
 *
 * | pairs             | count  | mean shared | misclassified          |
 * | ----------------- | ------ | ----------- | ---------------------- |
 * | share a type      |  3,056 | 1.86        | 10.7% share *no* weakness |
 * | share no type     | 18,472 | 0.48        |  7.5% share 2 or more  |
 *
 * The 10.7% is the expensive half: those are rosters the old rule refused to
 * generate for no defensive reason at all. Steel/Dragon beside Ground/Steel is
 * the case the doc above already named — both Steel, and they resist Fire
 * differently, so the second type undoes the first.
 *
 * Measured 2026-08-13 over the 208 legal species of Regulation M-B in default
 * form, using each Pokemon's *ability-adjusted* weaknesses. That last part is
 * why the proxy has got slightly worse since it was chosen: the recorded figure
 * was 8.9%, and it rose to 10.7% when the resist abilities moved into the damage
 * relations. A Thick Fat Venusaur is no longer weak to Fire, and the typing it
 * is derived from cannot know that. The direct measure improves as the model
 * does; the proxy cannot.
 *
 * ## What this does not change
 *
 * Shared weaknesses are already charged by `scoreTeamSynergy`, and this must not
 * become a second charge on the same property — the defect removed twice above,
 * from the `coverage` and `quadrupleWeakness` terms. It is a constraint on what
 * the generator will *suggest*, not an opinion about what a roster is worth. A
 * user who builds one by hand still gets scored honestly.
 *
 * @param roster Members to inspect, carrying ability-adjusted weaknesses.
 * @returns Total repetitions, 0 when no two members share a weakness.
 */
export function countSharedWeaknesses(roster: { weaknesses?: string[] }[]): number {
  const counts = new Map<string, number>();
  roster.forEach((member) => (member.weaknesses ?? []).forEach((weakness) => {
    counts.set(weakness, (counts.get(weakness) ?? 0) + 1);
  }));
  return [...counts.values()].reduce((total, count) => total + count - 1, 0);
}

interface WeaknessProfile {
  weaknesses?: string[];
  /** Includes immunities: `createTypeSummary` builds this as the 0x, 0.25x and 0.5x buckets. */
  resistances?: string[];
}

/**
 * How many times a roster repeats a weakness *that nothing on it resists*.
 *
 * The measure the search actually constrains on, and the third step in a chain
 * where each stage was a stand-in for the next. Repeated typings stood in for
 * repeated weaknesses; repeated weaknesses stand in for this.
 *
 * Two members weak to Ground with a third resisting it is a hole somebody
 * covers. Two members weak to Ground with nobody answering is how a game is
 * lost, and only the second is worth spending budget on. `teamCoverage.ts` has
 * said so all along — its `defensivelyUncoveredWeaknesses` is documented as "the
 * types that actually threaten the team" — and the roster search was not reading
 * it.
 *
 * The gap is not marginal. Across the top 200 generated rosters in each format,
 * **96%** had a raw shared-weakness count that overstated the real threat, and
 * the roster the generator picked in doubles counted 2 shared weaknesses of
 * which **0** were unanswered. It was paying budget for redundancy that the
 * roster already covered.
 *
 * Measured 2026-08-13 over the app's default candidate pool.
 *
 * ## Immunities need no special case
 *
 * `resistances` is the broad "takes reduced damage" set and already contains the
 * 0x bucket, so a Levitate answer to Ground counts here without being named
 * separately. That is the same set `resistanceBreadth` scores against.
 *
 * @param roster Members carrying ability-adjusted weaknesses and resistances.
 * @returns Repetitions of unanswered weaknesses, 0 when every shared weakness
 *   has someone to switch into.
 */
export function countUnansweredWeaknesses(roster: WeaknessProfile[]): number {
  const counts = new Map<string, number>();
  const answered = new Set<string>();
  roster.forEach((member) => {
    (member.weaknesses ?? []).forEach((weakness) => {
      counts.set(weakness, (counts.get(weakness) ?? 0) + 1);
    });
    (member.resistances ?? []).forEach((resistance) => answered.add(resistance));
  });

  let total = 0;
  counts.forEach((count, type) => {
    if (!answered.has(type)) total += count - 1;
  });
  return total;
}

/**
 * Lower bound on what `countUnansweredWeaknesses` can still fall to.
 *
 * Needed because that measure is **not prefix-monotone**: adding a member who
 * resists Ground removes Ground from the tally entirely, so a partial roster
 * over budget can still complete to one under it. `countSharedWeaknesses` had no
 * such problem — adding a member could only ever raise it — and pruning the beam
 * on the direct count would silently discard valid rosters.
 *
 * So the beam prunes on this instead. A repeated weakness counts against a
 * partial only when *nothing left in the candidate pool* resists it, which makes
 * the value a true lower bound on any completion: those types cannot be answered
 * by anyone still available, and their counts only grow as members are added.
 * Pruning when the bound exceeds the budget therefore cannot drop a roster that
 * would have met it.
 *
 * The bound is loose early — with the whole pool remaining, almost every type is
 * still answerable and the bound sits near zero — and tightens as the search
 * consumes candidates. That is the right shape for a beam: permissive while
 * options remain, decisive once they do not.
 *
 * @param roster Members chosen so far.
 * @param answerableLater Types some remaining candidate still resists.
 * @returns A count no completion of this roster can go below.
 */
function boundUnansweredWeaknesses(
  roster: WeaknessProfile[],
  answerableLater: ReadonlySet<string>
): number {
  const counts = new Map<string, number>();
  const answered = new Set<string>();
  roster.forEach((member) => {
    (member.weaknesses ?? []).forEach((weakness) => {
      counts.set(weakness, (counts.get(weakness) ?? 0) + 1);
    });
    (member.resistances ?? []).forEach((resistance) => answered.add(resistance));
  });

  let total = 0;
  counts.forEach((count, type) => {
    if (!answered.has(type) && !answerableLater.has(type)) total += count - 1;
  });
  return total;
}

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
  const applicable = getApplicableRoles(hasAlly);
  const effect = getAbilityEffect(entry.abilityName);
  const abilityRole = effect && applicable.includes(effect.role) ? effect.role : undefined;

  // A role the Pokemon can only reach with a move counts too, at a discount for
  // the moveslot it costs. Without this the browser is blind to the Pokemon the
  // format plays for their support: Corviknight is ranked on its attacking stat
  // while it is brought for Tailwind, and Pelipper's Wide Guard is invisible.
  // Roles the ability already supplies are not paid twice.
  const moveRoleValue = getMoveSourcedRoles(entry.name)
    .filter((role) => applicable.includes(role) && role !== abilityRole)
    .reduce((total, role) => total + soloRoleValue(role), 0);

  // Prankster makes those moves land, which is worth more than being able to
  // learn them. It is the one ability whose whole value is *which* moves it
  // accelerates, and the move tables are what finally made that computable.
  const moveCredit = entry.abilityName && RELIABLE_STATUS_ABILITIES.has(entry.abilityName)
    ? PRANKSTER_ROLE_CREDIT
    : MOVE_ROLE_CREDIT;

  const roleValue = soloRoleValue(abilityRole) + (moveCredit * moveRoleValue);

  // Stats modulated by typing, on the same terms the team scorer will use.
  // Resistances and weaknesses are not added separately: they are already what
  // normalizedDamageFromScore measures.
  const quality = scoreMemberQuality({
    stats: entry.stats,
    normalizedDamageToScore: entry.normalizedDamageToScore,
    normalizedDamageFromScore: entry.normalizedDamageFromScore,
    abilityName: entry.abilityName,
    varietyName: entry.name
  });

  // Only the reach STAB does not already have. The offence term inside
  // `quality` scores STAB coverage through `normalizedDamageToScore`, and the
  // move tables include moves of the Pokemon's own types, so the raw list
  // charged for most of that a second time. See `coverageBeyondStab`.
  const extraCoverage = coverageBeyondStab(entry.coverages, entry.moveCoverages);

  // And priced by what could be done with it. A move that can be learned is
  // only a threat if the Pokemon has an attacking stat to fire it off, so the
  // charge is modulated by the same offence term `quality` is built on rather
  // than paid flat. See MOVE_COVERAGE_MODULATION.
  const reachValue = (1 - MOVE_COVERAGE_MODULATION) +
    (MOVE_COVERAGE_MODULATION * offenseStatTerm(entry.stats, entry.abilityName));

  return (quality * w.quality) +
    (roleValue * w.supportRole) +
    (extraCoverage.length * w.moveCoverage * reachValue);
}

/**
 * Builds rosters from a Pokemon pool, ranked by the bring options they offer.
 *
 * Two constraints bind the search, and neither enters a score. No two members
 * on the same type combination, and no more shared weaknesses than the pool's
 * own floor plus `unansweredWeaknessSlack`.
 *
 * A narrow pool — a user filtering the browser down to a handful of typings —
 * must still get a roster rather than an error, so the floor is measured against
 * that pool and the typing rule is dropped entirely if it cannot be met. In that
 * case doubling up is the honest answer rather than a failure.
 *
 * Costs between two and about five beam searches: one unconstrained to bound the
 * bisection, log₂ of the floor to find it, and one at the loosened budget unless
 * the unconstrained best already fits.
 *
 * @param options Pool, format, roster size, seed, slack and pruning limits.
 * @returns Rosters ordered by score, best first. May be empty.
 */
export function generateRosters(options: GenerateRostersOptions): GeneratedRoster[] {
  if (options.allowDuplicateTypings) return searchRosters(options, true, Infinity);

  // Find the strictest budget the pool can meet, then spend `slack` above it.
  //
  // The floor has to be discovered rather than assumed, because it depends
  // entirely on the pool: the full roster reaches zero shared weaknesses, and a
  // pool narrowed to Steel and Dragon cannot get below seven. An absolute budget
  // would be vacuous on the first and impossible on the second.
  //
  // Bisection rather than a scan from zero. The old rule counted repeated
  // *types* and could usually be satisfied at zero, so a linear scan stopped on
  // its first attempt; repeated weaknesses need several steps, and each step is
  // a full beam search. Feasibility is monotone in the budget — a roster valid
  // at B is valid at B+1 — so bisection finds the same floor in log time. The
  // upper bound is the unconstrained search: if that finds nothing, no budget
  // will.
  const relaxed = searchRosters(options, false, Infinity);
  if (relaxed.length === 0) return searchRosters(options, true, Infinity);

  const slack = options.unansweredWeaknessSlack ?? DEFAULT_UNANSWERED_WEAKNESS_SLACK;

  let low = 0;
  let high = countUnansweredWeaknesses(relaxed[0].members);
  let floor = high;
  let strictest = relaxed;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const found = searchRosters(options, false, mid);
    if (found.length > 0) {
      strictest = found;
      floor = countUnansweredWeaknesses(found[0].members);
      high = floor;
    } else {
      low = mid + 1;
    }
  }

  if (slack <= 0) return strictest;

  // The unconstrained best already fits, so it is also the best within budget —
  // higher budgets admit strictly more rosters. Saves the final search on the
  // common case where the pool is wide enough that slack covers the gap.
  const budget = floor + slack;
  if (countUnansweredWeaknesses(relaxed[0].members) <= budget) return relaxed;

  const loosened = searchRosters(options, false, budget);
  return loosened.length > 0 ? loosened : strictest;
}

function searchRosters(
  options: GenerateRostersOptions,
  allowDuplicateTypings: boolean,
  maxUnansweredWeaknesses: number
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

  const scoringOptions = { format, typeCount, typeValues: options.typeValues };
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

  // Types some candidate at or after each index still resists, built back to
  // front. `answerableLater[i]` is what the pool can still cover once the search
  // has passed index i, and it is what keeps the pruning bound sound.
  const answerableLater: Set<string>[] = new Array(candidates.length + 1);
  answerableLater[candidates.length] = new Set();
  for (let i = candidates.length - 1; i >= 0; i--) {
    const next = new Set(answerableLater[i + 1]);
    (candidates[i].resistances ?? []).forEach((resistance) => next.add(resistance));
    answerableLater[i] = next;
  }

  const canAdd = (roster: PokemonEntry[], candidate: PokemonEntry, index: number): boolean => {
    if (roster.length >= rosterSize) return false;
    if (roster.some((member) => member.name === candidate.name)) return false;
    if (!allowDuplicateSpecies && roster.some((member) => member.speciesName === candidate.speciesName)) return false;
    // A seed that already doubles a typing keeps whatever the user chose; this
    // only stops the search from adding more of one.
    if (!allowDuplicateTypings && roster.some((member) => typing(member) === typing(candidate))) return false;
    // Pruned on the lower bound rather than the measure itself, because the
    // measure can *fall* when a member is added. See boundUnansweredWeaknesses.
    if (maxUnansweredWeaknesses !== Infinity
      && boundUnansweredWeaknesses([...roster, candidate], answerableLater[index + 1])
        > maxUnansweredWeaknesses) return false;
    return true;
  };

  let partials: PokemonEntry[][] = [[...seed]];

  candidates.forEach((candidate, index) => {
    const remaining = candidates.length - index - 1;
    const expanded = partials.flatMap((roster) => {
      const branches = [roster];
      if (canAdd(roster, candidate, index)) branches.push([...roster, candidate]);
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
    // The beam pruned on a lower bound, which is deliberately permissive. Only a
    // finished roster can be measured, so the real budget is enforced here.
    .filter((roster) => maxUnansweredWeaknesses === Infinity
      || countUnansweredWeaknesses(roster) <= maxUnansweredWeaknesses)
    .map((members) => {
      const evaluation = evaluateRoster(members.map(toRosterMember), scoringOptions);
      return { members, evaluation, score: evaluation.score };
    })
    .sort((a, b) => b.score - a.score);
}
