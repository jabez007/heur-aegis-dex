<script setup lang="ts">
defineProps<{
  type: string;
  size?: 'mini' | 'normal' | 'header';
  isQuad?: boolean;
}>();
</script>

<template>
  <span 
    class="type-badge" 
    :class="[
      'bg-' + type.toLowerCase(),
      size || 'normal',
      { quad: isQuad }
    ]"
  >
    <slot>{{ type }}</slot>
  </span>
</template>

<style lang="scss" scoped>
.type-badge {
  display: inline-block;
  text-transform: uppercase;
  color: var(--gba-text-white);
  text-shadow: 1px 1px 1px var(--gba-shadow-dark);
  border: 2px solid var(--gba-text-dark);
  box-shadow: 1px 1px 0px var(--gba-text-dark);
  font-family: var(--gba-font-body);
  transition: transform 0.1s;
  
  // Sizes
  &.mini {
    font-size: 0.65rem;
    padding: 1px 4px;
    border-width: 1px;
  }
  
  &.normal {
    font-size: 0.8rem;
    padding: 2px 8px;
    margin: 2px;
  }
  
  &.header {
    padding: 4px 12px;
    font-size: 1rem;
    border-width: 3px;
    box-shadow: 2px 2px 0px var(--gba-text-dark);
    font-family: var(--gba-font-heading);
    text-shadow: 1px 1px 2px var(--gba-shadow-dark);
  }

  &.quad {
    border: 2px dashed var(--gba-accent-yellow);
    box-shadow: 2px 2px 0px var(--gba-accent-magenta);
    animation: quad-pulse 1s infinite alternate;
  }
}

@keyframes quad-pulse {
  from { transform: scale(1.05) rotate(-2deg); }
  to { transform: scale(1.1) rotate(2deg); }
}
</style>
