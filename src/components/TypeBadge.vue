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
  color: #fff;
  text-shadow: 1px 1px 1px rgba(0,0,0,0.8);
  border: 2px solid var(--text-dark);
  box-shadow: 1px 1px 0px var(--text-dark);
  font-family: var(--font-body);
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
    box-shadow: 2px 2px 0px var(--text-dark);
    font-family: var(--font-heading);
    text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
  }

  &.quad {
    border: 2px dashed var(--accent-yellow);
    box-shadow: 2px 2px 0px var(--accent-magenta);
    animation: quad-pulse 1s infinite alternate;
  }
}

@keyframes quad-pulse {
  from { transform: scale(1.05) rotate(-2deg); }
  to { transform: scale(1.1) rotate(2deg); }
}
</style>
