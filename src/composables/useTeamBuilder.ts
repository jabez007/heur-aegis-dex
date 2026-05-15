import { ref, computed } from 'vue';
import { generateTeams } from '../lib/pokedex';

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
  };

  const removeFromParty = (index: number) => {
    currentParty.value.splice(index, 1);
  };

  const clearParty = () => {
    currentParty.value = [];
  };

  const generateFullTeam = (allDataTypes: any[]) => {
    isGenerating.value = true;
    const teams = generateTeams({
      allowedTypes: allDataTypes,
      teamSize: 3,
      seed: []
    });
    
    if (teams.length > 0) {
      const topTeam = teams[0];
      currentParty.value = topTeam.pokemon.map((p: any, idx: number) => {
          const typeData = allDataTypes.find(t => t.name === topTeam.types[idx]);
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
      });
    } else {
      alert("No valid teams found with current filters.");
    }
    isGenerating.value = false;
  };

  const fillRemainingSlots = (allDataTypes: any[]) => {
    if (currentParty.value.length === 3) return;
    if (currentParty.value.length === 0) {
      generateFullTeam(allDataTypes);
      return;
    }

    isGenerating.value = true;
    const seed = currentParty.value.map(member => {
      const typeData = allDataTypes.find(t => t.name === member.typeName);
      return {
        ...typeData,
        selectedPokemon: typeData.pokemon.find((p: any) => p.pokemon.name === member.name)
      };
    });

    const teams = generateTeams({
      allowedTypes: allDataTypes,
      teamSize: 3,
      seed: seed
    });

    if (teams.length > 0) {
      const topTeam = teams[0];
      currentParty.value = topTeam.pokemon.map((p: any, idx: number) => {
          const typeData = allDataTypes.find(t => t.name === topTeam.types[idx]);
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
      });
    } else {
      alert("No compatible partners found for this team.");
    }
    isGenerating.value = false;
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
