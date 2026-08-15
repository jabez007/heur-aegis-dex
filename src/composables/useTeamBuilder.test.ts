import { beforeEach, describe, expect, it } from 'vitest';
import { useTeamBuilder } from './useTeamBuilder';
import { useNotifications } from './useNotifications';
import type { PokemonEntry } from '../lib/pokemonEntry';

const stats = { hp: 78, attack: 84, defense: 78, 'special-attack': 109, 'special-defense': 85, speed: 100 };

const abilityProfiles = {
  blaze: {
    weaknesses: ['water', 'rock', 'ground'],
    quadruple_weaknesses: [],
    resistances: ['fire', 'grass', 'bug'],
    immunities: [],
    coverages: ['grass', 'bug', 'ice'],
    damage_from_score: 19.5,
    damage_to_score: 20
  },
  levitate: {
    weaknesses: ['water', 'rock'],
    quadruple_weaknesses: [],
    resistances: ['fire', 'grass', 'bug', 'ground'],
    immunities: ['ground'],
    coverages: ['grass', 'bug', 'ice'],
    damage_from_score: 17.5,
    damage_to_score: 20
  }
};

const pokemon = (name: string, overrides: Partial<PokemonEntry> = {}): PokemonEntry => ({
  name,
  speciesName: name,
  typeName: 'fire',
  types: ['fire'],
  sprite: `${name}.png`,
  stats,
  baseStats: stats,
  statsTotal: 534,
  abilities: [
    { name: 'blaze', is_hidden: false },
    { name: 'levitate', is_hidden: true }
  ],
  abilityName: 'levitate',
  abilityProfiles,
  weaknesses: ['water', 'rock'],
  quadrupleWeaknesses: [],
  resistances: ['fire', 'grass', 'bug', 'ground'],
  immunities: ['ground'],
  coverages: ['grass', 'bug', 'ice'],
  moveCoverages: [],
  normalizedDamageToScore: 0.5,
  normalizedDamageFromScore: 0.5,
  ...overrides
});

/** Registers `count` distinct Pokemon, each with its own typing. */
const fillRoster = (add: (entry: PokemonEntry) => boolean, count: number) => {
  ['fire', 'water', 'grass', 'electric', 'ice', 'rock', 'dark'].slice(0, count).forEach((type, index) => {
    add(pokemon(`mon-${index}`, { typeName: type, types: [type] }));
  });
};

describe('useTeamBuilder', () => {
  const builder = useTeamBuilder();
  const {
    addPokemon,
    clearGenerationExclusions,
    clearParty,
    roster,
    setFormat,
    teamWeaknessSummary
  } = builder;
  const { notifications } = useNotifications();

  beforeEach(() => {
    clearParty();
    clearGenerationExclusions();
    setFormat('doubles');
  });

  it('applies the chosen ability when registering a Pokemon', () => {
    addPokemon(pokemon('charizard'), 'blaze');

    expect(roster.value).toHaveLength(1);
    expect(roster.value[0].abilityName).toBe('blaze');
    // The defensive profile follows the ability, not just the label.
    expect(roster.value[0].weaknesses).toEqual(['water', 'rock', 'ground']);
    expect(roster.value[0].immunities).toEqual([]);
  });

  it('keeps the scan-selected ability when none is given', () => {
    addPokemon(pokemon('charizard'));

    expect(roster.value[0].abilityName).toBe('levitate');
    expect(roster.value[0].immunities).toEqual(['ground']);
  });

  it('reports no battle analysis until a full bring is selected', () => {
    // Doubles brings four. One registered Pokemon cannot field a team.
    addPokemon(pokemon('charizard'));

    expect(builder.bringIndices.value).toEqual([]);
    expect(teamWeaknessSummary.value).toEqual({});
  });

  it('analyses the brought team once the roster can field one', () => {
    ['fire', 'water', 'grass', 'electric'].forEach((type, index) => {
      addPokemon(pokemon(`mon-${index}`, { typeName: type, types: [type] }), 'blaze');
    });

    expect(builder.bringIndices.value).toHaveLength(4);
    // Every member shares the blaze profile, so nothing resists their weaknesses.
    expect(teamWeaknessSummary.value).toEqual({ water: 4, rock: 4, ground: 4 });
  });

  it('accepts two Pokemon sharing a typing', () => {
    // A typing groups Pokemon; it is not an identity.
    addPokemon(pokemon('pelipper', { typeName: 'water/flying', types: ['water', 'flying'] }));
    addPokemon(pokemon('gyarados', { typeName: 'water/flying', types: ['water', 'flying'] }));

    expect(roster.value.map((member) => member.name)).toEqual(['pelipper', 'gyarados']);
  });

  it('refuses the same species twice', () => {
    addPokemon(pokemon('charizard'));
    const added = addPokemon(pokemon('charizard-mega-x', { speciesName: 'charizard' }));

    expect(added).toBe(false);
    expect(roster.value).toHaveLength(1);
  });

  it('refuses two forms of one species even when their typings differ', () => {
    // Rotom's appliance forms each carry their own secondary type, so nothing
    // about the typing stops them sharing a roster. They are one Pokedex number,
    // and that is what the duplicate rule is about.
    addPokemon(pokemon('rotom-wash', {
      speciesName: 'rotom', typeName: 'electric/water', types: ['electric', 'water']
    }));
    const added = addPokemon(pokemon('rotom-fan', {
      speciesName: 'rotom', typeName: 'electric/flying', types: ['electric', 'flying']
    }));

    expect(added).toBe(false);
    expect(roster.value.map((member) => member.name)).toEqual(['rotom-wash']);
  });

  it('registers up to six and brings only four in doubles', () => {
    fillRoster(addPokemon, 6);

    expect(roster.value).toHaveLength(6);
    expect(builder.bringIndices.value).toHaveLength(4);
    expect(builder.rosterEvaluation.value.optionCount).toBe(15);
  });

  it('refuses a seventh roster entry', () => {
    fillRoster(addPokemon, 7);

    expect(roster.value).toHaveLength(6);
  });

  it('brings three in singles from the same roster', () => {
    fillRoster(addPokemon, 6);
    setFormat('singles');

    expect(roster.value).toHaveLength(6);
    expect(builder.bringIndices.value).toHaveLength(3);
    expect(builder.rosterEvaluation.value.optionCount).toBe(20);
  });

  it('lets the user override the suggested bring', () => {
    fillRoster(addPokemon, 5);

    expect(builder.isSuggestedBring.value).toBe(true);
    builder.toggleBring(0);
    builder.toggleBring(1);

    expect(builder.isSuggestedBring.value).toBe(false);
    builder.useSuggestedBring();
    expect(builder.isSuggestedBring.value).toBe(true);
  });

  it('refuses to bring more than the format allows', () => {
    fillRoster(addPokemon, 5);

    builder.useSuggestedBring();
    const suggested = [...builder.bringIndices.value];
    const benched = [0, 1, 2, 3, 4].find((index) => !suggested.includes(index))!;
    builder.toggleBring(benched);

    expect(builder.bringIndices.value).toHaveLength(4);
    expect(builder.bringIndices.value).not.toContain(benched);
  });

  it('drops a manual bring when the format changes', () => {
    fillRoster(addPokemon, 5);
    builder.toggleBring(0);
    expect(builder.isSuggestedBring.value).toBe(false);

    setFormat('singles');

    // A bring sized for doubles says nothing about which three to bring.
    expect(builder.isSuggestedBring.value).toBe(true);
    expect(builder.bringIndices.value).toHaveLength(3);
  });

  it('cycles through the roster distinct lines and wraps', () => {
    fillRoster(addPokemon, 6);

    const lines = builder.bringLines.value;
    expect(lines.length).toBe(builder.rosterEvaluation.value.targetLines);
    expect(builder.currentLineIndex.value).toBe(0);

    builder.cycleBringLine(1);
    expect(builder.currentLineIndex.value).toBe(1);
    expect(builder.bringIndices.value).toHaveLength(4);

    // Wrapping forward from the last line lands back on the best one, which is
    // the suggestion rather than a manual pick of the same indices.
    builder.cycleBringLine(lines.length - 1);
    expect(builder.currentLineIndex.value).toBe(0);
    expect(builder.isSuggestedBring.value).toBe(true);

    builder.cycleBringLine(-1);
    expect(builder.currentLineIndex.value).toBe(lines.length - 1);
  });

  it('steps onto the best line from a bring that is not one', () => {
    fillRoster(addPokemon, 6);

    // Move the bring to a specific set, one member at a time so the format's
    // size cap is never exceeded mid-way.
    const setBring = (target: number[]) => {
      [...builder.bringIndices.value]
        .filter((index) => !target.includes(index))
        .forEach(builder.toggleBring);
      target
        .filter((index) => !builder.bringIndices.value.includes(index))
        .forEach(builder.toggleBring);
    };

    const isLine = (indices: number[]) => builder.bringLines.value.some((line) =>
      line.indices.length === indices.length && line.indices.every((i) => indices.includes(i))
    );
    const offLine = builder.rosterEvaluation.value.bringOptions
      .map((option) => option.indices)
      .find((indices) => !isLine(indices));

    // With six registered there are fifteen bring-fours and only three lines, so
    // this always exists; asserted rather than assumed.
    expect(offLine).toBeDefined();
    setBring(offLine!);
    expect(builder.currentLineIndex.value).toBe(-1);

    builder.cycleBringLine(1);
    expect(builder.currentLineIndex.value).toBe(0);

    setBring(offLine!);
    builder.cycleBringLine(-1);
    expect(builder.currentLineIndex.value).toBe(builder.bringLines.value.length - 1);
  });

  it('scores the bring on the field, and every line', () => {
    fillRoster(addPokemon, 6);

    expect(builder.currentBringScore.value).toBe(builder.rosterEvaluation.value.best!.score);

    builder.cycleBringLine(1);
    expect(builder.currentBringScore.value).toBe(builder.bringLines.value[1].score);
    // Line 1 is the best by construction, so nothing behind it can beat it.
    expect(builder.currentBringScore.value).toBeLessThanOrEqual(
      builder.rosterEvaluation.value.best!.score
    );
  });

  // `(from + step + length) % length` normalizes exactly one wrap, so a step
  // past that produced a negative index and threw on `lines[next].indices`.
  // The workbench only passes ±1, but this is exported from the composable.
  it('cycles by any step, not just one', () => {
    fillRoster(addPokemon, 6);
    const lines = builder.bringLines.value;

    expect(() => builder.cycleBringLine(-(lines.length * 2 + 1))).not.toThrow();
    expect(builder.currentLineIndex.value).toBe(lines.length - 1);

    expect(() => builder.cycleBringLine(lines.length * 3 + 2)).not.toThrow();
    expect(builder.currentLineIndex.value).toBe(1);

    // A step of zero holds position rather than moving.
    builder.cycleBringLine(0);
    expect(builder.currentLineIndex.value).toBe(1);
  });

  it('ignores non-integer steps from public callers', () => {
    fillRoster(addPokemon, 6);
    const originalBring = [...builder.bringIndices.value];

    expect(() => builder.cycleBringLine(0.5)).not.toThrow();
    expect(() => builder.cycleBringLine(Number.NaN)).not.toThrow();
    expect(builder.bringIndices.value).toEqual(originalBring);
    expect(builder.currentLineIndex.value).toBe(0);
  });

  it('has nothing to cycle before a bring can be fielded', () => {
    fillRoster(addPokemon, 3);

    expect(builder.bringLines.value).toEqual([]);
    expect(builder.currentLineIndex.value).toBe(-1);
    expect(() => builder.cycleBringLine(1)).not.toThrow();
  });

  describe('fillRemainingSlots', () => {
    const scanOf = (types: string[]) =>
      types.map((type, index) => pokemon(`mon-${index}`, { typeName: type, types: [type] }));

    it('cycles through meaningfully different alternatives after fresh generation', () => {
      const scan = scanOf([
        'fire', 'water', 'grass', 'electric', 'ice', 'rock', 'dark', 'steel', 'psychic', 'flying'
      ]);

      builder.generateFullTeam(scan);
      const first = new Set(roster.value.map((member) => member.name));

      expect(builder.canTryAnotherRoster.value).toBe(true);
      expect(builder.generationAlternative.value).toMatchObject({
        optionNumber: 1,
        scoreBehindBest: 0,
        removedNames: [],
        addedNames: []
      });
      builder.fillRemainingSlots(scan, scan);

      const replacements = roster.value.filter((member) => !first.has(member.name));
      expect(replacements.length).toBeGreaterThanOrEqual(2);
      expect(builder.generationAlternative.value).toMatchObject({
        optionNumber: 2,
        removedNames: expect.arrayContaining([...first].filter((name) =>
          !roster.value.some((member) => member.name === name))),
        addedNames: expect.arrayContaining(replacements.map((member) => member.name))
      });
      expect(builder.generationAlternative.value!.scoreBehindBest).toBeGreaterThanOrEqual(0);
      expect(builder.generationAlternative.value!.scoreBehindBest).toBeLessThanOrEqual(3);
    });

    it('keeps the registered members and adds to them', () => {
      fillRoster(addPokemon, 3);
      const scan = scanOf(['fire', 'water', 'grass', 'electric', 'ice', 'rock']);

      builder.fillRemainingSlots(scan, scan);

      expect(roster.value).toHaveLength(6);
      expect(roster.value.map((member) => member.name)).toEqual(
        expect.arrayContaining(['mon-0', 'mon-1', 'mon-2'])
      );
    });

    it('cycles through every completion within the score threshold', () => {
      fillRoster(addPokemon, 3);
      const locked = roster.value.map((member) => member.name);
      const scan = scanOf([
        'fire', 'water', 'grass', 'electric', 'ice', 'rock', 'dark', 'steel', 'psychic', 'flying'
      ]);

      const completions = new Set<string>();
      for (let option = 0; option < 6; option++) {
        builder.fillRemainingSlots(scan, scan);
        completions.add(roster.value.map((member) => member.name).sort().join('|'));
      }

      expect(completions.size).toBe(6);
      expect(roster.value.map((member) => member.name)).toEqual(expect.arrayContaining(locked));
      expect(builder.canTryAnotherRoster.value).toBe(true);
    });

    it('does not offer another roster when only one completion qualifies', () => {
      fillRoster(addPokemon, 3);
      const scan = scanOf(['fire', 'water', 'grass', 'electric', 'ice', 'rock']);

      builder.fillRemainingSlots(scan, scan);

      expect(builder.canTryAnotherRoster.value).toBe(false);
    });

    /**
     * This assertion used to be a coin flip and is now decided by 0.33 points.
     *
     * `mon-7` is one in every stat. The best roster containing it scored, across
     * four consecutive recalibrations, **3.010** points behind the best, then
     * **2.950**, **3.072** and **2.967** — against a
     * ROSTER_ALTERNATIVE_SCORE_MARGIN that was 3. So this passed, failed, passed
     * and failed again while nothing changed about how bad `mon-7` is.
     *
     * The reason it sat on the line is structural. Six are registered and four
     * brought, so the worst member is never brought and reaches the score only
     * through the brings it would spoil; setting `normalizedDamageFromScore` to
     * 1 rather than 0 — worst defensive typing instead of best — moves the gap
     * by exactly nothing. Roughly three points is simply what a wasted sixth
     * slot can cost, so a margin of 3 could never exclude one.
     *
     * The margin is now derived rather than assumed: one member's worth of
     * roster quality, re-measured at 2.63 as the candidate pool grew. The gap
     * here measures 2.963 today, inside the same band as all four earlier
     * readings, so the exclusion holds for a stated reason instead of by luck —
     * but by 0.33 rather than the 0.84 it had at 2.13. The two quantities are
     * converging, and why that is expected is argued on
     * ROSTER_ALTERNATIVE_SCORE_MARGIN. If this test starts flipping again, that
     * docblock is the thing to read, not this one.
     */
    it('does not cycle into completions a member downgrade behind the best', () => {
      fillRoster(addPokemon, 3);
      const scan = scanOf(['fire', 'water', 'grass', 'electric', 'ice', 'rock', 'dark', 'steel']);
      const weakStats = {
        hp: 1, attack: 1, defense: 1, 'special-attack': 1, 'special-defense': 1, speed: 1
      };
      scan[7] = pokemon('mon-7', {
        typeName: 'steel',
        types: ['steel'],
        stats: weakStats,
        baseStats: weakStats,
        statsTotal: 6,
        normalizedDamageToScore: 0,
        normalizedDamageFromScore: 0
      });

      for (let option = 0; option < 8; option++) {
        builder.fillRemainingSlots(scan, scan);
        expect(roster.value.map((member) => member.name)).not.toContain('mon-7');
      }
    });

    it('preserves a locked member selected ability across alternatives', () => {
      addPokemon(pokemon('mon-0'), 'blaze');
      addPokemon(pokemon('mon-1', { typeName: 'water', types: ['water'] }));
      addPokemon(pokemon('mon-2', { typeName: 'grass', types: ['grass'] }));
      const scan = scanOf([
        'fire', 'water', 'grass', 'electric', 'ice', 'rock', 'dark', 'steel', 'psychic', 'flying'
      ]);

      builder.fillRemainingSlots(scan, scan);
      builder.fillRemainingSlots(scan, scan);

      const locked = roster.value.find((member) => member.name === 'mon-0');
      expect(locked?.abilityName).toBe('blaze');
      expect(locked?.weaknesses).toEqual(['water', 'rock', 'ground']);
      expect(locked?.immunities).toEqual([]);
    });

    // The seed used to drop anything the scan could not resolve, and
    // runGeneration replaces roster.value wholesale — so a member this function
    // documents as kept was quietly swapped for whatever the search preferred.
    it('refuses rather than dropping a member the scan no longer holds', () => {
      fillRoster(addPokemon, 3);
      const before = roster.value.map((member) => member.name);

      // A rescan under a different regulation is enough to lose mon-0. The rest
      // of the scan is wide enough to fill a roster of six without it, so the
      // unguarded path really does overwrite mon-0 rather than merely failing.
      const scan = scanOf(['fire', 'water', 'grass', 'electric', 'ice', 'rock', 'dark'])
        .filter((entry) => entry.name !== 'mon-0');

      builder.fillRemainingSlots(scan, scan);

      expect(roster.value.map((member) => member.name)).toEqual(before);
      expect(notifications.value[notifications.value.length - 1]).toMatchObject({
        type: 'error',
        message: expect.stringContaining('mon-0')
      });
    });
  });

  describe('generation exclusions', () => {
    const scanOf = (types: string[]) =>
      types.map((type, index) => pokemon(`mon-${index}`, { typeName: type, types: [type] }));

    it('toggles a Pokemon form in the generation pool', () => {
      expect(builder.isExcludedFromGeneration('feraligatr')).toBe(false);

      builder.toggleGenerationExclusion('feraligatr');

      expect(builder.isExcludedFromGeneration('feraligatr')).toBe(true);
      expect(builder.excludedPokemonNames.value).toEqual(['feraligatr']);

      builder.toggleGenerationExclusion('feraligatr');
      expect(builder.isExcludedFromGeneration('feraligatr')).toBe(false);
    });

    it('keeps excluded Pokemon out of a generated roster', () => {
      const scan = scanOf(['fire', 'water', 'grass', 'electric', 'ice', 'rock', 'dark']);
      builder.toggleGenerationExclusion('mon-0');

      builder.generateFullTeam(scan);

      expect(roster.value).toHaveLength(6);
      expect(roster.value.map((member) => member.name)).not.toContain('mon-0');
    });

    it('keeps an excluded registered Pokemon while filling around it', () => {
      const scan = scanOf(['fire', 'water', 'grass', 'electric', 'ice', 'rock', 'dark']);
      addPokemon(scan[0]);
      addPokemon(scan[1]);
      addPokemon(scan[2]);
      builder.toggleGenerationExclusion('mon-0');
      builder.toggleGenerationExclusion('mon-6');

      builder.fillRemainingSlots(scan, scan);

      expect(roster.value.map((member) => member.name)).toContain('mon-0');
      expect(roster.value.map((member) => member.name)).not.toContain('mon-6');
    });

    it('can replace a generated Pokemon immediately after excluding it', () => {
      const scan = scanOf([
        'fire', 'water', 'grass', 'electric', 'ice', 'rock', 'dark', 'steel', 'psychic', 'flying'
      ]);
      addPokemon(scan[0]);
      addPokemon(scan[1]);
      addPokemon(scan[2]);
      const locked = roster.value.map((member) => member.name);
      builder.fillRemainingSlots(scan, scan);
      const generated = roster.value.find((member) => !locked.includes(member.name))!;

      builder.toggleGenerationExclusion(generated.name);

      expect(builder.canTryAnotherRoster.value).toBe(true);
      builder.fillRemainingSlots(scan, scan);
      expect(roster.value.map((member) => member.name)).toEqual(expect.arrayContaining(locked));
      expect(roster.value.map((member) => member.name)).not.toContain(generated.name);
    });
  });

  describe('workspace state', () => {
    it('distinguishes bring edits from roster membership edits', () => {
      fillRoster(addPokemon, 4);
      const teamRevision = builder.teamEditRevision.value;
      const rosterRevision = builder.rosterEditRevision.value;

      builder.toggleBring(builder.bringIndices.value[0]);

      expect(builder.teamEditRevision.value).toBe(teamRevision + 1);
      expect(builder.rosterEditRevision.value).toBe(rosterRevision);

      addPokemon(pokemon('fifth', { typeName: 'dark', types: ['dark'] }));
      expect(builder.rosterEditRevision.value).toBe(rosterRevision + 1);
    });

    it('atomically restores and snapshots identifiers and user choices', () => {
      const scan = [
        pokemon('charizard', { typeName: 'fire', types: ['fire'] }),
        pokemon('blastoise', { typeName: 'water', types: ['water'] }),
        pokemon('venusaur', { typeName: 'grass', types: ['grass'] })
      ];

      const result = builder.restoreTeam({
        format: 'singles',
        roster: [
          { pokemon: 'charizard', ability: 'blaze' },
          { pokemon: 'blastoise', ability: 'levitate' },
          { pokemon: 'venusaur', ability: null }
        ],
        bring: ['charizard', 'venusaur'],
        excluded: ['incineroar']
      }, scan);

      expect(result).toEqual({ unavailablePokemon: [], unavailableAbilities: [] });
      expect(roster.value.map((member) => member.abilityName)).toEqual(['blaze', 'levitate', 'levitate']);
      expect(builder.snapshotTeam()).toEqual({
        format: 'singles',
        roster: [
          { pokemon: 'charizard', ability: 'blaze' },
          { pokemon: 'blastoise', ability: 'levitate' },
          { pokemon: 'venusaur', ability: 'levitate' }
        ],
        bring: ['charizard', 'venusaur'],
        excluded: ['incineroar']
      });
    });

    it('reports unavailable Pokemon and abilities rather than substituting them', () => {
      const result = builder.restoreTeam({
        format: 'doubles',
        roster: [
          { pokemon: 'charizard', ability: 'missing-ability' },
          { pokemon: 'missing-pokemon', ability: null }
        ],
        bring: null,
        excluded: []
      }, [pokemon('charizard')]);

      expect(roster.value.map((member) => member.name)).toEqual(['charizard']);
      expect(roster.value[0].abilityName).toBe('levitate');
      expect(result).toEqual({
        unavailablePokemon: ['missing-pokemon'],
        unavailableAbilities: ['charizard: missing-ability']
      });
    });
  });

  describe('scan reconciliation', () => {
    it('refreshes registered Pokemon from the latest scan while preserving their ability', () => {
      addPokemon(pokemon('charizard'), 'blaze');
      const refreshedStats = { ...stats, attack: 120 };

      builder.reconcileRoster([
        pokemon('charizard', { stats: refreshedStats, baseStats: refreshedStats })
      ]);

      expect(roster.value[0].abilityName).toBe('blaze');
      expect(roster.value[0].stats.attack).toBe(120);
      expect(builder.unavailableRosterNames.value).toEqual([]);
    });

    it('retains unavailable registrations but suspends their scoring and analysis', () => {
      const scan = ['fire', 'water', 'grass', 'electric'].map((type, index) =>
        pokemon(`mon-${index}`, { typeName: type, types: [type] })
      );
      scan.forEach((entry) => addPokemon(entry));
      expect(builder.rosterEvaluation.value.best).not.toBeNull();

      builder.reconcileRoster(scan.slice(0, 3));

      expect(roster.value.map((member) => member.name)).toEqual(scan.map((entry) => entry.name));
      expect(builder.unavailableRosterNames.value).toEqual(['mon-3']);
      expect(builder.rosterEvaluation.value.best).toBeNull();
      expect(builder.bringIndices.value).toEqual([]);
      expect(builder.teamWeaknessSummary.value).toEqual({});
    });

    it('resumes scoring when a later scan contains every registration again', () => {
      const scan = ['fire', 'water', 'grass', 'electric'].map((type, index) =>
        pokemon(`mon-${index}`, { typeName: type, types: [type] })
      );
      scan.forEach((entry) => addPokemon(entry));
      builder.reconcileRoster(scan.slice(0, 3));

      builder.reconcileRoster(scan);

      expect(builder.unavailableRosterNames.value).toEqual([]);
      expect(builder.rosterEvaluation.value.best).not.toBeNull();
      expect(builder.bringIndices.value).toHaveLength(4);
    });
  });

  it('reports whether a species is already registered', () => {
    expect(builder.hasSpecies('charizard')).toBe(false);
    addPokemon(pokemon('charizard'));
    expect(builder.hasSpecies('charizard')).toBe(true);
  });

  // The roster generator has always scored quadruple weaknesses, but the
  // workbench dropped them: PartyMember never carried the field, so every
  // member reached analyzeTeamCoverage with none. The same roster scored
  // differently depending on which path evaluated it, and the shared-4x signal
  // — three separate penalty terms in scoreTeamSynergy — never fired here.
  it('scores the roster against its quadruple weaknesses', () => {
    const quadRoster = (quad: string[]) => {
      clearParty();
      ['fire', 'water', 'grass', 'electric'].forEach((type, index) => {
        addPokemon(pokemon(`mon-${index}`, {
          typeName: type,
          types: [type],
          weaknesses: ['ice'],
          quadrupleWeaknesses: quad
        }));
      });
      return builder.rosterEvaluation.value.best!.score;
    };

    // Identical teams but for the 4x flag, so nothing else can explain the gap.
    expect(quadRoster(['ice'])).toBeLessThan(quadRoster([]));
  });

  it('carries quadruple weaknesses onto the registered member', () => {
    addPokemon(pokemon('charizard', { quadrupleWeaknesses: ['rock'] }));

    expect(roster.value[0].quadrupleWeaknesses).toEqual(['rock']);
  });
});
