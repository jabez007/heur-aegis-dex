<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue';
import type { SavedWorkspace } from '../lib/workspacePersistence';

const props = defineProps<{
  saves: SavedWorkspace[];
  draftUpdatedAt: string | null;
  disabled: boolean;
  busy: boolean;
  currentReady: boolean;
  storageError: string;
}>();

const emit = defineEmits<{
  (event: 'save', name: string): void;
  (event: 'load', id: string): void;
  (event: 'rename', id: string, name: string): void;
  (event: 'delete', id: string): void;
}>();

const dialog = ref<HTMLDialogElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const workspaceName = ref('');
const confirmOverwrite = ref(false);
const pendingLoadId = ref<string | null>(null);
const pendingDeleteId = ref<string | null>(null);
const editingId = ref<string | null>(null);
const editName = ref('');
const renameError = ref('');
const isOpen = ref(false);
const instanceId = useId().replace(/:/g, '');
const dialogId = `workspace-saves-${instanceId}`;
const titleId = `workspace-saves-title-${instanceId}`;
const nameInputId = `workspace-name-${instanceId}`;
const savedListTitleId = `saved-workspaces-title-${instanceId}`;
const nameKey = (name: string) => name.trim().normalize('NFKC').toLowerCase();

const duplicateName = computed(() => {
  const name = workspaceName.value.trim();
  return props.saves.find((save) => nameKey(save.name) === nameKey(name));
});

watch(workspaceName, () => {
  confirmOverwrite.value = false;
});

const formatTimestamp = (timestamp: string | null) => {
  if (!timestamp) return 'Not saved yet';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(new Date(timestamp));
};

const open = () => {
  dialog.value?.showModal();
  isOpen.value = true;
};

const close = () => {
  dialog.value?.close();
  isOpen.value = false;
  confirmOverwrite.value = false;
  pendingLoadId.value = null;
  pendingDeleteId.value = null;
  editingId.value = null;
  trigger.value?.focus();
};

const save = () => {
  const name = workspaceName.value.trim();
  if (!name || name.length > 40) return;
  if (duplicateName.value && !confirmOverwrite.value) {
    confirmOverwrite.value = true;
    return;
  }
  emit('save', name);
  workspaceName.value = '';
  confirmOverwrite.value = false;
};

const requestLoad = async (id: string) => {
  pendingLoadId.value = id;
  pendingDeleteId.value = null;
  editingId.value = null;
  await nextTick();
  dialog.value?.querySelector<HTMLButtonElement>('.confirm-row button')?.focus();
};

const load = (id: string) => {
  emit('load', id);
  pendingLoadId.value = null;
  close();
};

const startRename = async (save: SavedWorkspace) => {
  editingId.value = save.id;
  editName.value = save.name;
  renameError.value = '';
  pendingLoadId.value = null;
  pendingDeleteId.value = null;
  await nextTick();
  dialog.value?.querySelector<HTMLInputElement>('.rename-input')?.focus();
};

const rename = (id: string) => {
  const name = editName.value.trim();
  if (!name || name.length > 40) return;
  if (props.saves.some((save) => save.id !== id && nameKey(save.name) === nameKey(name))) {
    renameError.value = `A workspace named "${name}" already exists.`;
    return;
  }
  emit('rename', id, name);
  editingId.value = null;
};

const requestDelete = async (id: string) => {
  pendingDeleteId.value = id;
  pendingLoadId.value = null;
  editingId.value = null;
  await nextTick();
  dialog.value?.querySelector<HTMLButtonElement>('.confirm-row button')?.focus();
};

const remove = (id: string) => {
  emit('delete', id);
  pendingDeleteId.value = null;
};

const cancelMode = async (id: string, action: 'load' | 'rename' | 'delete') => {
  pendingLoadId.value = null;
  pendingDeleteId.value = null;
  editingId.value = null;
  await nextTick();
  const button = [...(dialog.value?.querySelectorAll<HTMLButtonElement>('[data-workspace-action]') ?? [])]
    .find((candidate) => candidate.dataset.workspaceId === id && candidate.dataset.workspaceAction === action);
  button?.focus();
};
</script>

<template>
  <button
    ref="trigger"
    class="gba-btn"
    type="button"
    aria-haspopup="dialog"
    :aria-controls="dialogId"
    :aria-expanded="isOpen"
    @click="open"
  >
    Saves<span v-if="saves.length"> // {{ saves.length }}</span>
  </button>

  <dialog
    :id="dialogId"
    ref="dialog"
    class="workspace-dialog"
    :aria-labelledby="titleId"
    @cancel="close"
  >
    <div class="dialog-shell">
      <header class="dialog-header">
        <div>
          <h2 :id="titleId">
            Local Workspaces
          </h2>
          <p>Stored in this browser</p>
        </div>
        <button
          class="gba-btn mini"
          type="button"
          @click="close"
        >
          Close
        </button>
      </header>

      <p
        v-if="storageError"
        class="storage-error"
        role="alert"
      >
        {{ storageError }}
      </p>

      <section
        class="draft-status"
        aria-label="Automatic recovery status"
      >
        <strong>Auto Recovery</strong>
        <span>Draft saved {{ formatTimestamp(draftUpdatedAt) }}</span>
      </section>

      <form
        class="save-form"
        @submit.prevent="save"
      >
        <label
          class="gba-label"
          :for="nameInputId"
        >Name this workspace</label>
        <div class="save-form-row">
          <input
            :id="nameInputId"
            v-model="workspaceName"
            class="gba-input workspace-name-input"
            maxlength="40"
            autocomplete="off"
            placeholder="Rain Balance"
          >
          <button
            class="gba-btn"
            type="submit"
            :disabled="disabled || busy || !currentReady || !workspaceName.trim()"
          >
            {{ confirmOverwrite ? 'Confirm Overwrite' : (duplicateName ? 'Overwrite' : 'Save Copy') }}
          </button>
        </div>
        <p
          v-if="confirmOverwrite"
          class="inline-warning"
        >
          Replace the saved workspace named {{ duplicateName?.name }}?
        </p>
      </form>

      <section
        class="saved-list"
        :aria-labelledby="savedListTitleId"
      >
        <h3 :id="savedListTitleId">
          Saved Workspaces
        </h3>
        <p
          v-if="saves.length === 0"
          class="empty-saves"
        >
          NO SAVE DATA // Name this workspace to keep a checkpoint.
        </p>

        <article
          v-for="saveEntry in saves"
          v-else
          :key="saveEntry.id"
          class="saved-row"
        >
          <template v-if="editingId === saveEntry.id">
            <label
              class="gba-label"
              :for="`rename-${saveEntry.id}`"
            >Rename workspace</label>
            <div class="row-actions">
              <input
                :id="`rename-${saveEntry.id}`"
                v-model="editName"
                class="gba-input workspace-name-input rename-input"
                maxlength="40"
                @keyup.enter="rename(saveEntry.id)"
                @keyup.escape="cancelMode(saveEntry.id, 'rename')"
              >
              <button
                class="gba-btn mini"
                type="button"
                :disabled="disabled"
                @click="rename(saveEntry.id)"
              >
                Save Name
              </button>
              <button
                class="gba-btn mini"
                type="button"
                @click="cancelMode(saveEntry.id, 'rename')"
              >
                Cancel
              </button>
            </div>
            <p
              v-if="renameError"
              class="inline-warning"
              role="alert"
            >
              {{ renameError }}
            </p>
          </template>
          <template v-else>
            <div class="saved-summary">
              <strong>{{ saveEntry.name }}</strong>
              <span>
                {{ saveEntry.snapshot.team.format }} // {{ saveEntry.snapshot.team.roster.length }} Pokemon
                // {{ formatTimestamp(saveEntry.updatedAt) }}
              </span>
            </div>

            <div
              v-if="pendingLoadId === saveEntry.id"
              class="confirm-row"
              role="alertdialog"
              :aria-label="`Confirm loading ${saveEntry.name}`"
            >
              <span>Replace the current draft with this workspace?</span>
              <button
                class="gba-btn mini"
                type="button"
                @click="cancelMode(saveEntry.id, 'load')"
              >
                Cancel
              </button>
              <button
                class="gba-btn mini"
                type="button"
                :disabled="busy"
                @click="load(saveEntry.id)"
              >
                Load
              </button>
            </div>
            <div
              v-else-if="pendingDeleteId === saveEntry.id"
              class="confirm-row"
              role="alertdialog"
              :aria-label="`Confirm deleting ${saveEntry.name}`"
            >
              <span>Delete this saved workspace?</span>
              <button
                class="gba-btn mini"
                type="button"
                @click="cancelMode(saveEntry.id, 'delete')"
              >
                Cancel
              </button>
              <button
                class="gba-btn mini danger"
                type="button"
                :disabled="disabled"
                @click="remove(saveEntry.id)"
              >
                Delete
              </button>
            </div>
            <div
              v-else
              class="row-actions"
            >
              <button
                class="gba-btn mini"
                type="button"
                :disabled="busy"
                :data-workspace-id="saveEntry.id"
                data-workspace-action="load"
                @click="requestLoad(saveEntry.id)"
              >
                Load
              </button>
              <button
                class="gba-btn mini"
                type="button"
                :data-workspace-id="saveEntry.id"
                data-workspace-action="rename"
                @click="startRename(saveEntry)"
              >
                Rename
              </button>
              <button
                class="gba-btn mini danger"
                type="button"
                :data-workspace-id="saveEntry.id"
                data-workspace-action="delete"
                @click="requestDelete(saveEntry.id)"
              >
                Delete
              </button>
            </div>
          </template>
        </article>
      </section>
    </div>
  </dialog>
</template>

<style scoped lang="scss">
.workspace-dialog {
  width: min(640px, calc(100vw - 24px));
  max-height: calc(100dvh - 32px);
  padding: 0;
  color: var(--gba-text-dark);
  background: var(--gba-screen-bg);
  border: 4px solid var(--gba-text-dark);
  box-shadow: 8px 8px 0 rgba(0,0,0,0.45);
}

.workspace-dialog::backdrop {
  background: rgba(10, 16, 18, 0.78);
}

.dialog-shell {
  padding: 16px;
  overflow: auto;
  max-height: calc(100dvh - 64px);
}

.dialog-header,
.save-form-row,
.saved-summary,
.row-actions,
.confirm-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dialog-header,
.saved-summary {
  justify-content: space-between;
}

.dialog-header {
  padding-bottom: 12px;
  border-bottom: 2px dashed var(--gba-text-dark);
}

.dialog-header h2,
.dialog-header p,
.saved-list h3,
.saved-summary span {
  margin: 0;
}

.dialog-header p,
.saved-summary span,
.draft-status span {
  font-size: 0.78rem;
  opacity: 0.78;
}

.draft-status,
.save-form,
.saved-list {
  margin-top: 16px;
}

.draft-status {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 10px;
  border: 2px solid var(--gba-accent-cyan);
}

.save-form-row {
  margin-top: 6px;
}

.workspace-name-input {
  flex: 1;
  min-width: 0;
  width: 100%;
}

.inline-warning {
  color: var(--gba-accent-magenta);
  margin: 6px 0 0;
}

.storage-error {
  color: var(--gba-accent-magenta);
  border: 2px solid currentColor;
  padding: 10px;
}

.saved-list h3 {
  padding-bottom: 6px;
  border-bottom: 2px dashed var(--gba-text-dark);
}

.empty-saves,
.saved-row {
  margin: 10px 0 0;
  padding: 12px;
  border: 2px dashed var(--gba-text-dark);
}

.saved-row {
  background: rgba(255,255,255,0.16);
}

.saved-summary {
  align-items: baseline;
  margin-bottom: 10px;
}

.saved-summary strong {
  overflow-wrap: anywhere;
}

.row-actions,
.confirm-row {
  justify-content: flex-end;
  flex-wrap: wrap;
}

.confirm-row span {
  margin-right: auto;
}

.danger {
  color: white;
  background: var(--gba-accent-magenta);
}

.gba-btn:focus-visible,
.gba-input:focus-visible {
  outline: 3px solid var(--gba-accent-cyan);
  outline-offset: 2px;
}

@media (max-width: 560px) {
  .dialog-header,
  .draft-status,
  .save-form-row,
  .saved-summary {
    align-items: stretch;
    flex-direction: column;
  }

  .row-actions .gba-btn,
  .confirm-row .gba-btn {
    min-height: 44px;
  }
}
</style>
