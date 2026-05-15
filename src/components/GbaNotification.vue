<script setup lang="ts">
import { useNotifications } from '../composables/useNotifications';

const { notifications, remove } = useNotifications();
</script>

<template>
  <div class="notification-container">
    <TransitionGroup name="gba-msg">
      <div 
        v-for="n in notifications" 
        :key="n.id" 
        class="gba-message-box"
        :class="n.type"
        @click="remove(n.id)"
      >
        <div class="msg-content">
          <p>{{ n.message }}</p>
          <div class="msg-arrow"></div>
        </div>
      </div>
    </TransitionGroup>
  </div>
</template>

<style lang="scss" scoped>
.notification-container {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  width: 90%;
  max-width: 600px;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 12px;
  pointer-events: none;
}

.gba-message-box {
  pointer-events: auto;
  background-color: var(--text-light);
  border: 4px solid var(--text-dark);
  box-shadow: 6px 6px 0px rgba(0,0,0,0.3);
  padding: 16px 24px;
  position: relative;
  cursor: pointer;
  
  // Custom double-border look
  &::before {
    content: '';
    position: absolute;
    top: 2px; left: 2px; right: 2px; bottom: 2px;
    border: 2px solid var(--text-dark);
    pointer-events: none;
  }

  &.error {
    background-color: #ffdce0;
    .status-prefix { color: var(--accent-magenta); }
  }
  
  &.success {
    background-color: #e0f8cf;
  }
}

.msg-content {
  font-family: var(--font-body);
  font-size: 1.2rem;
  color: var(--text-dark);
  margin: 0;
  line-height: 1.4;
  
  p { margin: 0; }
}

.msg-arrow {
  position: absolute;
  bottom: 8px;
  right: 12px;
  width: 0;
  height: 0;
  border-left: 8px solid transparent;
  border-right: 8px solid transparent;
  border-top: 8px solid var(--text-dark);
  animation: bounce 0.6s infinite alternate;
}

@keyframes bounce {
  from { transform: translateY(0); }
  to { transform: translateY(4px); }
}

// Retro Transitions
.gba-msg-enter-active,
.gba-msg-leave-active {
  transition: all 0.3s steps(5);
}
.gba-msg-enter-from {
  opacity: 0;
  transform: translateY(40px);
}
.gba-msg-leave-to {
  opacity: 0;
  transform: scale(0.9);
}
</style>
