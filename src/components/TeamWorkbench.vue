<script setup lang="ts">
import { computed } from 'vue';
import { useTeamBuilder } from '../composables/useTeamBuilder';
import { BATTLE_FORMAT_LIST, type BattleFormatId } from '../lib/battleFormats';
import { ROSTER_WEIGHTS, VIABLE_LINE_MARGIN } from '../lib/rosterScoring';
import TypeBadge from './TypeBadge.vue';
import type { PokemonEntry } from '../lib/pokemonEntry';

const props = defineProps<{
  allPokemon: PokemonEntry[];
  filteredPokemon: PokemonEntry[];
}>();

const {
  roster,
  isGenerating,
  format,
  formatId,
  maxRosterSize,
  bringSize,
  canTryAnotherRoster,
  bringIndices,
  broughtTeam,
  isBrought,
  isSuggestedBring,
  rosterEvaluation,
  bringLines,
  currentLineIndex,
  currentBringScore,
  cycleBringLine,
  setFormat,
  toggleBring,
  useSuggestedBring,
  teamWeaknessSummary,
  teamCoverageSummary,
  teamSpreadSummary,
  teamRoleSummary,
  removeFromParty,
  clearParty,
  fillRemainingSlots
} = useTeamBuilder();

const rosterIsFull = computed(() => roster.value.length >= maxRosterSize.value);
const canFieldATeam = computed(() => bringIndices.value.length === bringSize.value);
const broughtNames = computed(() => broughtTeam.value.map((member) => member.name).join(' · '));

// Under open team list the opponent picks against all six, so what matters is
// how many *different* teams the roster can field — not how many subsets exist.
const linesHint = computed(() => {
  const { best, lines, targetLines } = rosterEvaluation.value;
  if (!best) return '';

  const rows = lines.map((line, index) => {
    const behind = best.score - line.score;
    const note = index === 0
      ? 'best'
      : behind <= VIABLE_LINE_MARGIN
        ? `${behind.toFixed(1)} behind`
        : `${behind.toFixed(1)} behind — too far to count`;
    return `  line ${index + 1}   ${line.score.toFixed(1)}   ${note}`;
  });

  const shortfall = lines.length < targetLines
    ? [`  ${targetLines - lines.length} more possible from a full roster of ${maxRosterSize.value}`]
    : [];

  return [
    ...rows,
    ...shortfall,
    '',
    `A line is a meaningfully different team of ${bringSize.value}. Two brings count separately only `
    + 'when they differ by at least two Pokemon — swapping a single slot leaves you playing the '
    + 'same game plan with a worse piece, so it is not a real alternative.',
    '',
    `Counted here if it scores within ${VIABLE_LINE_MARGIN} points of your best. The count is a readout only; `
    + 'the roster score already uses each line\'s actual score, so a weak line is charged in '
    + 'proportion rather than by this cutoff.'
  ].join('\n');
});

// Shows the sum rather than describing it. The prose version said "six parts the
// best team, four parts the lines behind it", which is accurate and still leaves
// you unable to work out where your own number came from.
const scoreHint = computed(() => {
  const { best, lines, targetLines, depth, score } = rosterEvaluation.value;
  if (!best) return '';

  const counted = lines.map((line) => line.score.toFixed(1)).join(' + ');
  const shortfall = targetLines - lines.length;

  return [
    `${score.toFixed(1)} out of 100`,
    `  = ${ROSTER_WEIGHTS.best} x ${best.score.toFixed(1)}   your best line`,
    `  + ${ROSTER_WEIGHTS.depth} x ${depth.toFixed(1)}   the lines behind it`,
    '',
    `That ${depth.toFixed(1)} is (${counted}) / ${targetLines}`,
    shortfall > 0
      ? `— divided by the ${targetLines} lines a full roster of ${maxRosterSize.value} offers, not by the ${lines.length} you have, `
        + `so the ${shortfall} you are missing count as zero. Registering more Pokemon raises this.`
      : `— your best line is in both halves, so it carries `
        + `${(ROSTER_WEIGHTS.best + (ROSTER_WEIGHTS.depth / targetLines)).toFixed(2)} of the score `
        + `and the other ${targetLines - 1} carry ${(ROSTER_WEIGHTS.depth / targetLines).toFixed(2)} each.`,
    '',
    'The roster can never score above its own best bring: a line weaker than your best '
    + 'always pulls the total down. Under open team list the opponent sees everything you '
    + 'registered and picks against it, so a second and third answer are worth real points.'
  ].join('\n');
});

const ROLE_LABELS: Record<string, string> = {
  'intimidate': 'Intimidate',
  'redirection': 'Redirection',
  'ally-protection': 'Ally Protection',
  'weather-setter': 'Weather',
  'terrain-setter': 'Terrain'
};

const formatRole = (role: string) => ROLE_LABELS[role] || role;
</script>

<template>
  <section class="gba-container team-workbench">
    <div class="workbench-header">
      <h2>Team Workbench</h2>
      <div class="workbench-actions">
        <label class="gba-label format-label">
          Format:
          <select
            class="gba-select"
            :value="formatId"
            @change="setFormat(($event.target as HTMLSelectElement).value as BattleFormatId)"
          >
            <option
              v-for="option in BATTLE_FORMAT_LIST"
              :key="option.id"
              :value="option.id"
            >
              {{ option.label }}
            </option>
          </select>
        </label>
        <button
          class="gba-btn action-btn mini"
          :disabled="(rosterIsFull && !canTryAnotherRoster) || isGenerating"
          @click="fillRemainingSlots(props.allPokemon, props.filteredPokemon)"
        >
          {{ isGenerating ? '...' : (roster.length === 0
            ? 'Generate Roster'
            : (canTryAnotherRoster ? 'Try Another' : 'Fill Roster')) }}
        </button>
        <button
          class="gba-btn action-btn mini"
          :disabled="roster.length === 0 || isGenerating"
          @click="clearParty"
        >
          Clear Roster
        </button>
      </div>
    </div>

    <p class="roster-status">
      Roster {{ roster.length }}/{{ maxRosterSize }}
      <span v-if="canFieldATeam">
        // <span :title="scoreHint">roster {{ Math.round(rosterEvaluation.score) }}/100</span>
        // <span :title="linesHint">{{ rosterEvaluation.viableLines }} of {{ rosterEvaluation.targetLines }} lines hold up</span>
      </span>
      <span v-else>
        // select {{ bringSize }} to bring
      </span>
    </p>

    <div
      v-if="canFieldATeam"
      class="bring-bar"
    >
      <button
        class="gba-btn mini step-btn"
        :disabled="bringLines.length < 2"
        aria-label="Previous line"
        @click="cycleBringLine(-1)"
      >
        ‹
      </button>
      <p class="bring-label">
        <template v-if="currentLineIndex >= 0">
          <strong>Line {{ currentLineIndex + 1 }} of {{ bringLines.length }}</strong>
          <span
            v-if="currentLineIndex === 0"
            class="bring-tag"
          >best</span>
        </template>
        <template v-else>
          <strong>Your pick</strong>
        </template>
        <span class="bring-names">{{ broughtNames }}</span>
        <span
          v-if="currentBringScore !== null"
          class="bring-score"
        >
          {{ Math.round(currentBringScore) }}/100
        </span>
      </p>
      <button
        class="gba-btn mini step-btn"
        :disabled="bringLines.length < 2"
        aria-label="Next line"
        @click="cycleBringLine(1)"
      >
        ›
      </button>
      <button
        v-if="!isSuggestedBring"
        class="link-btn"
        @click="useSuggestedBring"
      >
        Best
      </button>
    </div>
    
    <div class="party-grid">
      <div
        v-for="(_, index) in maxRosterSize"
        :key="index"
        class="party-slot"
        :class="{ empty: !roster[index], brought: roster[index] && isBrought(index) }"
      >
        <Transition
          name="party-pop"
          mode="out-in"
        >
          <div
            v-if="roster[index]"
            class="slot-content"
          >
            <div class="slot-info">
              <img
                :src="roster[index].sprite"
                :alt="roster[index].name"
                class="pixel-sprite mini"
              >
              <div class="slot-text">
                <p class="slot-name">
                  {{ roster[index].name }}
                </p>
                <div class="slot-types">
                  <TypeBadge
                    v-for="type in roster[index].types"
                    :key="type"
                    :type="type"
                    size="mini"
                  />
                </div>
                <p
                  v-if="roster[index].abilityName"
                  class="slot-ability"
                >
                  Ability: {{ roster[index].abilityName }}
                </p>
              </div>
            </div>
            <div class="slot-actions">
              <button
                class="bring-btn"
                :class="{ active: isBrought(index) }"
                :aria-pressed="isBrought(index)"
                :aria-label="`${isBrought(index) ? 'Do not bring' : 'Bring'} ${roster[index].name}`"
                @click="toggleBring(index)"
              >
                {{ isBrought(index) ? 'BRINGING' : 'BENCH' }}
              </button>
              <button
                class="remove-btn"
                :aria-label="`Remove ${roster[index].name} from roster`"
                @click="removeFromParty(index)"
              >
                ×
              </button>
            </div>
          </div>
          <div
            v-else
            class="slot-content empty"
          >
            <p class="empty-text">
              Slot {{ index + 1 }} Empty
            </p>
          </div>
        </Transition>
      </div>
    </div>

    <Transition
      name="analysis-fade"
      mode="out-in"
    >
      <div
        v-if="canFieldATeam"
        key="data"
        class="team-analysis"
      >
        <div class="analysis-grid">
          <div class="analysis-col">
            <p class="analysis-label">
              Team Weaknesses:
            </p>
            <TransitionGroup
              name="badge-list"
              tag="div"
              class="type-badge-list"
            >
              <TypeBadge 
                v-for="(count, type) in teamWeaknessSummary" 
                :key="type" 
                :type="type" 
                size="mini"
              >
                {{ type }} {{ count > 1 ? 'x' + count : '' }}
              </TypeBadge>
              <p
                v-if="Object.keys(teamWeaknessSummary).length === 0"
                key="none"
                class="none-text"
              >
                None! Excellent.
              </p>
            </TransitionGroup>
          </div>
          <div class="analysis-col">
            <p class="analysis-label">
              Team Coverage:
            </p>
            <TransitionGroup
              name="badge-list"
              tag="div"
              class="type-badge-list"
            >
              <TypeBadge 
                v-for="(count, type) in teamCoverageSummary" 
                :key="type" 
                :type="type" 
                size="mini"
              >
                {{ type }} {{ count > 1 ? 'x' + count : '' }}
              </TypeBadge>
              <p
                v-if="Object.keys(teamCoverageSummary).length === 0"
                key="none"
                class="none-text"
              >
                None yet.
              </p>
            </TransitionGroup>
          </div>
        </div>

        <div
          v-if="format.hasAlly"
          class="analysis-grid spread-grid"
        >
          <div class="analysis-col">
            <p class="analysis-label">
              Free Spread Moves:
              <span class="analysis-hint">partner is immune</span>
            </p>
            <TransitionGroup
              name="badge-list"
              tag="div"
              class="type-badge-list"
            >
              <TypeBadge
                v-for="type in teamSpreadSummary.enabled"
                :key="type"
                :type="type"
                size="mini"
              />
              <p
                v-if="teamSpreadSummary.enabled.length === 0"
                key="none"
                class="none-text"
              >
                None.
              </p>
            </TransitionGroup>
          </div>
          <div class="analysis-col">
            <p class="analysis-label">
              Unsafe Spread Moves:
              <span class="analysis-hint">no safe partner</span>
            </p>
            <TransitionGroup
              name="badge-list"
              tag="div"
              class="type-badge-list"
            >
              <TypeBadge
                v-for="type in teamSpreadSummary.conflicts"
                :key="type"
                :type="type"
                size="mini"
              />
              <p
                v-if="teamSpreadSummary.conflicts.length === 0"
                key="none"
                class="none-text"
              >
                None.
              </p>
            </TransitionGroup>
          </div>
        </div>

        <div class="role-row">
          <p class="analysis-label">
            Support Roles:
            <span class="analysis-hint">from selected abilities</span>
          </p>
          <div class="role-list">
            <span
              v-for="role in teamRoleSummary.roles"
              :key="role"
              class="role-chip"
            >
              {{ formatRole(role) }}
            </span>
            <p
              v-if="teamRoleSummary.roles.length === 0"
              class="none-text"
            >
              None.
            </p>
          </div>
          <p
            v-if="teamRoleSummary.fieldConflicts.length > 0"
            class="role-conflict"
            role="status"
          >
            ⚠ {{ teamRoleSummary.conflictingAbilities.join(' vs ') }} overwrite each other.
          </p>
        </div>
      </div>
      <div
        v-else
        key="hint"
        class="team-analysis"
      >
        <p class="hint-text">
          {{ roster.length === 0
            ? 'Add Pokemon from the Meta Analysis below to build your roster.'
            : `Select ${bringSize} of your ${roster.length} to see the battle analysis.` }}
        </p>
      </div>
    </Transition>
  </section>
</template>

<style lang="scss" scoped>
.analysis-fade-enter-active,
.analysis-fade-leave-active {
  transition: all 0.3s steps(5);
}
.analysis-fade-enter-from,
.analysis-fade-leave-to {
  opacity: 0;
  transform: translateY(10px);
}

.badge-list-move,
.badge-list-enter-active,
.badge-list-leave-active {
  transition: all 0.2s steps(4);
}

.badge-list-leave-active {
  position: absolute;
}

.badge-list-enter-from,
.badge-list-leave-to {
  opacity: 0;
  transform: scale(0.5);
}

.type-badge-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  position: relative;
  min-height: 22px;
}

.team-workbench {
  background-color: var(--gba-screen-bg);
  border: 4px solid var(--gba-screen-border);
  margin-bottom: 24px;
  padding: 16px;

  .workbench-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 2px solid var(--gba-text-dark);
    padding-bottom: 8px;
    margin-bottom: 16px;
    
    h2 { margin: 0; }
  }
}

.party-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.party-pop-enter-active,
.party-pop-leave-active {
  transition: all 0.2s steps(4);
}
.party-pop-enter-from,
.party-pop-leave-to {
  opacity: 0;
  transform: scale(0.8) rotate(-5deg);
}

.slot-content {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  
  &.empty {
    opacity: 0.5;
  }
}

.party-slot {
  border: 2px solid var(--gba-text-dark);
  background: rgba(255,255,255,0.2);
  min-height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  padding: 8px;
  
  &.empty {
    border: 2px dashed rgba(0,0,0,0.2);
    background: rgba(0,0,0,0.05);
  }
}

.slot-info {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.pixel-sprite.mini {
  width: 64px;
  height: 64px;
  image-rendering: pixelated;
}

.slot-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.slot-name {
  font-family: var(--gba-font-heading);
  font-size: 1.1rem;
  text-transform: capitalize;
  margin: 0;
}

.slot-types {
  display: flex;
  gap: 4px;
}

.slot-ability {
  margin: 0;
  font-size: 0.75rem;
  text-transform: capitalize;
  opacity: 0.8;
}

.remove-btn {
  position: absolute;
  top: -10px;
  right: -10px;
  background: var(--gba-accent-magenta);
  color: white;
  border: 2px solid var(--gba-text-dark);
  border-radius: 50%;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-weight: bold;
  
  &:hover {
    transform: scale(1.1);
  }
}

.empty-text {
  font-family: var(--gba-font-heading);
  opacity: 0.5;
  margin: 0;
}

.team-analysis {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 2px dashed var(--gba-text-dark);
}

.analysis-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}

.party-grid {
  grid-template-columns: repeat(3, 1fr);
}

@media (max-width: 900px) {
  .party-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 560px) {
  .party-grid {
    grid-template-columns: 1fr;
  }
}

.analysis-label {
  font-family: var(--gba-font-heading);
  font-weight: bold;
  margin-bottom: 8px;
  border-bottom: 1px solid var(--gba-text-dark);
}

.analysis-hint {
  font-family: var(--gba-font-body);
  font-weight: normal;
  font-size: 0.75rem;
  opacity: 0.7;
  margin-left: 6px;
}

.spread-grid {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 2px dashed var(--gba-text-dark);
}

.role-row {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 2px dashed var(--gba-text-dark);
}

.role-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.role-chip {
  font-family: var(--gba-font-body);
  font-size: 0.8rem;
  text-transform: uppercase;
  padding: 2px 8px;
  border: 2px solid var(--gba-text-dark);
  background: var(--gba-accent-cyan);
  color: var(--gba-text-dark);
}

.roster-status {
  font-family: var(--gba-font-body);
  font-size: 0.85rem;
  margin-bottom: 8px;
  opacity: 0.9;

  // These carry an explanation nobody can guess from the number alone.
  span[title] {
    border-bottom: 1px dotted currentColor;
    cursor: help;
  }
}

.bring-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  padding: 6px 8px;
  border: 2px solid var(--gba-text-dark);
  background: rgba(255, 255, 255, 0.25);
}

.step-btn {
  font-family: var(--gba-font-heading);
  line-height: 1;
  padding: 2px 10px;
  flex: 0 0 auto;

  &:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
}

.bring-label {
  font-family: var(--gba-font-body);
  font-size: 0.85rem;
  margin: 0;
  flex: 1 1 auto;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.bring-names {
  text-transform: capitalize;
  opacity: 0.85;
  overflow-wrap: anywhere;
}

.bring-score {
  margin-left: auto;
  font-family: var(--gba-font-heading);
  white-space: nowrap;
}

.bring-tag {
  font-size: 0.65rem;
  text-transform: uppercase;
  padding: 1px 6px;
  border: 2px solid var(--gba-text-dark);
  background: var(--gba-accent-cyan);
  color: var(--gba-text-dark);
}

@media (max-width: 560px) {
  .bring-score {
    margin-left: 0;
  }
}

.link-btn {
  font-family: var(--gba-font-body);
  font-size: 0.8rem;
  background: none;
  border: none;
  border-bottom: 1px solid currentColor;
  color: var(--gba-accent-magenta);
  cursor: pointer;
  padding: 0;
  margin-left: 8px;
  text-transform: uppercase;
}

// Format names are longer than the shared 100px control width.
.format-label .gba-select {
  width: auto;
  min-width: 100px;
}

/* Benched members stay visible but recede, so the brought team reads first. */
.party-slot:not(.brought):not(.empty) .slot-content {
  opacity: 0.55;
}

.party-slot.brought {
  outline: 3px solid var(--gba-accent-cyan);
  outline-offset: 2px;
}

.slot-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.bring-btn {
  font-family: var(--gba-font-body);
  font-size: 0.65rem;
  padding: 2px 6px;
  border: 2px solid var(--gba-text-dark);
  background: var(--gba-text-light);
  color: var(--gba-text-dark);
  cursor: pointer;
  text-transform: uppercase;
}

.bring-btn.active {
  background: var(--gba-accent-cyan);
}

.role-conflict {
  margin-top: 8px;
  font-family: var(--gba-font-body);
  font-size: 0.8rem;
  color: var(--gba-accent-magenta);
  text-transform: uppercase;
}

@media (max-width: 600px) {
  .analysis-grid {
    grid-template-columns: 1fr;
  }
}

.type-badge-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.none-text {
  font-size: 0.85rem;
  opacity: 0.6;
}

.hint-text {
  font-style: italic;
  font-size: 0.9rem;
  text-align: center;
  margin: 0;
}

.action-btn {
  background-color: var(--gba-accent-magenta);
  color: var(--gba-text-light);
  border-color: var(--gba-text-dark);
}
</style>
