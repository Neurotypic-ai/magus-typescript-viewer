<script setup lang="ts">
import InsightsDashboard from './InsightsDashboard.vue';
</script>

<template>
  <div class="insights-panel-shell bg-background-paper rounded-lg border border-border-default shadow-xl">
    <div class="section">
      <div class="section-header-static">
        <span class="section-label">Insights</span>
      </div>
      <InsightsDashboard class="insights-embedded" />
    </div>
  </div>
</template>

<style scoped>
.insights-panel-shell {
  width: min(20rem, calc(100vw - 1.5rem));
  padding: 0.68rem 0.68rem 0.92rem;
}

.section {
  margin: 0;
}

.section-header-static {
  display: flex;
  align-items: center;
  min-height: 1.8rem;
  padding: 0.28rem 0.34rem;
}

.section-label {
  font-size: 0.84rem;
  font-weight: 650;
  color: var(--color-text-primary, currentColor);
  letter-spacing: 0.01em;
}

.insights-embedded :deep(.insights-dashboard) {
  border: none;
  background: transparent;
  box-shadow: none;
  border-radius: 0;
  padding: 0;
  max-width: none;
}
</style>
