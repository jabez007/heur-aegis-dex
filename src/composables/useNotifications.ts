import { ref } from 'vue';

export interface Notification {
  id: number;
  message: string;
  type: 'info' | 'error' | 'success';
}

const notifications = ref<Notification[]>([]);
let nextId = 0;

/**
 * Provides shared notification state and helpers for transient UI messages.
 *
 * @returns Shared notifications state and methods to add or remove messages.
 */
export function useNotifications() {
  const notify = (message: string, type: Notification['type'] = 'info', duration = 4000) => {
    const id = nextId++;
    notifications.value.push({ id, message, type });

    if (duration > 0) {
      setTimeout(() => {
        remove(id);
      }, duration);
    }
  };

  const remove = (id: number) => {
    notifications.value = notifications.value.filter(n => n.id !== id);
  };

  return {
    notifications,
    notify,
    remove
  };
}
