import { ref } from 'vue';
import { createInjectableState } from './injectableState';

export interface Notification {
  id: number;
  message: string;
  type: 'info' | 'error' | 'success';
}

const notificationState = createInjectableState('heur-aegis-dex:notifications', () => ({
  notifications: ref<Notification[]>([]),
  nextId: { value: 0 }
}));

export const provideNotifications = notificationState.provideState;
export const __resetNotificationsState = notificationState.resetFallbackState;

/**
 * Provides notification state and helpers for transient UI messages, scoped to
 * the current Vue app.
 *
 * @returns Notifications state and methods to add or remove messages.
 */
export function useNotifications() {
  const { notifications, nextId } = notificationState.useState();

  const notify = (message: string, type: Notification['type'] = 'info', duration = 4000) => {
    const id = nextId.value++;
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
