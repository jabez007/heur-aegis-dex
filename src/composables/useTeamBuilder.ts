import { ref, computed } from 'vue';
import { generateTeams } from '../lib/pokedex';
import { useNotifications } from './useNotifications';

const { notify } = useNotifications();

export interface PartyMember {
  name: string;
  types: string[];
  sprite: string;
  stats: Record<string, number>;
  weaknesses: string[];
  resistances: string[];
  coverages: string[];
  typeName: string;
}

const currentParty = ref<PartyMember[]>([]);
const isGenerating = ref(false);

export function useTeamBuilder() {

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

  const addToParty = (typeData: any, pokemonIndex: number) => {
    if (currentParty.value.length >= 3) return;

    // Check if the same type combo is already in the party
    if (currentParty.value.some(member => member.typeName === typeData.name)) {
      notify(`A ${typeData.name.toUpperCase()} type is already in your party.`, "error");
      return;
    }
    
    const pokemon = typeData.pokemon[pokemonIndex];
    currentParty.value.push({
      name: pokemon.pokemon.name,
      types: pokemon.types.map((p: any) => p.type.name),
      sprite: pokemon.sprite,
      stats: pokemon.stats,
      weaknesses: typeData.weaknesses,
      resistances: typeData.resistances,
      coverages: typeData.coverages,
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
                weaknesses: typeData.weaknesses,
                resistances: typeData.resistances,
                coverages: typeData.coverages,
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
        return {
          ...typeData,
          selectedPokemon: typeData.pokemon.find((p: any) => p.pokemon.name === member.name)
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
                weaknesses: typeData.weaknesses,
                resistances: typeData.resistances,
                coverages: typeData.coverages,
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
