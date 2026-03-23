<script setup lang="ts">
interface InsightBadgeStripProps {
  critical: number;
  warning: number;
  info: number;
}

const props = defineProps<InsightBadgeStripProps>();
</script>

<template>
  <div v-if="props.critical > 0 || props.warning > 0 || props.info > 0" class="insight-badge-strip">
    <span
      v-if="props.critical > 0"
      class="insight-badge insight-badge--critical"
      :title="`${props.critical} critical insight${props.critical > 1 ? 's' : ''}`"
    >
      !{{ props.critical }}
    </span>
    <span
      v-if="props.warning > 0"
      class="insight-badge insight-badge--warning"
      :title="`${props.warning} warning insight${props.warning > 1 ? 's' : ''}`"
    >
      ~{{ props.warning }}
    </span>
    <span
      v-if="props.info > 0"
      class="insight-badge insight-badge--info"
      :title="`${props.info} info insight${props.info > 1 ? 's' : ''}`"
    >
      i{{ props.info }}
    </span>
  </div>
</template>

<style scoped>
.insight-badge-strip {
  display: flex;
  gap: 0.25rem;
  padding: 0.15rem 0.5rem 0.25rem;
}

.insight-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.05rem 0.3rem;
  border-radius: 0.2rem;
  font-size: 0.6rem;
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: 0.02em;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.insight-badge--critical {
  background-color: var(--graph-insight-critical-bg);
  color: var(--graph-insight-critical-text);
}

.insight-badge--warning {
  background-color: var(--graph-insight-warning-bg);
  color: var(--graph-insight-warning-text);
}

.insight-badge--info {
  background-color: var(--graph-insight-info-bg);
  color: var(--graph-insight-info-text);
}
</style>
