// Validates the Team Workbench's roster score against real teams.
//
// `measure-usage-correlation.mjs` validates the Pokemon Browser, and it cannot
// do more than that: usage is a per-Pokemon number, so it can only test member
// quality. But member quality is 45% of a roster's score and synergy is 55%, and
// synergy is the half this tool exists for. Nothing had ever tested it.
//
// Run with:  npx tsx scripts/measure-roster-validation.mjs
//
// ## The comparison, and why the second baseline is the real one
//
// Real tournament teams are scored against two synthetic baselines:
//
// 1. **Random legal** — six drawn uniformly from everything the regulation
//    permits. Beating this is necessary and almost meaningless: real teams are
//    made of strong Pokemon, so member quality alone would win it.
//
// 2. **Composition-matched** — six drawn from the *same distribution of Pokemon
//    the real teams use*, weighted by how often they appear. Same ingredients,
//    random assembly. This baseline has, by construction, roughly the same member
//    quality as the real teams, so anything the model gains over it has to come
//    from recognising which *combinations* work.
//
// That second comparison is the one that tests synergy, and it is the reason to
// have gone and got team lists at all. The score is also decomposed into its two
// halves against both baselines, because "the roster score beats the baseline"
// and "the synergy term beats the baseline" are different claims and only the
// second is news.
//
// ## What placement can and cannot say
//
// Each team's Swiss finish is recorded and correlated, but it is the weakest
// comparison here and is reported last. In a 112-player Bo3 event most of the
// variance in where a team lands is the player and the pairings, not the team, so
// a near-zero correlation is the expected result and not evidence of much. It is
// included because its absence would be conspicuous, not because it settles
// anything.

import { readFileSync } from 'node:fs';
import { loadPokemonCatalog } from '../src/lib/pokemonCatalogLoader.ts';
import { getCatalogResistantTypes } from '../src/lib/pokemonCatalogScan.ts';
import { flattenToPokemon } from '../src/lib/pokemonEntry.ts';
import { evaluateRoster } from '../src/lib/rosterScoring.ts';
import { analyzeTeamCoverage } from '../src/lib/teamCoverage.ts';
import { analyzeTeamRoles, isImmuneToAllyMoves } from '../src/lib/abilityRoles.ts';
import { scoreMemberQuality, scoreTeamSynergy } from '../src/lib/teamScoring.ts';
import { BATTLE_FORMATS } from '../src/lib/battleFormats.ts';
import { DEFAULT_BASE_SCORE } from '../src/lib/pokedexScoring.ts';

const data = JSON.parse(readFileSync(new URL('./teams-reg-m-b.json', import.meta.url), 'utf8'));
const format = BATTLE_FORMATS.doubles;
const SAMPLES = 4000;

// Deterministic, so a rerun that reports a different number reports a real
// change rather than a different draw.
let seed = 20260815;
const random = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

const catalog = await loadPokemonCatalog();
// Megas are legal in M-B and half these teams carry one, so the pool has to hold
// them. Filters are opened for the reason measure-usage-correlation.mjs gives:
// they describe what to show, and a tournament does not respect them.
const scan = await getCatalogResistantTypes(catalog, {
  pokemonFilters: { regulation: 'M-B', allowMegas: true },
  statsFilters: { minimumAttacks: 0, minimumBulk: 0 },
  typeFilters: { limitQuadrupleDamage: false }
});
const pool = flattenToPokemon(scan);
console.log(`pool: ${pool.length} varieties (megas allowed, filters opened)`);

// Display names to variety names. Everything else lower-cases and hyphenates.
const ALIASES = {
  'hisuian samurott': 'samurott-hisui',
  'basculegion': 'basculegion-male',
  'basculegion-f': 'basculegion-female',
  'mr. rime': 'mr-rime',
  'aegislash': 'aegislash-shield',
  'mimikyu': 'mimikyu-disguised',
  'palafin': 'palafin-zero',
  'meowstic': 'meowstic-male',
  'maushold': 'maushold-family-of-four',
  'pyroar': 'pyroar-male'
};
const byName = new Map(pool.map((entry) => [entry.name, entry]));
const resolve = (display) => {
  const key = display.trim().toLowerCase();
  return byName.get(ALIASES[key] ?? key.replace(/\s+/g, '-')) ?? null;
};

const toMember = (entry) => ({
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

// The two halves, recomputed rather than read off a score, since a composed
// score cannot be taken apart again. Same construction as scoringValidation.
const halves = (entries) => {
  const members = entries.map(toMember);
  const coverage = analyzeTeamCoverage(members.map((member) => ({
    ...member,
    immuneToAllyMoves: format.hasAlly && isImmuneToAllyMoves(member.abilityName)
  })));
  const roles = analyzeTeamRoles(
    members.map((member) => ({ abilityName: member.abilityName })),
    { hasAlly: format.hasAlly }
  );
  const qualities = members.map((member) => scoreMemberQuality({
    stats: member.stats,
    normalizedDamageToScore: member.normalizedDamageToScore,
    normalizedDamageFromScore: member.normalizedDamageFromScore,
    abilityName: member.abilityName,
    varietyName: member.name
  }));
  return {
    quality: qualities.reduce((sum, value) => sum + value, 0) / qualities.length,
    synergy: scoreTeamSynergy({
      coverage,
      roles,
      format,
      typesTotal: new Set(members.flatMap((member) => member.types)).size,
      teamSize: members.length,
      typeCount: DEFAULT_BASE_SCORE
    }),
    score: evaluateRoster(members, { format }).score
  };
};

// Resolve the real teams, and count what falls out. A silently dropped team is a
// biased sample, so anything unresolved is named.
const realTeams = [];
const missing = new Map();
for (const event of data.events) {
  for (const team of event.teams) {
    const entries = team.pokemon.map(resolve);
    const unresolved = team.pokemon.filter((name, index) => !entries[index]);
    if (unresolved.length > 0) {
      for (const name of unresolved) missing.set(name, (missing.get(name) ?? 0) + 1);
      continue;
    }
    realTeams.push({ event: event.slug, placement: team.placement, entries });
  }
}
const totalTeams = data.events.reduce((sum, event) => sum + event.teams.length, 0);
console.log(`teams: ${realTeams.length}/${totalTeams} resolved`);

// Tournament fields converge, so the same six Pokemon recur across many entries.
// Duplicates carry no extra information about whether the model can tell a good
// combination from a bad one, and counting them as independent would overstate
// every confidence figure below.
const signature = (team) => team.entries.map((entry) => entry.name).sort().join('+');
const distinctTeams = new Set(realTeams.map(signature)).size;
console.log(`  distinct compositions: ${distinctTeams} of ${realTeams.length} — confidence is bounded by this, not by the row count`);
if (missing.size > 0) {
  console.log('  unresolved names (their teams are dropped, which biases the sample):');
  for (const [name, count] of [...missing].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${name} (${count})`);
  }
}

// The composition-matched baseline draws from what the real teams actually use,
// weighted by frequency, so it has the same ingredients and none of the intent.
const usedCounts = new Map();
for (const team of realTeams) {
  for (const entry of team.entries) usedCounts.set(entry, (usedCounts.get(entry) ?? 0) + 1);
}
const weighted = [];
for (const [entry, count] of usedCounts) {
  for (let i = 0; i < count; i++) weighted.push(entry);
}
console.log(`distinct Pokemon across real teams: ${usedCounts.size}`);

const drawDistinct = (source, size) => {
  const chosen = [];
  const seen = new Set();
  let guard = 0;
  while (chosen.length < size && guard++ < 500) {
    const pick = source[Math.floor(random() * source.length)];
    if (seen.has(pick.name)) continue;
    seen.add(pick.name);
    chosen.push(pick);
  }
  return chosen.length === size ? chosen : null;
};

const sample = (source, label) => {
  const rows = [];
  for (let i = 0; i < SAMPLES; i++) {
    const team = drawDistinct(source, 6);
    if (team) rows.push(halves(team));
  }
  console.log(`  ${label}: ${rows.length} sampled`);
  return rows;
};

console.log('\nsampling baselines...');
const randomLegal = sample(pool, 'random legal');
const matched = sample(weighted, 'composition-matched');
const real = realTeams.map((team) => halves(team.entries));

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const pct = (values, q) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(q * (sorted.length - 1))];
};

// Probability a random real team scores above a random baseline team. 0.5 is a
// coin flip; this is the readable form of the comparison.
const auc = (left, right) => {
  const sorted = [...right].sort((a, b) => a - b);
  let total = 0;
  for (const value of left) {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < value) lo = mid + 1; else hi = mid;
    }
    total += lo;
  }
  return total / (left.length * sorted.length);
};

const compare = (pick, label) => {
  const r = real.map(pick);
  const rl = randomLegal.map(pick);
  const cm = matched.map(pick);
  console.log(`\n  ${label}`);
  console.log(`    real                 mean ${mean(r).toFixed(4)}  p10 ${pct(r, 0.1).toFixed(4)}  p90 ${pct(r, 0.9).toFixed(4)}`);
  console.log(`    random legal         mean ${mean(rl).toFixed(4)}  → real wins ${(100 * auc(r, rl)).toFixed(1)}% of pairings`);
  const a = auc(r, cm);
  // The standard error of an AUC is bounded by the smaller sample, and here that
  // is the count of distinct compositions rather than of team rows.
  const sigma = (a - 0.5) / Math.sqrt((a * (1 - a)) / distinctTeams);
  console.log(`    composition-matched  mean ${mean(cm).toFixed(4)}  → real wins ${(100 * a).toFixed(1)}% of pairings` +
    `  (${sigma.toFixed(1)} SE above chance)`);
};

console.log('\n=== do real teams score higher? ===');
compare((row) => row.score, 'roster score (the number the Workbench shows)');
compare((row) => row.quality, 'member quality half');
compare((row) => row.synergy, 'synergy half');
console.log('\n  The composition-matched column is the one that matters. It holds member');
console.log('  quality roughly fixed, so anything real teams gain there is the model');
console.log('  recognising a combination rather than recognising good Pokemon.');

console.log('\n=== does the score track placement? ===');
const rank = (values) => {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const ranks = new Array(values.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].value === order[i].value) j++;
    const m = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k].index] = m;
    i = j + 1;
  }
  return ranks;
};
const spearman = (left, right) => {
  const a = rank(left);
  const b = rank(right);
  const n = a.length;
  const avg = (xs) => xs.reduce((sum, x) => sum + x, 0) / n;
  const [ma, mb] = [avg(a), avg(b)];
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * db);
};
for (const event of data.events) {
  const indices = realTeams
    .map((team, index) => (team.event === event.slug ? index : -1))
    .filter((index) => index >= 0);
  if (indices.length < 12) continue;
  const scores = indices.map((index) => real[index].score);
  const places = indices.map((index) => -realTeams[index].placement);
  console.log(`  ${event.slug.padEnd(16)} n=${String(indices.length).padStart(3)}  spearman ${spearman(scores, places).toFixed(3)}`);
}
console.log('  Expect ~0. Swiss placement is mostly player and pairing; see the header.');
