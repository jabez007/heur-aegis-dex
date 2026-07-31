<script setup lang="ts">
import { computed } from 'vue';
import { useGuidedPartnerSession } from '../composables/useGuidedPartnerSession';
import { BATTLE_FORMAT_LIST, type BattleFormatId } from '../lib/battleFormats';
import {
  displayPokemonName,
  explainGuidedNeed,
  explainRecommendation,
  explainTradeoff
} from '../lib/guidedExplanations';
import { flattenToPokemon } from '../lib/pokemonEntry';
import type { ResistantTypeResult } from '../lib/pokedexTypes';
import TypeBadge from './TypeBadge.vue';

const props = defineProps<{
  allDataTypes: ResistantTypeResult[]
}>();

const allPokemon = computed(() => flattenToPokemon(props.allDataTypes));
const session = useGuidedPartnerSession(allPokemon);
const {
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
  isComplete
} = session;

const favoriteCount = computed(() => plan.value?.lockedFavorites.length ?? favorites.value.length);
const additionsCount = computed(() => plan.value?.additions.length ?? 0);
const setFormat = (nextFormat: BattleFormatId) => {
  if (!plan.value) formatId.value = nextFormat;
};
</script>

<template>
  <section
    class="guided-builder gba-container"
    aria-labelledby="guided-title"
  >
    <header class="guided-header">
      <div>
        <p class="eyebrow">
          PARTNER ROUTE // CURRENT SESSION
        </p>
        <h2 id="guided-title">
          Guided Build
        </h2>
        <p class="intro">
          Lock in the Pokemon you want to use. The dex will surface one structural
          weakness at a time and show partners that measurably improve it.
        </p>
      </div>
      <div
        class="route-counter"
        aria-label="Guided roster progress"
      >
        <strong>{{ roster.length }}/6</strong>
        <span>ROSTER</span>
      </div>
    </header>

    <p
      v-if="message"
      class="session-message"
      role="status"
    >
      {{ message }}
    </p>

    <div
      v-if="!plan"
      class="setup-grid"
    >
      <section
        class="setup-step"
        aria-labelledby="format-heading"
      >
        <span class="step-number">01</span>
        <div class="step-content">
          <h3 id="format-heading">
            Choose a format
          </h3>
          <div
            class="format-switch"
            role="radiogroup"
            aria-labelledby="format-heading"
          >
            <button
              v-for="option in BATTLE_FORMAT_LIST"
              :key="option.id"
              type="button"
              class="format-option"
              :class="{ selected: formatId === option.id }"
              role="radio"
              :aria-checked="formatId === option.id"
              @click="setFormat(option.id)"
            >
              <strong>{{ option.id }}</strong>
              <span>Bring {{ option.broughtToBattle }}</span>
            </button>
          </div>
        </div>
      </section>

      <section
        class="setup-step"
        aria-labelledby="favorites-heading"
      >
        <span class="step-number">02</span>
        <div class="step-content">
          <h3 id="favorites-heading">
            Lock 1-3 favorites
          </h3>
          <p>Search the current scan. Ability choices are evaluated separately.</p>

          <div
            v-if="favorites.length"
            class="favorite-list"
          >
            <article
              v-for="(pokemon, index) in favorites"
              :key="pokemon.name"
              class="favorite-row"
            >
              <div class="pokemon-identity">
                <span class="slot-marker">F{{ index + 1 }}</span>
                <div>
                  <strong>{{ displayPokemonName(pokemon.name) }}</strong>
                  <div class="type-row">
                    <TypeBadge
                      v-for="type in pokemon.types"
                      :key="type"
                      :type="type"
                      size="mini"
                    />
                  </div>
                </div>
              </div>
              <label class="ability-control">
                <span>Ability</span>
                <select
                  class="gba-select"
                  :value="pokemon.abilityName"
                  @change="session.setFavoriteAbility(index, ($event.target as HTMLSelectElement).value)"
                >
                  <option
                    v-for="ability in session.abilityNamesFor(pokemon)"
                    :key="ability"
                    :value="ability"
                  >
                    {{ displayPokemonName(ability) }}
                  </option>
                </select>
              </label>
              <button
                type="button"
                class="remove-btn"
                :aria-label="`Remove ${displayPokemonName(pokemon.name)}`"
                @click="session.removeFavorite(index)"
              >
                REMOVE
              </button>
            </article>
          </div>

          <div
            v-if="favorites.length < 3"
            class="pokemon-search"
          >
            <label for="guided-pokemon-search">Pokemon search</label>
            <input
              id="guided-pokemon-search"
              v-model="searchQuery"
              class="gba-input"
              type="search"
              autocomplete="off"
              placeholder="TYPE 2+ LETTERS"
              @keydown.enter.prevent="session.addFirstSearchResult"
            >
            <div
              v-if="searchResults.length"
              class="search-results"
              role="listbox"
            >
              <button
                v-for="pokemon in searchResults"
                :key="pokemon.name"
                type="button"
                role="option"
                @click="session.addFavorite(pokemon)"
              >
                <span>{{ displayPokemonName(pokemon.name) }}</span>
                <span class="result-types">{{ pokemon.types.join(' / ') }}</span>
              </button>
            </div>
            <p
              v-else-if="searchQuery.trim().length >= 2"
              class="empty-search"
            >
              No eligible matches in this scan.
            </p>
          </div>

          <button
            type="button"
            class="gba-btn begin-btn"
            :disabled="favorites.length === 0"
            data-guided-action="start"
            @click="session.start"
          >
            Find Partners
          </button>
        </div>
      </section>
    </div>

    <div
      v-else
      class="guided-route"
    >
      <section
        class="roster-rail"
        aria-labelledby="roster-heading"
      >
        <div class="rail-heading">
          <div>
            <p class="eyebrow">
              LOCKED ROUTE // {{ format.label }}
            </p>
            <h3 id="roster-heading">
              Your roster
            </h3>
          </div>
          <button
            type="button"
            class="restart-btn"
            @click="session.restart"
          >
            Start over
          </button>
        </div>
        <div class="roster-members">
          <article
            v-for="(pokemon, index) in roster"
            :key="pokemon.name"
            class="roster-member"
          >
            <span class="slot-marker">{{ index < favoriteCount ? `F${index + 1}` : `P${index - favoriteCount + 1}` }}</span>
            <strong>{{ displayPokemonName(pokemon.name) }}</strong>
            <span>{{ displayPokemonName(pokemon.abilityName) }}</span>
            <div class="type-row">
              <TypeBadge
                v-for="type in pokemon.types"
                :key="type"
                :type="type"
                size="mini"
              />
            </div>
          </article>
          <div
            v-for="slot in 6 - roster.length"
            :key="`empty-${slot}`"
            class="empty-slot"
            aria-hidden="true"
          >
            +
          </div>
        </div>
      </section>

      <template v-if="!isComplete && need && recommendations.length">
        <section
          class="need-panel"
          aria-labelledby="need-heading"
        >
          <span class="step-number">{{ String(additionsCount + 3).padStart(2, '0') }}</span>
          <div>
            <p class="eyebrow">
              PRIMARY NEED
            </p>
            <h3 id="need-heading">
              <TypeBadge
                :type="need.dimension"
                size="header"
                :is-quad="need.id === 'shared-quadruple-weakness'"
              />
              {{ displayPokemonName(need.id) }}
            </h3>
            <p>{{ explainGuidedNeed(need) }}</p>
          </div>
          <div class="severity-readout">
            <span>MODELED IMPACT</span>
            <strong>{{ need.severity.toFixed(3) }}</strong>
          </div>
        </section>

        <section
          class="recommendation-section"
          aria-labelledby="recommendations-heading"
        >
          <div class="recommendation-heading">
            <div>
              <p class="eyebrow">
                SHORTLIST // {{ recommendations.length }} RESULTS
              </p>
              <h3 id="recommendations-heading">
                Choose one partner
              </h3>
            </div>
            <p>Adding a partner recalculates the next need.</p>
          </div>
          <div class="recommendation-list">
            <article
              v-for="(recommendation, index) in recommendations"
              :key="`${recommendation.varietyName}:${recommendation.abilityName}`"
              class="recommendation-card"
            >
              <div class="rank">
                {{ String(index + 1).padStart(2, '0') }}
              </div>
              <div class="recommendation-body">
                <div class="recommendation-name">
                  <h4>{{ displayPokemonName(recommendation.varietyName) }}</h4>
                  <span>{{ displayPokemonName(recommendation.abilityName) }}</span>
                </div>
                <div class="type-row">
                  <TypeBadge
                    v-for="type in recommendation.pokemon.types"
                    :key="type"
                    :type="type"
                    size="normal"
                  />
                </div>
                <p class="reason">
                  {{ explainRecommendation(recommendation) }}
                </p>
                <p
                  v-if="explainTradeoff(recommendation.primaryTradeoff)"
                  class="tradeoff"
                >
                  {{ explainTradeoff(recommendation.primaryTradeoff) }}
                </p>
              </div>
              <div class="recommendation-action">
                <div class="improvement">
                  <span>IMPROVEMENT</span>
                  <strong>+{{ recommendation.improvement.toFixed(3) }}</strong>
                </div>
                <button
                  type="button"
                  class="gba-btn add-btn"
                  data-guided-action="add"
                  @click="session.addPartner(recommendation)"
                >
                  Add Partner
                </button>
              </div>
            </article>
          </div>
        </section>
      </template>

      <section
        v-else
        class="terminal-panel"
        role="status"
      >
        <p class="eyebrow">
          ROUTE CHECKPOINT
        </p>
        <h3 v-if="isComplete">
          Three partners added
        </h3>
        <h3 v-else-if="!need">
          No supported vulnerability remains
        </h3>
        <h3 v-else>
          No eligible partner improves this need
        </h3>
        <p v-if="isComplete">
          This guided session is complete. Review the six-member roster above or start again.
        </p>
        <p v-else-if="!need">
          The current roster has no shared or unanswered weakness covered by this guided MVP.
        </p>
        <p v-else>
          The scan found the need, but no legal catalog candidate improves its modeled evidence.
        </p>
        <button
          type="button"
          class="gba-btn"
          @click="session.restart"
        >
          Start New Route
        </button>
      </section>
    </div>
  </section>
</template>

<style lang="scss" scoped>
.guided-builder {
  --route-ink: #152522;
  --route-muted: #50625c;
  --route-line: rgba(21, 37, 34, 0.26);
  --route-paper: rgba(255, 255, 255, 0.38);
  overflow: hidden;
}

.guided-header,
.rail-heading,
.recommendation-heading,
.need-panel,
.favorite-row,
.recommendation-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}

.guided-header {
  padding-bottom: 20px;
  border-bottom: 4px double var(--route-ink);
}

.guided-header h2 { font-size: clamp(1.7rem, 4vw, 2.8rem); margin-bottom: 6px; }
.intro { max-width: 680px; margin: 0; font-size: 1.1rem; }
.eyebrow { margin: 0 0 4px; font-family: var(--gba-font-heading); letter-spacing: 1px; font-size: .9rem; }

.route-counter {
  min-width: 104px;
  padding: 10px;
  border: 3px solid var(--route-ink);
  box-shadow: 4px 4px 0 var(--route-ink);
  text-align: center;
  background: var(--gba-accent-yellow);
}
.route-counter strong { display: block; font: 2rem var(--gba-font-heading); }
.route-counter span { font-size: .8rem; }

.session-message { padding: 10px 12px; border-left: 5px solid var(--gba-accent-magenta); background: var(--route-paper); }
.setup-grid { display: grid; gap: 0; }
.setup-step { display: grid; grid-template-columns: 56px 1fr; gap: 18px; padding: 24px 0; border-bottom: 2px dashed var(--route-line); }
.step-number, .rank { font: 1.35rem var(--gba-font-heading); color: var(--route-muted); }
.step-content h3 { margin-bottom: 4px; }
.step-content > p { margin-top: 0; }

.format-switch { display: grid; grid-template-columns: repeat(2, minmax(150px, 230px)); gap: 10px; margin-top: 14px; }
.format-option {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 12px;
  border: 2px solid var(--route-ink);
  background: transparent;
  color: var(--route-ink);
  cursor: pointer;
  font-family: var(--gba-font-body);
  text-transform: uppercase;
}
.format-option strong { font: 1.1rem var(--gba-font-heading); }
.format-option.selected { background: var(--gba-accent-cyan); box-shadow: 3px 3px 0 var(--route-ink); }

.favorite-list { display: grid; gap: 8px; margin: 16px 0; }
.favorite-row { padding: 10px 12px; border: 2px solid var(--route-ink); background: var(--route-paper); }
.pokemon-identity { display: flex; align-items: center; gap: 10px; min-width: 190px; }
.slot-marker { display: inline-grid; place-items: center; min-width: 29px; height: 29px; border: 2px solid var(--route-ink); font: .85rem var(--gba-font-heading); background: var(--gba-accent-yellow); }
.type-row { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; }
.ability-control { display: flex; align-items: center; gap: 8px; font-family: var(--gba-font-heading); }
.ability-control .gba-select { width: 190px; }
.remove-btn, .restart-btn { border: 0; border-bottom: 2px solid currentColor; background: transparent; cursor: pointer; font-family: var(--gba-font-heading); color: var(--route-ink); }

.pokemon-search { position: relative; max-width: 620px; margin: 16px 0; }
.pokemon-search > label { display: block; font-family: var(--gba-font-heading); margin-bottom: 4px; }
.pokemon-search .gba-input { width: 100%; padding: 10px; }
.search-results { position: absolute; z-index: 4; width: 100%; border: 2px solid var(--route-ink); background: var(--gba-screen-bg); box-shadow: 4px 4px 0 var(--route-ink); }
.search-results button { display: flex; justify-content: space-between; width: 100%; padding: 8px 10px; border: 0; border-bottom: 1px solid var(--route-line); background: transparent; cursor: pointer; font-family: var(--gba-font-body); text-transform: uppercase; text-align: left; }
.search-results button:hover, .search-results button:focus { background: var(--gba-accent-yellow); }
.result-types { color: var(--route-muted); }
.empty-search { margin: 5px 0; color: var(--route-muted); }
.begin-btn { margin-top: 8px; background: var(--gba-accent-yellow); }
.begin-btn:disabled { cursor: not-allowed; opacity: .45; }

.guided-route { display: grid; gap: 22px; padding-top: 22px; }
.roster-rail { padding: 14px; border: 2px solid var(--route-ink); background: var(--route-paper); }
.rail-heading h3 { margin-bottom: 8px; }
.roster-members { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; }
.roster-member, .empty-slot { min-height: 108px; padding: 8px; border: 2px solid var(--route-ink); }
.roster-member { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; background: var(--gba-screen-bg); }
.roster-member > span:not(.slot-marker) { color: var(--route-muted); font-size: .8rem; }
.empty-slot { display: grid; place-items: center; border-style: dashed; color: var(--route-muted); font-size: 1.5rem; }

.need-panel { align-items: stretch; padding: 18px; border: 3px solid var(--route-ink); box-shadow: 5px 5px 0 var(--gba-accent-magenta); background: var(--gba-accent-yellow); }
.need-panel > div:nth-child(2) { flex: 1; }
.need-panel h3 { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin: 0 0 5px; }
.need-panel p { margin: 0; }
.severity-readout { display: grid; align-content: center; text-align: right; padding-left: 18px; border-left: 2px solid var(--route-ink); }
.severity-readout span { font-size: .75rem; }
.severity-readout strong { font: 1.5rem var(--gba-font-heading); }

.recommendation-heading { align-items: end; }
.recommendation-heading h3 { margin: 0; }
.recommendation-heading > p { margin: 0; color: var(--route-muted); }
.recommendation-list { display: grid; gap: 10px; margin-top: 12px; }
.recommendation-card { padding: 14px; border: 2px solid var(--route-ink); background: var(--route-paper); }
.recommendation-card:first-child { border-width: 3px; background: rgba(255, 255, 255, .58); }
.recommendation-body { flex: 1; }
.recommendation-name { display: flex; align-items: baseline; gap: 10px; }
.recommendation-name h4 { margin: 0; font-size: 1.25rem; }
.recommendation-name > span { color: var(--route-muted); text-transform: uppercase; }
.reason { margin: 7px 0 0; }
.tradeoff { margin: 3px 0 0; color: #713440; font-size: .9rem; }
.recommendation-action { min-width: 150px; text-align: right; }
.improvement { margin-bottom: 8px; }
.improvement span { display: block; font-size: .7rem; }
.improvement strong { font: 1.25rem var(--gba-font-heading); color: #0b6454; }
.add-btn { font-size: 1rem; background: var(--gba-accent-cyan); }

.terminal-panel { padding: clamp(24px, 6vw, 60px); border: 3px solid var(--route-ink); text-align: center; background: var(--route-paper); }
.terminal-panel h3 { font-size: clamp(1.4rem, 3vw, 2rem); }

@media (max-width: 820px) {
  .roster-members { grid-template-columns: repeat(3, 1fr); }
  .recommendation-card { align-items: flex-start; flex-wrap: wrap; }
  .recommendation-action { display: flex; width: 100%; align-items: center; justify-content: space-between; }
  .improvement { margin: 0; text-align: left; }
}

@media (max-width: 600px) {
  .guided-header { align-items: flex-start; }
  .route-counter { min-width: 72px; }
  .setup-step { grid-template-columns: 1fr; }
  .format-switch { grid-template-columns: 1fr; }
  .favorite-row { align-items: flex-start; flex-wrap: wrap; }
  .ability-control { width: 100%; }
  .ability-control .gba-select { flex: 1; }
  .roster-members { grid-template-columns: repeat(2, 1fr); }
  .need-panel { flex-wrap: wrap; }
  .severity-readout { width: 100%; padding: 8px 0 0; border-left: 0; border-top: 2px solid var(--route-ink); text-align: left; }
  .recommendation-heading { align-items: flex-start; flex-direction: column; }
  .recommendation-card .rank { display: none; }
  .result-types { display: none; }
}
</style>
