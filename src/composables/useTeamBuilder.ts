import { ref, computed } from 'vue';
import { generateTeams } from '../lib/pokedex';
import { resolveSelectedPokemon } from '../lib/activePokemon';
import type { ActiveTypeDataLike, TypeDataLike } from '../lib/activePokemon';
import type { TeamMemberResult } from '../lib/pokedexTypes';
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
  const toPartyMember = (member: TeamMemberResult, typeName: string, typeData: TypeDataLike): PartyMember => ({
    name: member.name,
    types: member.types,
    sprite: member.sprite || '',
    stats: member.stats,
    abilityName: member.selected_ability_name,
    weaknesses: member.effective_weaknesses || typeData.weaknesses,
    resistances: member.effective_resistances || typeData.resistances,
    coverages: member.effective_coverages || typeData.coverages,
    typeName
  });

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

  const addToParty = (typeData: ActiveTypeDataLike, pokemonIndex: number, abilityName?: string) => {
    if (currentParty.value.length >= 3) return;

    // Check if the same type combo is already in the party
    if (currentParty.value.some(member => member.typeName === typeData.name)) {
      notify(`A ${typeData.name.toUpperCase()} type is already in your party.`, "error");
      return;
    }
    
    const pokemon = resolveSelectedPokemon(typeData, pokemonIndex, abilityName);
    if (!pokemon || !pokemon.types || !pokemon.stats) return;
    currentParty.value.push({
      name: pokemon.pokemon.name,
      types: pokemon.types.map((p) => p.type.name),
      sprite: pokemon.sprite || '',
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

  const generateFullTeam = (allowedTypes: TypeDataLike[]) => {
    isGenerating.value = true;
    try {
      const teams = generateTeams({
        allowedTypes: allowedTypes,
        teamSize: 3,
        seed: []
      });
      
      if (teams.length > 0) {
        const topTeam = teams[0];
        currentParty.value = topTeam.pokemon.map((p, idx) => {
          const typeName = topTeam.types[idx];
          const typeData = allowedTypes.find(t => t.name === typeName);
          return typeData ? toPartyMember(p, typeName, typeData) : null;
        }).filter((m): m is PartyMember => m !== null);
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

  const fillRemainingSlots = (fullList: TypeDataLike[], allowedTypes: ActiveTypeDataLike[]) => {
    if (currentParty.value.length === 3) return;
    if (currentParty.value.length === 0) {
      generateFullTeam(allowedTypes);
      return;
    }

    isGenerating.value = true;
    try {
      const seed = currentParty.value.map((member): ActiveTypeDataLike | null => {
        // Use fullList for seed lookup because the member might not be in the current allowed list
        const typeData = fullList.find(t => t.name === member.typeName);
        if (!typeData) return null;
        const pokemonIndex = typeData.pokemon.findIndex((p: any) => p.pokemon.name === member.name);
        const selectedPokemon = resolveSelectedPokemon(typeData, pokemonIndex, member.abilityName);
        if (!selectedPokemon) return null;
        return {
          ...typeData,
          selectedPokemon,
          selected_pokemon_index: pokemonIndex,
          selected_ability_name: selectedPokemon.selected_ability_name || ''
        };
      }).filter((item): item is ActiveTypeDataLike => item !== null);

      const teams = generateTeams({
        allowedTypes: allowedTypes,
        teamSize: 3,
        seed
      });

      if (teams.length > 0) {
        const topTeam = teams[0];
        currentParty.value = topTeam.pokemon.map((p, idx) => {
          const typeName = topTeam.types[idx];
          const typeData = fullList.find(t => t.name === typeName);
          return typeData ? toPartyMember(p, typeName, typeData) : null;
        }).filter((m): m is PartyMember => m !== null);
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
