import { computed, ref, toValue, watch, type MaybeRefOrGetter } from 'vue';
import { useThreatScoring } from './useThreatScoring';
import {
  BATTLE_FORMATS,
  DEFAULT_BATTLE_FORMAT,
  type BattleFormatId
} from '../lib/battleFormats';
import {
  recommendGuidedPartners,
  selectPrimaryGuidedNeed,
  type PartnerRecommendation
} from '../lib/guidedNeedRules';
import {
  createGuidedPlan,
  getGuidedRoster,
  GUIDED_MAX_ADDITIONS,
  transitionGuidedPlan,
  type GuidedMemberChoice,
  type GuidedPlanState
} from '../lib/guidedPlanReducer';
import { ELEMENTAL_TYPES } from '../lib/pokemonCatalog';
import { withAbility, type PokemonEntry } from '../lib/pokemonEntry';

const codePointCompare = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const abilityNamesFor = (pokemon: PokemonEntry): string[] =>
  [...new Set([pokemon.abilityName, ...Object.keys(pokemon.abilityProfiles)])]
    .filter((name) => name.length > 0)
    .sort(codePointCompare);

const toChoice = (pokemon: PokemonEntry): GuidedMemberChoice => ({
  varietyName: pokemon.name,
  speciesName: pokemon.speciesName,
  abilityName: pokemon.abilityName
});

export function useGuidedPartnerSession(candidatePool: MaybeRefOrGetter<readonly PokemonEntry[]>) {
  const formatId = ref<BattleFormatId>(DEFAULT_BATTLE_FORMAT);
  const favorites = ref<PokemonEntry[]>([]);
  const searchQuery = ref('');
  const plan = ref<GuidedPlanState | null>(null);
  const message = ref('');

  const pool = computed(() => toValue(candidatePool));
  const selectedSpecies = computed(() => new Set(favorites.value.map(({ speciesName }) => speciesName)));
  const searchResults = computed(() => {
    const query = searchQuery.value.trim().toLowerCase();
    if (query.length < 2 || favorites.value.length >= 3 || plan.value) return [];
    return pool.value
      .filter((pokemon) =>
        abilityNamesFor(pokemon).length > 0 &&
        !selectedSpecies.value.has(pokemon.speciesName) &&
        (pokemon.name.includes(query) || pokemon.speciesName.includes(query))
      )
      .sort((left, right) => codePointCompare(left.name, right.name))
      .slice(0, 8);
  });

  const resolveChoice = (choice: GuidedMemberChoice): PokemonEntry | null => {
    const pokemon = pool.value.find(({ name }) => name === choice.varietyName);
    return pokemon ? withAbility(pokemon, choice.abilityName) : null;
  };
  const roster = computed(() => plan.value
    ? getGuidedRoster(plan.value).map(resolveChoice).filter((pokemon): pokemon is PokemonEntry => !!pokemon)
    : favorites.value
  );
  // Undefined until the catalog loads; the rules fall back to counting types
  // equally, which is what they did before these values existed.
  const { scoring } = useThreatScoring();
  const format = computed(() => BATTLE_FORMATS[plan.value?.format.id ?? formatId.value]);
  const need = computed(() => plan.value
    ? selectPrimaryGuidedNeed(roster.value, {
      format: format.value, typeNames: ELEMENTAL_TYPES, typeValues: scoring.value?.typeValues
    })
    : null
  );
  const recommendations = computed(() => plan.value && need.value
    ? recommendGuidedPartners({
        format: format.value,
        typeNames: ELEMENTAL_TYPES,
        typeValues: scoring.value?.typeValues,
        currentMembers: roster.value,
        candidatePool: pool.value
      })
    : []
  );
  const isComplete = computed(() => (plan.value?.additions.length ?? 0) >= GUIDED_MAX_ADDITIONS);

  const addFavorite = (pokemon: PokemonEntry) => {
    if (plan.value || favorites.value.length >= 3 || selectedSpecies.value.has(pokemon.speciesName)) return;
    const abilities = abilityNamesFor(pokemon);
    if (abilities.length === 0) return;
    favorites.value = [...favorites.value, withAbility(pokemon, abilities.includes(pokemon.abilityName)
      ? pokemon.abilityName
      : abilities[0])];
    searchQuery.value = '';
    message.value = '';
  };

  const addFirstSearchResult = () => {
    if (searchResults.value[0]) addFavorite(searchResults.value[0]);
  };

  const removeFavorite = (index: number) => {
    if (plan.value) return;
    favorites.value = favorites.value.filter((_, favoriteIndex) => favoriteIndex !== index);
  };

  const setFavoriteAbility = (index: number, abilityName: string) => {
    if (plan.value || !favorites.value[index]) return;
    favorites.value = favorites.value.map((pokemon, favoriteIndex) =>
      favoriteIndex === index ? withAbility(pokemon, abilityName) : pokemon
    );
  };

  const start = (): boolean => {
    const created = createGuidedPlan({
      format: formatId.value,
      lockedFavorites: favorites.value.map(toChoice)
    });
    if (!created.ok) {
      message.value = 'Choose one to three distinct favorites before finding partners.';
      return false;
    }
    const locked = transitionGuidedPlan(created.state, { type: 'recommendation-shown' });
    if (!locked.ok) return false;
    plan.value = locked.state;
    searchQuery.value = '';
    message.value = '';
    return true;
  };

  const addPartner = (recommendation: PartnerRecommendation): boolean => {
    if (!plan.value) return false;
    const result = transitionGuidedPlan(plan.value, {
      type: 'add-partner',
      member: {
        varietyName: recommendation.varietyName,
        speciesName: recommendation.speciesName,
        abilityName: recommendation.abilityName
      }
    });
    if (!result.ok) {
      message.value = 'That partner can no longer be added to this session.';
      return false;
    }
    plan.value = result.state;
    message.value = '';
    return true;
  };

  const restart = () => {
    formatId.value = DEFAULT_BATTLE_FORMAT;
    favorites.value = [];
    searchQuery.value = '';
    plan.value = null;
    message.value = '';
  };

  watch(pool, (nextPool, previousPool) => {
    if ((plan.value || favorites.value.length > 0) && nextPool !== previousPool) {
      restart();
      message.value = 'The scan changed, so the guided session was restarted.';
    }
  });

  return {
    formatId,
    favorites,
    searchQuery,
    searchResults,
    plan,
    message,
    roster,
    format,
    need,
    recommendations,
    isComplete,
    abilityNamesFor,
    addFavorite,
    addFirstSearchResult,
    removeFavorite,
    setFavoriteAbility,
    start,
    addPartner,
    restart
  };
}
