import { ref, computed } from 'vue';
import { generateTeams } from '../lib/pokedex';
import { useNotifications } from './useNotifications';

const { notify } = useNotifications();

export interface PartyMember {
  name: string;
  types: string[];
  sprite: string;
  stats: Record<string, number>;
  abilityName?: string;
  weaknesses: string[];
  resistances: string[];
  coverages: string[];
  typeName: string;
}

const currentParty = ref<PartyMember[]>([]);
const isGenerating = ref(false);

export function useTeamBuilder() {
  const resolveSelectedPokemon = (typeData: any, pokemonIndex: number, abilityName?: string) => {
    const selectedPokemon = typeData.selectedPokemon;
    const indexedPokemon = typeData.pokemon?.[pokemonIndex];
    const basePokemon = selectedPokemon?.pokemon?.name === indexedPokemon?.pokemon?.name
      ? selectedPokemon
      : (indexedPokemon || selectedPokemon);

    if (!basePokemon) return null;

    const nextAbilityName = abilityName || selectedPokemon?.selected_ability_name || basePokemon.selected_ability_name;
    const abilityProfile = nextAbilityName ? basePokemon.ability_profiles?.[nextAbilityName] : null;

    return {
      ...basePokemon,
      selected_ability_name: nextAbilityName,
      effective_weaknesses: abilityProfile?.weaknesses || selectedPokemon?.effective_weaknesses || basePokemon.effective_weaknesses || typeData.weaknesses || [],
      effective_resistances: abilityProfile?.resistances || selectedPokemon?.effective_resistances || basePokemon.effective_resistances || typeData.resistances || [],
      effective_coverages: abilityProfile?.coverages || selectedPokemon?.effective_coverages || basePokemon.effective_coverages || typeData.coverages || []
    };
  };

  const teamWeaknessSummary = computed(() => {
    const summary: Record<string, number> = {};
    currentParty.value.forEach(member => {
      member.weaknesses.forEach(w => {
        const covered = currentParty.value.some(m => m.resistances.includes(w));
        if (!covered) {
          summary[w] = (summary[w] || 0) + 1;
        }
      });
    });
    return summary;
  });

  const teamCoverageSummary = computed(() => {
    const summary: Record<string, number> = {};
    currentParty.value.forEach(member => {
      member.coverages.forEach(c => {
        summary[c] = (summary[c] || 0) + 1;
      });
    });
    return summary;
  });

  const addToParty = (typeData: any, pokemonIndex: number, abilityName?: string) => {
    if (currentParty.value.length >= 3) return;

    // Check if the same type combo is already in the party
    if (currentParty.value.some(member => member.typeName === typeData.name)) {
      notify(`A ${typeData.name.toUpperCase()} type is already in your party.`, "error");
      return;
    }
    
    const pokemon = resolveSelectedPokemon(typeData, pokemonIndex, abilityName);
    if (!pokemon) return;
    currentParty.value.push({
      name: pokemon.pokemon.name,
      types: pokemon.types.map((p: any) => p.type.name),
      sprite: pokemon.sprite,
      stats: pokemon.stats,
      abilityName: pokemon.selected_ability_name,
      weaknesses: pokemon.effective_weaknesses || typeData.weaknesses,
      resistances: pokemon.effective_resistances || typeData.resistances,
      coverages: pokemon.effective_coverages || typeData.coverages,
      typeName: typeData.name
    });
    notify(`Added ${pokemon.pokemon.name.toUpperCase()} to party.`, "success");
  };

  const removeFromParty = (index: number) => {
    currentParty.value.splice(index, 1);
  };

  const clearParty = () => {
    currentParty.value = [];
  };

  const generateFullTeam = (allowedTypes: any[]) => {
    isGenerating.value = true;
    try {
      const teams = generateTeams({
        allowedTypes: allowedTypes,
        teamSize: 3,
        seed: []
      });
      
      if (teams.length > 0) {
        const topTeam = teams[0];
        currentParty.value = topTeam.pokemon.map((p: any, idx: number) => {
            const typeData = allowedTypes.find(t => t.name === topTeam.types[idx]);
            if (!typeData) return null;
            return {
                name: p.name,
                types: p.types,
                sprite: p.sprite,
                stats: p.stats,
                abilityName: p.selected_ability_name,
                weaknesses: p.effective_weaknesses || typeData.weaknesses,
                resistances: p.effective_resistances || typeData.resistances,
                coverages: p.effective_coverages || typeData.coverages,
                typeName: typeData.name
            };
        }).filter((m: any): m is PartyMember => m !== null);
        notify("Generated optimal team based on meta.", "success");
      } else {
        notify("No valid teams found with current filters.", "error");
      }
    } catch (e: any) {
      notify(`Generation failed: ${e.message}`, "error");
    } finally {
      isGenerating.value = false;
    }
  };

  const fillRemainingSlots = (fullList: any[], allowedTypes: any[]) => {
    if (currentParty.value.length === 3) return;
    if (currentParty.value.length === 0) {
      generateFullTeam(allowedTypes);
      return;
    }

    isGenerating.value = true;
    try {
      const seed = currentParty.value.map(member => {
        // Use fullList for seed lookup because the member might not be in the current allowed list
        const typeData = fullList.find(t => t.name === member.typeName);
        if (!typeData) return null;
        const pokemonIndex = typeData.pokemon.findIndex((p: any) => p.pokemon.name === member.name);
        const selectedPokemon = resolveSelectedPokemon(typeData, pokemonIndex, member.abilityName);
        return {
          ...typeData,
          selectedPokemon
        };
      }).filter(Boolean);

      const teams = generateTeams({
        allowedTypes: allowedTypes,
        teamSize: 3,
        seed: seed as any[]
      });

      if (teams.length > 0) {
        const topTeam = teams[0];
        currentParty.value = topTeam.pokemon.map((p: any, idx: number) => {
            // Re-hydrate using fullList so we can find types that might be outside the current 'allowed' filter (for the seed members)
            const typeData = fullList.find(t => t.name === topTeam.types[idx]);
            if (!typeData) return null;
            return {
                name: p.name,
                types: p.types,
                sprite: p.sprite,
                stats: p.stats,
                abilityName: p.selected_ability_name,
                weaknesses: p.effective_weaknesses || typeData.weaknesses,
                resistances: p.effective_resistances || typeData.resistances,
                coverages: p.effective_coverages || typeData.coverages,
                typeName: typeData.name
            };
        }).filter((m: any): m is PartyMember => m !== null);
        notify("Found compatible partners for your team.", "success");
      } else {
        notify("No compatible partners found for this team.", "error");
      }
    } catch (e: any) {
      notify(`Filling slots failed: ${e.message}`, "error");
    } finally {
      isGenerating.value = false;
    }
  };

  return {
    currentParty,
    isGenerating,
    teamWeaknessSummary,
    teamCoverageSummary,
    addToParty,
    removeFromParty,
    clearParty,
    generateFullTeam,
    fillRemainingSlots
  };
}
