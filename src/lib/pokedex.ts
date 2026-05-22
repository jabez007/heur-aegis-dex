//https://pokeapi.co/
import Pokedex from 'pokedex-promise-v2';
import 'lodash.combinations';
import _ from 'lodash';

const _lodash = _ as any;
const BASESCORE = 18

export const pokedex = new Pokedex({
    protocol: 'https',
    timeout: 1000 * 20, // 20s
    cacheLimit: 1000 * 60 * 60 * 24 * 7, // 1wk
});

// --- Interfaces ---

export interface NamedResource {
    name: string;
    url?: string;
}

export interface DamageRelations {
    double_damage_from: NamedResource[];
    half_damage_from: NamedResource[];
    no_damage_from: NamedResource[];
    double_damage_to: NamedResource[];
    half_damage_to: NamedResource[];
    no_damage_to: NamedResource[];
    quadruple_damage_from?: NamedResource[];
    quarter_damage_from?: NamedResource[];
    damage_from_score?: number;
    damage_to_score?: number;
}

export interface PokemonTypeData {
    id?: number;
    name: string;
    damage_relations: DamageRelations;
    pokemon?: any[];
    weaknesses?: string[];
    resistances?: string[];
    ineffectives?: string[];
    coverages?: string[];
    damage_from_score?: number;
    damage_to_score?: number;
}

// --- Helper Functions ---

const calculateDamageFromScore = (dr: DamageRelations, baseScore: number): number => {
    let score = baseScore;
    if (dr.quadruple_damage_from) score += (3 * dr.quadruple_damage_from.length);
    score += dr.double_damage_from.length;
    score -= (0.5 * dr.half_damage_from.length);
    if (dr.quarter_damage_from) score -= (0.75 * dr.quarter_damage_from.length);
    score -= dr.no_damage_from.length;
    return score;
}

const calculateDamageToScore = (dr: DamageRelations, baseScore: number): number => {
    return baseScore
        + dr.double_damage_to.length
        - (0.5 * dr.half_damage_to.length)
        - dr.no_damage_to.length;
}

const filterUniqueBy = (arr: NamedResource[]): NamedResource[] => {
    return arr.filter(function(this: Set<string>, {name}: NamedResource) { return !this.has(name) && this.add(name) }, new Set<string>());
}

// --- Main Exports ---

export async function getBaseTypes(baseScore: number = BASESCORE): Promise<PokemonTypeData[]> {
    const types: PokemonTypeData[] = await Promise.all(
        (await pokedex.getResource(`/api/v2/type/`)).results
            .map((type: NamedResource) => pokedex.getResource(`/api/v2/type/${type.name}/`))
    )

    return types
        .filter(t => (t.id || 0) <= baseScore)
        .map(t => {
            t.damage_relations.damage_from_score = calculateDamageFromScore(t.damage_relations, baseScore);
            t.damage_relations.damage_to_score = calculateDamageToScore(t.damage_relations, baseScore);
            return t;
        })
}

export async function getDualTypes(baseScore: number = BASESCORE): Promise<PokemonTypeData[]> {
    const baseTypes = await getBaseTypes(baseScore);
    
    return _lodash.combinations(baseTypes, 2)
        .map((dt: PokemonTypeData[]) => {
            const dr0 = dt[0].damage_relations;
            const dr1 = dt[1].damage_relations;

            const _dt: PokemonTypeData = {
                name: `${dt[0].name}/${dt[1].name}`,
                damage_relations: {
                    quadruple_damage_from: dr0.double_damage_from
                        .filter(dt0_ddf => dr1.double_damage_from.some(dt1_ddf => dt0_ddf.name === dt1_ddf.name)),
                    
                    double_damage_from: filterUniqueBy(dr0.double_damage_from.concat(dr1.double_damage_from))
                        .filter(ddf =>
                            (dr0.double_damage_from.every(dt0_ddf => ddf.name !== dt0_ddf.name) ||
                             dr1.double_damage_from.every(dt1_ddf => ddf.name !== dt1_ddf.name))
                            &&
                            (dr0.half_damage_from.every(dt0_hdf => ddf.name !== dt0_hdf.name) &&
                             dr1.half_damage_from.every(dt1_hdf => ddf.name !== dt1_hdf.name) &&
                             dr0.no_damage_from.every(dt0_ndf => ddf.name !== dt0_ndf.name) &&
                             dr1.no_damage_from.every(dt1_ndf => ddf.name !== dt1_ndf.name))
                        ),

                    double_damage_to: filterUniqueBy(dr0.double_damage_to.concat(dr1.double_damage_to)),

                    half_damage_from: filterUniqueBy(dr0.half_damage_from.concat(dr1.half_damage_from))
                        .filter(hdf =>
                            (dr0.half_damage_from.every(dt0_hdf => hdf.name !== dt0_hdf.name) ||
                             dr1.half_damage_from.every(dt1_hdf => hdf.name !== dt1_hdf.name))
                            &&
                            (dr0.double_damage_from.every(dt0_ddf => hdf.name !== dt0_ddf.name) &&
                             dr1.double_damage_from.every(dt1_ddf => hdf.name !== dt1_ddf.name) &&
                             dr0.no_damage_from.every(dt0_ndf => hdf.name !== dt0_ndf.name) &&
                             dr1.no_damage_from.every(dt1_ndf => hdf.name !== dt1_ndf.name))
                        ),

                    half_damage_to: dr0.half_damage_to
                        .filter(dt0_hdt =>
                            dr1.half_damage_to.some(dt1_hdt => dt0_hdt.name === dt1_hdt.name) ||
                            dr1.no_damage_to.some(dt1_ndt => dt0_hdt.name === dt1_ndt.name)
                        )
                        .concat(dr1.half_damage_to.filter(dt1_hdt =>
                            dr0.no_damage_to.some(dt0_ndt => dt1_hdt.name === dt0_ndt.name)
                        )),

                    quarter_damage_from: dr0.half_damage_from
                        .filter(dt0_hdf => dr1.half_damage_from.some(dt1_hdf => dt0_hdf.name === dt1_hdf.name)),

                    no_damage_from: filterUniqueBy(dr0.no_damage_from.concat(dr1.no_damage_from)),

                    no_damage_to: dr0.no_damage_to
                        .filter(dt0_ndt => dr1.no_damage_to.some(dt1_ndt => dt0_ndt.name === dt1_ndt.name))
                },
                pokemon: (dt[0].pokemon || [])
                    .filter((dt0_p: any) =>
                        (dt[1].pokemon || []).some((dt1_p: any) => dt0_p.pokemon.name === dt1_p.pokemon.name)
                    )
            }

            _dt.damage_relations.damage_from_score = calculateDamageFromScore(_dt.damage_relations, baseScore);
            _dt.damage_relations.damage_to_score = calculateDamageToScore(_dt.damage_relations, baseScore);
            
            return _dt
        })
}

export async function getResistantTypes(options: any = {}): Promise<any[]> {
    const {
        baseScore = BASESCORE,
        typeFilters = { maxDamageFromScore: true, allowQuadrupleDamage: true, limitQuadrupleDamage: true },
        pokemonFilters = { inPokedex: 'national', allowMegas: false },
        statsFilters = { minimumStatsTotal: 500, minimumAttacks: 90, minimumDefenses: 80 }
    } = options;

    const _typeFilters = { maxDamageFromScore: true, allowQuadrupleDamage: true, limitQuadrupleDamage: true, ...typeFilters }
    const _pokemonFilters = { inPokedex: 'national', allowMegas: false, ...pokemonFilters }
    const _statsFilters = { minimumStatsTotal: 480, minimumAttacks: 80, minimumDefenses: 80, ...statsFilters }

    const pokedexMaps: Record<string, string[]> = {
        'national': ['national'],
        'kanto': ['letsgo-kanto'],
        'galar': ['galar', 'isle-of-armor', 'crown-tundra'],
        'sinnoh': ['sinnoh'],
        'hisui': ['hisui'],
        'paldea': ['paldea', 'kitakami', 'blueberry']
    }
    
    const isBreedable = (species: any, pokeName: string) => {
        if (species.is_legendary || species.is_mythical) return false;
        if (species.egg_groups.length > 0 && species.egg_groups.every((eg: any) => eg.name === 'no-eggs')) return false;
        const paradoxPokemon = ['koraidon', 'miraidon', 'roaring-moon', 'iron-valiant', 'great-tusk', 'brute-bonnet', 'sandy-shocks', 'scream-tail', 'flutter-mane', 'slither-wing', 'iron-treads', 'iron-moth', 'iron-hands', 'iron-jugulis', 'iron-thorns', 'iron-bundle', 'ting-lu', 'chien-pao', 'wo-chien', 'chi-yu', 'gholdengo'];
        if (paradoxPokemon.includes(pokeName)) return false;
        return true;
    };

    const processPokemon = async (t: PokemonTypeData) => {
        const _pokemon = await Promise.all(
            (t.pokemon || []).map(async (p: any) => {
                if (!_pokemonFilters.allowMegas && p.pokemon.name.includes('-mega')) return null;
                
                const id = Number(p.pokemon.url.split("/").slice(-2)[0]);
                const poke = await pokedex.getResource(`/api/v2/pokemon/${id}/`);
                const speciesId = Number(poke.species.url.split("/").slice(-2)[0]);
                const species = await pokedex.getResource(`/api/v2/pokemon-species/${speciesId}/`);
                
                if (!isBreedable(species, p.pokemon.name)) return null;
                
                if (!species.pokedex_numbers.some((pn: any) => 
                    (pokedexMaps[_pokemonFilters.inPokedex] || []).some((pm: any) => pn.pokedex.name.includes(pm))
                )) {
                    return null;
                }
                
                p.types = poke.types;
                p.sprite = poke.sprites.front_default;
                p.stats = poke.stats.reduce((merged: any, curr: any) => {
                    merged[curr.stat.name] = curr.base_stat;
                    return merged;
                }, {});
                
                if (p.stats.attack < _statsFilters.minimumAttacks && p.stats['special-attack'] < _statsFilters.minimumAttacks) return null;
                if ((p.stats.defense + p.stats['special-defense']) / 2 < _statsFilters.minimumDefenses) return null;
                
                p.stats_total = poke.stats.reduce((total: number, curr: any) => total + curr.base_stat, 0);
                if (p.stats_total < _statsFilters.minimumStatsTotal) return null;
                
                return p;
            })
        );

        return _pokemon
            .filter((p: any) => !!p)
            .filter((p: any) => t.name.includes("/") || p.types.length === 1)
            .sort((p1: any, p2: any) => p2.stats_total - p1.stats_total);
    };

    const baseAndDualTypes = (await getBaseTypes(baseScore)).concat(await getDualTypes(baseScore));

    return (await Promise.all(
        baseAndDualTypes
            .filter((t: PokemonTypeData) => {
                const meetsScoreFilter = !_typeFilters.maxDamageFromScore || (t.damage_relations.damage_from_score || 0) <= baseScore;
                
                let meetsQuadFilter = true;
                if (_typeFilters.allowQuadrupleDamage) {
                    if (_typeFilters.limitQuadrupleDamage) {
                        const quadLen = (t.damage_relations.quadruple_damage_from || []).length;
                        const doubleLen = t.damage_relations.double_damage_from.length;
                        meetsQuadFilter = (quadLen === 1 && doubleLen === 0) || quadLen === 0;
                    }
                } else {
                    meetsQuadFilter = (t.damage_relations.quadruple_damage_from || []).length === 0;
                }
                
                return meetsScoreFilter && meetsQuadFilter;
            })
            .map(async (t: PokemonTypeData) => ({
                name: t.name,
                weaknesses: (t.damage_relations.quadruple_damage_from || [])
                    .concat(t.damage_relations.double_damage_from)
                    .map(w => w.name),
                quadruple_weaknesses: (t.damage_relations.quadruple_damage_from || []).map(w => w.name),
                resistances: t.damage_relations.no_damage_from
                    .concat(t.damage_relations.quarter_damage_from || [])
                    .concat(t.damage_relations.half_damage_from)
                    .map(r => r.name),
                damage_from_score: t.damage_relations.damage_from_score,
                ineffectives: t.damage_relations.no_damage_to
                    .concat(t.damage_relations.half_damage_to)
                    .map(i => i.name),
                coverages: t.damage_relations.double_damage_to.map(c => c.name),
                damage_to_score: t.damage_relations.damage_to_score,
                pokemon: await processPokemon(t)
            }))
    ))
        .sort((t1: any, t2: any) => {
            const t1Quotient = (t1.damage_from_score / t1.damage_to_score);
            const t2Quotient = (t2.damage_from_score / t2.damage_to_score);
            return t2Quotient === t1Quotient ? t1.damage_from_score - t2.damage_from_score : t1Quotient - t2Quotient;
        });
}

export function generateTeams(options: any = {}): any[] {
    const {
        allowedTypes = [],
        teamSize = 3,
        teamComposition = { allowSharedTypes: true, allowSharedWeaknesses: false, coverWeaknesses: true },
        seed = [] // Existing team members to build around
    } = options;

    const _teamComposition = {
        allowSharedTypes: true,
        allowSharedWeaknesses: false,
        coverWeaknesses: true,
        ...teamComposition
    }

    // Filter out empty pokemon lists just in case
    const validAllowedTypes = allowedTypes.filter((t: any) => t.pokemon && t.pokemon.length > 0);

    const damageScores: any = validAllowedTypes.reduce((acc: any, t: any) => ({
        to: [...(acc.to || []), t.damage_to_score],
        from: [...(acc.from || []), t.damage_from_score]
    }), {}) 
    
    const maxDamageToScore = Math.max(...(damageScores.to.filter((s: any) => s !== undefined) || [1]))
    const minDamageToScore = Math.min(...(damageScores.to.filter((s: any) => s !== undefined) || [0]))

    const maxDamageFromScore = Math.max(...(damageScores.from.filter((s: any) => s !== undefined) || [1]))
    const minDamageFromScore = Math.min(...(damageScores.from.filter((s: any) => s !== undefined) || [0]))

    const normalizedTypes = validAllowedTypes.map((t: any) => ({
        ...t,
        normalized_damage_from_score: (t.damage_from_score === undefined || maxDamageFromScore === minDamageFromScore) ? 0.5 :
            (t.damage_from_score - minDamageFromScore) / (maxDamageFromScore - minDamageFromScore),
        normalized_damage_to_score: (t.damage_to_score === undefined || maxDamageToScore === minDamageToScore) ? 0.5 :
            (t.damage_to_score - minDamageToScore) / (maxDamageToScore - minDamageToScore)
    }));

    function isCompatible(current: any, candidate: any): boolean {
        const passesSharedType = _teamComposition.allowSharedTypes || current.name.split("/").every((n: any) => !candidate.name.includes(n));
        const passesSharedWeakness = _teamComposition.allowSharedWeaknesses || 
            (current.weaknesses.every((w: any) => !candidate.weaknesses.includes(w)) && current.ineffectives.every((i: any) => !candidate.ineffectives.includes(i)));
        
        const passesCoverage = !_teamComposition.coverWeaknesses ||
            current.weaknesses.some((w: any) => candidate.coverages.includes(w) || candidate.resistances.includes(w)) ||
            candidate.coverages.some((c: any) => current.weaknesses.includes(c)) ||
            candidate.resistances.some((r: any) => current.weaknesses.includes(r));

        return passesSharedType && passesSharedWeakness && passesCoverage;
    }

    function teamCombinations(typs: any[], size: number, currentTeam: any[]): any[] {
        if (size === 0) return [currentTeam];
        if (typs.length === 0) return [];
        
        const first = typs[0];
        const rest = typs.slice(1);

        // Check if 'first' is compatible with all members currently in the team
        const canAddFirst = currentTeam.every(member => isCompatible(member, first));

        let results: any[] = [];
        if (canAddFirst) {
            results = results.concat(teamCombinations(rest, size - 1, [...currentTeam, first]));
        }
        results = results.concat(teamCombinations(rest, size, currentTeam));

        return results;
    }

    // Filter normalizedTypes to only those compatible with the seed
    const validSeed = seed.filter((s: any) => s.name && s.weaknesses && (s.selectedPokemon || (s.pokemon && s.pokemon.length > 0)));
    
    const seedCompatibleTypes = normalizedTypes.filter((t: any) => 
        !validSeed.some((s: any) => s.name === t.name) &&
        validSeed.every((s: any) => {
            return isCompatible(s, t);
        })
    );

    return teamCombinations(seedCompatibleTypes, teamSize - validSeed.length, validSeed)
        .map((tm: any) => {
            const pokemon = tm.map((t: any) => {
                const poke = t.selectedPokemon || (t.pokemon && t.pokemon[0]);
                return poke ? {
                    types: t.name.split("/"),
                    name: poke.pokemon.name,
                    sprite: poke.sprite,
                    stats: poke.stats,
                    normalized_damage_to_score: t.normalized_damage_to_score ?? 0,
                    normalized_damage_from_score: t.normalized_damage_from_score ?? 0
                } : null;
            }).filter((p: any) => p !== null);

            const weaknessCounts = tm.reduce((acc: Record<string, number>, t: any) => {
                (t.weaknesses || []).forEach((weakness: string) => {
                    acc[weakness] = (acc[weakness] || 0) + 1;
                });
                return acc;
            }, {});

            const resistanceCounts = tm.reduce((acc: Record<string, number>, t: any) => {
                (t.resistances || []).forEach((resistance: string) => {
                    acc[resistance] = (acc[resistance] || 0) + 1;
                });
                return acc;
            }, {});

            const coverageCounts = tm.reduce((acc: Record<string, number>, t: any) => {
                (t.coverages || []).forEach((coverage: string) => {
                    acc[coverage] = (acc[coverage] || 0) + 1;
                });
                return acc;
            }, {});

            const quadrupleWeaknessCounts = tm.reduce((acc: Record<string, number>, t: any) => {
                (t.quadruple_weaknesses || []).forEach((weakness: string) => {
                    acc[weakness] = (acc[weakness] || 0) + 1;
                });
                return acc;
            }, {});

            const uncoveredWeaknesses = Object.entries(weaknessCounts)
                .filter(([weakness]) => !resistanceCounts[weakness] && !coverageCounts[weakness])
                .map(([weakness]) => weakness);
            const uncoveredQuadrupleWeaknesses = Object.entries(quadrupleWeaknessCounts)
                .filter(([weakness]) => !resistanceCounts[weakness] && !coverageCounts[weakness])
                .map(([weakness]) => weakness);
            const sharedWeaknesses = Object.entries(weaknessCounts)
                .filter(([, count]) => count > 1)
                .map(([weakness]) => weakness);
            const sharedQuadrupleWeaknesses = Object.entries(quadrupleWeaknessCounts)
                .filter(([, count]) => count > 1)
                .map(([weakness]) => weakness);
            const uniqueResistances = Object.keys(resistanceCounts).length;
            const uniqueCoverages = Object.keys(coverageCounts).length;
            const typesTotal = (new Set(tm.flatMap((t: any) => t.name.split("/")))).size;

            const pokemonScore = tm.map((t: any) => {
                const poke = t.selectedPokemon || (t.pokemon && t.pokemon[0]);
                if (!poke) return 0;
                const offScore = t.normalized_damage_to_score ?? 0;
                const defScore = t.normalized_damage_from_score ?? 0;
                return poke.stats.hp +
                ((poke.stats.attack + poke.stats['special-attack']) * offScore) +
                ((poke.stats.defense + poke.stats['special-defense']) / (1 + defScore)) +
                poke.stats.speed;
            }).reduce((a: number, b: number) => a + b, 0);

            const teamSynergyScore =
                (uniqueCoverages * 20) +
                (uniqueResistances * 12) +
                (typesTotal * 10) -
                (uncoveredWeaknesses.length * 30) -
                (uncoveredQuadrupleWeaknesses.length * 90) -
                sharedWeaknesses.reduce((total, weakness) => total + ((weaknessCounts[weakness] - 1) * 18), 0) -
                Object.values(quadrupleWeaknessCounts).reduce((total, count) => total + (count * 80), 0) -
                sharedQuadrupleWeaknesses.reduce((total, weakness) => total + ((quadrupleWeaknessCounts[weakness] - 1) * 220), 0);

            return {
                types: tm.map((t: any) => t.name),
                typesTotal,
                pokemon,
                uncoveredWeaknesses,
                uncoveredQuadrupleWeaknesses,
                sharedWeaknesses,
                sharedQuadrupleWeaknesses,
                uniqueResistances,
                uniqueCoverages,
                score: pokemonScore + teamSynergyScore
            };
        })
        .filter((team: any) => team.pokemon.length === teamSize)
        .sort((t1: any, t2: any) => t2.score - t1.score);
}
