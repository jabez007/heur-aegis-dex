<script setup lang="ts">
const props = defineProps<{
  label: string;
  value: number;
  max?: number;
}>();

const getStatColor = (val: number) => {
  if (val < 60) return '#f34444'; // Red
  if (val < 90) return '#ffdd57'; // Yellow
  if (val < 120) return '#a0e515'; // Light Green
  return '#23cd5e'; // Deep Green
};
</script>

<template>
  <div class="stat-row">
    <span class="stat-label">{{ label }}:</span>
    <div class="bar-container">
      <div 
        class="bar" 
        :style="{ 
          width: Math.min(100, (value / (max || 150) * 100)) + '%', 
          backgroundColor: getStatColor(value) 
        }"
      ></div>
    </div>
    <span class="stat-val">{{ value }}</span>
  </div>
</template>

<style lang="scss" scoped>
.stat-row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 2px;
}

.stat-label {
  font-family: var(--font-heading);
  font-size: 0.8rem;
  width: 35px;
  text-align: right;
  text-transform: uppercase;
}

.bar-container {
  flex-grow: 1;
  height: 8px;
  background: rgba(0,0,0,0.1);
  border: 1px solid var(--text-dark);
}

.bar {
  height: 100%;
  transition: width 0.3s ease;
}

.stat-val {
  font-family: var(--font-body);
  font-size: 0.7rem;
  width: 25px;
  text-align: right;
}
</style>
