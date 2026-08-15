import { UNIFORM_TYPE_THREAT, typeThreatWeight } from './typeThreat';
import type { DamageRelations, NamedResource } from './pokedexTypes';
import type { TypeThreatWeights } from './typeThreat';

/**
 * Baseline used to normalize damage scores. It doubles as the number of
 * elemental types in play: getBaseTypes keeps types whose id is <= baseScore,
 * so with the default of 18 every standard type is included.
 */
export const DEFAULT_BASE_SCORE = 18;

/**
 * What a true immunity is worth, and the one place this score stops being
 * expected damage.
 *
 * Every other bucket is priced at `multiplier - 1`, so the score reads as damage
 * taken relative to neutral: 2x adds one type's worth, 0.5x removes half of one.
 * On that arithmetic 0x is worth exactly -1, because removing all of something
 * is all you can remove — and that made a weakness and an immunity exact
 * mirrors. Normal, weak to Fighting and immune to Ghost, netted to precisely
 * `baseScore`.
 *
 * That is right about damage and wrong about value. An immunity is not a
 * quantity of damage avoided, it is a **threshold**: the matchup becomes free
 * rather than cheap, a stronger attacker cannot break through it, and the switch
 * it enables costs nothing. Expected damage is linear and none of that is.
 *
 * ## Where -2 comes from, and the unit error that first made it -4
 *
 * Not from this scale, which cannot express a threshold at all. It comes from
 * the standard alternative — reading each multiplier as hits survived, where the
 * coefficient is `log2(multiplier)` and 0x is negative infinity. That reading
 * needs a cap, and the cap is measurable: the lowest non-zero incoming
 * multiplier reachable anywhere in the ability × typing cross product is 0.125,
 * a quarter-resist halved again by Thick Fat. `log2(0.125)` is -3, so immunity
 * sits one rung below the worst finite damage the model can produce.
 *
 * **That -3 is in log units and this scale is not**, which is the step that was
 * missed. The two metrics disagree on what a plain resistance is worth: 0.5x is
 * -1 on the log reading and -0.5 here, so the log metric prices every resistance
 * at twice this one. Carrying -3 across unconverted made an immunity worth eight
 * single resistances when the metric it was borrowed from says three or four.
 * Dividing by the same factor the resistances differ by gives -2, which is what
 * "one rung below the reachable floor" actually means in this scale's units.
 *
 * The symptom was visible before the arithmetic was: at -4 the defensive score
 * correlated -0.824 with a typing's raw immunity *count* and -0.049 with its
 * resistance count, so ten Steel resistances had stopped competing with two
 * immunities at all. At -2 those read -0.606 and -0.162 against 0.597 for
 * weaknesses, and all three buckets decide something again.
 *
 * So the number is borrowed rather than derived in place, and that is the soft
 * spot, stated rather than buried: it is the value the *other* metric assigns,
 * converted into this one. It is reasoned against a metric, not validated
 * against match outcomes — the same standing as `MEMBER_WEIGHTS` and
 * `TYPE_MODULATION`, and unlike `STATUS_THREAT`, which is measured.
 *
 * Capping at the floor itself rather than a rung below would give -1.5, and is
 * arguably cleaner for stopping at what the model can observe. -2 keeps the
 * "one rung below" reading the change was made under.
 *
 * ## What it changed
 *
 * Only the 105 of 171 typings that have an immunity; the other 66 are untouched.
 * Adopting the full log scale instead would have moved everything — resistances
 * would double in value and a 4x weakness would soften from +3 to +2 — and the
 * rank correlation against the old scale was 0.797 where this is 0.831. The
 * larger change was never the one being asked for, so it was not taken.
 */
export const IMMUNITY_VALUE = -2;

/**
 * Scores how much a typing suffers on defence. Lower is better.
 *
 * **`baseScore` is the neutral line, and that is load-bearing.** A typing with
 * nothing in any bucket — no weaknesses, no resistances, no immunities, taking
 * 1x from all eighteen types — scores exactly `baseScore`, because every term
 * below adds or subtracts from it and all of them are zero. So the number is not
 * an arbitrary baseline: it is "takes neutral damage from everything", and a
 * score reads as the distance from that.
 *
 * **Typings no longer land on it by cancellation.** They used to: Normal's
 * Fighting weakness at +1 against its Ghost immunity at -1 netted exactly to
 * `baseScore`, and that tidiness was the clearest symptom of pricing an immunity
 * as a quantity of damage. With `IMMUNITY_VALUE` at -2 Normal scores 17, and the
 * distribution moves with it: 13 of the 171 combinations sit on the line against
 * 14 before, 69 beat it against 42, and 89 fall short against 115.
 *
 * ## The neutral line is still a line, and no longer a plateau
 *
 * `maxDamageFromScore` used to lean on this comment: the line was principled
 * *and* it was somewhere typings actually landed, so admitting everything at or
 * under it swept up a natural tie group. Threat weighting ended the second half.
 * Scores are continuous now, **no typing scores exactly `baseScore`** — 0 of 171
 * against 14 unweighted — and 60 sit within 0.6 of it. Cutting there separates
 * pure Water at 18.069 from Ghost/Grass at 17.782 and calls the difference
 * meaningful, which at that density it is not.
 *
 * The definition is untouched: a typing with empty buckets still scores exactly
 * `baseScore`, and the score still reads as distance from taking neutral damage.
 * What expired is the filter's claim to be principled rather than tuned, so the
 * filter is off by default. See its documentation in `resistantTypeScan.ts`.
 *
 * ## Threat weighting
 *
 * Each bucket entry is multiplied by its attacking type's threat weight, so a
 * weakness to a type the metagame cannot bring costs close to nothing and a
 * weakness to one it brings constantly costs close to the full amount. Passing
 * `UNIFORM_TYPE_THREAT` — the default — restores the original count and is what
 * every existing caller and every recorded calibration measured. See
 * `typeThreat.ts` for what the weights measure and why it is availability of
 * the attack rather than prevalence of the typing.
 *
 * **The weights apply to resistances and immunities too, not only weaknesses.**
 * A resistance to a type nothing brings is worth as little as a weakness to one,
 * and an immunity to it is worth less still now that immunity carries four times
 * the weight — leaving that term unweighted would let a Ghost immunity collect
 * its full -4 in a metagame with no Ghost attackers, which is the original bug
 * wearing a different hat.
 *
 * The reading is `baseScore` plus the threat-weighted sum over every type of
 * what that matchup is worth: `multiplier - 1` for the four buckets that are
 * quantities of damage, and `IMMUNITY_VALUE` for the one that is a threshold.
 *
 * @param dr Damage relations to score.
 * @param baseScore Baseline, which is also the number of types in play.
 * @param weights Threat weight per attacking type. Defaults to uniform.
 */
export const calculateDamageFromScore = (
  dr: DamageRelations,
  baseScore: number,
  weights: TypeThreatWeights = UNIFORM_TYPE_THREAT
): number => {
  const weighted = (bucket: NamedResource[] | undefined, coefficient: number): number =>
    (bucket || []).reduce(
      (sum, { name }) => sum + (coefficient * typeThreatWeight(weights, name)),
      0
    );

  // The first four coefficients are `multiplier - 1`, the identity
  // DAMAGE_FROM_BUCKETS in pokedexAbilities.ts depends on; keep them in step
  // with that table. The fifth deliberately breaks it — see IMMUNITY_VALUE. The
  // identity survives where it is actually load-bearing, because a reduction
  // ability can only ever land a type *between* buckets and 0x is the floor:
  // nothing multiplies down to a residual against it.
  return baseScore
    + weighted(dr.quadruple_damage_from, 3)
    + weighted(dr.double_damage_from, 1)
    + weighted(dr.half_damage_from, -0.5)
    + weighted(dr.quarter_damage_from, -0.75)
    + weighted(dr.no_damage_from, IMMUNITY_VALUE);
};

export const calculateDamageToScore = (dr: DamageRelations, baseScore: number): number => {
  return baseScore
    + dr.double_damage_to.length
    - (0.5 * dr.half_damage_to.length)
    - dr.no_damage_to.length;
};

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * Baseline the bounds below were measured at. The standard chart has 18 types,
 * and `baseScore` doubles as the type count, so this is the full chart.
 */
const MEASURED_AT_BASE_SCORE = 18;

/**
 * Reachable extremes of the two scores, measured rather than derived.
 *
 * These were the model's largest calibration error, and the argument against the
 * old bounds is already written down in `teamScoring.ts` — under `STAT_CEILINGS`,
 * which explains that normalizing against a theoretical maximum "would compress
 * every realistic Pokemon into a narrow band and cost the model most of its
 * discrimination". The stats got competitive ceilings on that reasoning. These
 * scores did not, and the identical mistake sat unnoticed twenty lines away.
 *
 * The old bounds were formula extremes: 0 to `4 * baseScore` defensively, the
 * hypothetical typing that takes quadruple damage from all eighteen types. Real
 * typings occupy a sliver of it. Measured across all 171 combinations the scan
 * produces, `damage_from_score` ran 13.25 to 26 — **17.7% of its nominal 0..1
 * range** — and `TYPE_MODULATION` then halved what little was left. The result:
 * the best defensive typing in the game beat the worst by 2.7 points of final
 * ranking, against 12.1 points for the Speed gap between Toxapex and Talonflame.
 * A tool built to rank defensive typings had made typing its smallest term.
 *
 * ## How these were measured
 *
 * `scripts/measure-damage-bounds.mjs`, re-run 2026-08-13. Every one of the 171
 * type combinations, crossed with each of the seventeen abilities that alter
 * damage relations plus the no-ability case — 3,078 profiles. That is a superset
 * of what any roster holds, which is the property a bound needs: a Pokemon
 * cannot fall outside it. Abilities never touch the offensive buckets, so `to`
 * is the typing range unmodified.
 *
 * Including abilities moves the defensive minimum from 13.25 to 11.25 — Steel/
 * Fairy with Earth Eater. Pinning the bound at the bare-typing 13.25 would have
 * saturated the entire top of the range to zero, losing exactly the
 * discrimination this change exists to recover.
 *
 * The cross product grew from eleven abilities to seventeen when the resist
 * abilities moved into `pokedexAbilities.ts`, and **neither bound moved**. Thick
 * Fat on Steel/Fairy reaches 11.25 exactly, tying Earth Eater rather than beating
 * it: halving an existing 0.5x resistance is worth a quarter of a weakness-weight,
 * and the two paths to the floor happen to meet.
 *
 * ## Re-measured 2026-08-14, for IMMUNITY_VALUE
 *
 * The floor fell from 11.25 to 8.25 and the ceiling did not move. Both follow
 * directly from what changed: only typings with immunities are affected, so the
 * ceiling — Rock/Ice, which has none — is untouched, while the floor is set by
 * the profile holding the most immunities and now collects twice as much for
 * each. Ghost/Steel with Earth Eater is immune to Normal, Fighting, Poison and
 * Ground, and takes -8 where it used to take -4.
 *
 * The range therefore widens from 14.75 to 17.75, which *compresses* every
 * typing's normalized score — the direction this whole comment warns against.
 * It is accepted rather than corrected because the compression is not spurious:
 * the extra range is occupied by real profiles, and the raw spread between
 * typings grew alongside the denominator. The realized swing is the number that
 * settles it, and it is measured under `TYPE_MODULATION`.
 *
 * These are the numbers for -2. An earlier pass shipped -4 through a unit error
 * and measured 0.25..26 here; that bound is superseded, not an alternative.
 *
 * ## Scaling, and its limit
 *
 * Expressed as multiples of `baseScore` because both the baseline and the bucket
 * sums scale with the number of types in play. That scaling is a reasonable
 * extrapolation, not a measurement: these were observed on the full chart, and a
 * scan run with fewer types is a different chart whose real extremes nobody has
 * checked. Values outside the bounds clamp, as they do for `STAT_CEILINGS`.
 */
const OBSERVED_DAMAGE_FROM = { min: 8.25, max: 26 } as const;
const OBSERVED_DAMAGE_TO = { min: 16, max: 27 } as const;

/**
 * Prices the between-bucket reductions a damage-reduction ability leaves behind.
 *
 * Kept here beside `calculateDamageFromScore` because the two are one score: a
 * caller that computes the buckets without adding this is reading a profile with
 * Solid Rock silently switched off.
 *
 * @param dr Damage relations carrying the residuals, if any.
 * @param weights Threat weight per attacking type. Defaults to uniform.
 * @returns The residual total to add to the bucket-derived score.
 */
export const calculateDamageFromResidual = (
  dr: DamageRelations,
  weights: TypeThreatWeights = UNIFORM_TYPE_THREAT
): number =>
  (dr.damage_from_residuals || []).reduce(
    (sum, { name, delta }) => sum + (delta * typeThreatWeight(weights, name)),
    0
  );

/** Reachable extremes of a score, used to normalize it onto 0..1. */
export interface DamageScoreBounds {
  readonly min: number;
  readonly max: number;
}

/**
 * Bounds of calculateDamageFromScore for a given baseline, unweighted.
 *
 * Bounds come from the measurement above rather than from the types present in a
 * scan, so an entry always normalizes to the same value regardless of which
 * Pokemon it was scanned alongside. That determinism is why these are constants
 * rather than a pass over the current results.
 *
 * These hold only for `UNIFORM_TYPE_THREAT`. Under threat weighting every bucket
 * shrinks by its type's weight, the reachable extremes close in, and normalizing
 * against these would re-create the exact compression the comment above exists to
 * document — a weighted score would occupy a fraction of its nominal range and
 * the defensive term would quietly stop deciding anything. `damageBounds.ts`
 * derives the weighted equivalents; nothing else may substitute for them.
 *
 * @param baseScore Baseline score, which is also the number of types in play.
 * @returns The minimum and maximum defensive score a real Pokemon reaches.
 */
export const damageFromScoreBounds = (baseScore: number): DamageScoreBounds => {
  const scale = baseScore / MEASURED_AT_BASE_SCORE;
  return { min: OBSERVED_DAMAGE_FROM.min * scale, max: OBSERVED_DAMAGE_FROM.max * scale };
};

/**
 * Absolute bounds of calculateDamageToScore for a given baseline.
 *
 * @param baseScore Baseline score, which is also the number of types in play.
 * @returns The minimum and maximum achievable offensive score.
 */
export const damageToScoreBounds = (baseScore: number) => {
  const scale = baseScore / MEASURED_AT_BASE_SCORE;
  return { min: OBSERVED_DAMAGE_TO.min * scale, max: OBSERVED_DAMAGE_TO.max * scale };
};

/**
 * Normalizes a defensive score to 0..1 where 0 is the best possible defensive
 * profile and 1 the worst. Undefined scores fall back to the midpoint.
 *
 * @param score Raw defensive score, or undefined when unavailable.
 * @param baseScore Baseline the score was calculated with.
 * @param bounds Extremes to normalize against. Required whenever the score was
 *   calculated with threat weights, since the unweighted default no longer
 *   describes the range a weighted score can reach.
 * @returns A value in 0..1, or 0.5 when the score is unknown.
 */
export const normalizeDamageFromScore = (
  score: number | undefined,
  baseScore: number,
  bounds: DamageScoreBounds = damageFromScoreBounds(baseScore)
): number => {
  if (score === undefined) return 0.5;
  const { min, max } = bounds;
  return max === min ? 0.5 : clamp01((score - min) / (max - min));
};

/**
 * Normalizes an offensive score to 0..1 where 1 is the broadest possible
 * offensive profile. Undefined scores fall back to the midpoint.
 *
 * @param score Raw offensive score, or undefined when unavailable.
 * @param baseScore Baseline the score was calculated with.
 * @returns A value in 0..1, or 0.5 when the score is unknown.
 */
export const normalizeDamageToScore = (score: number | undefined, baseScore: number): number => {
  if (score === undefined) return 0.5;
  const { min, max } = damageToScoreBounds(baseScore);
  return max === min ? 0.5 : clamp01((score - min) / (max - min));
};

export const filterUniqueBy = (arr: NamedResource[]): NamedResource[] => {
  return arr.filter(function(this: Set<string>, { name }: NamedResource) {
    return !this.has(name) && this.add(name);
  }, new Set<string>());
};

export const cloneDamageRelations = (dr: DamageRelations): DamageRelations => ({
  double_damage_from: [...dr.double_damage_from],
  half_damage_from: [...dr.half_damage_from],
  no_damage_from: [...dr.no_damage_from],
  double_damage_to: [...dr.double_damage_to],
  half_damage_to: [...dr.half_damage_to],
  no_damage_to: [...dr.no_damage_to],
  quadruple_damage_from: [...(dr.quadruple_damage_from || [])],
  quarter_damage_from: [...(dr.quarter_damage_from || [])],
  damage_from_residuals: dr.damage_from_residuals
    ? dr.damage_from_residuals.map((residual) => ({ ...residual }))
    : undefined,
  damage_from_score: dr.damage_from_score,
  damage_to_score: dr.damage_to_score
});

export const createTypeSummary = (dr: DamageRelations) => ({
  weaknesses: ((dr.quadruple_damage_from || []).concat(dr.double_damage_from)).map(w => w.name),
  quadruple_weaknesses: (dr.quadruple_damage_from || []).map(w => w.name),
  // `resistances` stays the broad "takes reduced damage" set, which is what a
  // defensive answer means. `immunities` is the strict 0x subset: it matters on
  // its own in doubles, where resisting a partner's Earthquake at 0.5x still
  // hurts and only true immunity makes the move free to click.
  immunities: dr.no_damage_from.map(i => i.name),
  resistances: dr.no_damage_from
    .concat(dr.quarter_damage_from || [])
    .concat(dr.half_damage_from)
    .map(r => r.name),
  ineffectives: dr.no_damage_to
    .concat(dr.half_damage_to)
    .map(i => i.name),
  coverages: dr.double_damage_to.map(c => c.name),
  damage_from_score: dr.damage_from_score,
  damage_to_score: dr.damage_to_score
});
