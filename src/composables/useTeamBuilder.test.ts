import { beforeEach, describe, expect, it } from 'vitest';
import { useTeamBuilder } from './useTeamBuilder';
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
  const { addPokemon, clearParty, roster, setFormat, teamWeaknessSummary } = builder;

  beforeEach(() => {
    clearParty();
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

  it('has nothing to cycle before a bring can be fielded', () => {
    fillRoster(addPokemon, 3);

    expect(builder.bringLines.value).toEqual([]);
    expect(builder.currentLineIndex.value).toBe(-1);
    expect(() => builder.cycleBringLine(1)).not.toThrow();
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
