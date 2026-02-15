<script setup lang="ts">
import { computed } from 'vue';

import { useIssuesStore } from '../stores/issuesStore';

const issuesStore = useIssuesStore();

const displayIssues = computed(() => issuesStore.filteredIssues);
const hasFilter = computed(() => issuesStore.selectedNodeFilter !== null);
const preview = computed(() => issuesStore.previewResult);

function severityIcon(severity: string): string {
  switch (severity) {
    case 'error':
      return '!';
    case 'warning':
      return '\u26A0';
    default:
      return '\u2139';
  }
}

function severityClass(severity: string): string {
  switch (severity) {
    case 'error':
      return 'issue-severity-error';
    case 'warning':
      return 'issue-severity-warning';
    default:
      return 'issue-severity-info';
  }
}

async function handlePreview(issueId: string): Promise<void> {
  await issuesStore.previewRefactor(issueId);
}

async function handleApply(issueId: string): Promise<void> {
  const success = await issuesStore.executeRefactor(issueId);
  if (success) {
    // Could add a toast here in the future
  }
}

function clearFilter(): void {
  issuesStore.setNodeFilter(null);
}

function closePanel(): void {
  issuesStore.togglePanel();
}
</script>

<template>
  <div class="issues-panel">
    <div class="issues-panel-header">
      <div class="issues-panel-title">
        <span>Issues</span>
        <span class="issues-panel-count">{{ displayIssues.length }}</span>
      </div>
      <div class="issues-panel-actions">
        <button v-if="hasFilter" type="button" class="issues-panel-btn" title="Clear filter" @click="clearFilter">
          Clear
        </button>
        <button type="button" class="issues-panel-btn" title="Close panel" @click="closePanel">
          &times;
        </button>
      </div>
    </div>

    <div v-if="preview" class="issues-preview">
      <div class="issues-preview-header">
        <span>Preview</span>
        <button type="button" class="issues-panel-btn" @click="issuesStore.previewResult = null">Close</button>
      </div>
      <div class="issues-preview-sections">
        <div class="issues-preview-section">
          <div class="issues-preview-label">Before</div>
          <pre class="issues-preview-code">{{ preview.original }}</pre>
        </div>
        <div class="issues-preview-section">
          <div class="issues-preview-label">After</div>
          <pre class="issues-preview-code issues-preview-code--after">{{ preview.transformed }}</pre>
        </div>
      </div>
    </div>

    <div v-if="displayIssues.length === 0" class="issues-empty">
      <span v-if="hasFilter">No issues for this node.</span>
      <span v-else>No code issues found.</span>
    </div>

    <div v-else class="issues-list">
      <div v-for="issue in displayIssues" :key="issue.id" class="issue-item">
        <div class="issue-header">
          <span :class="['issue-severity', severityClass(issue.severity)]">
            {{ severityIcon(issue.severity) }}
          </span>
          <span class="issue-location">
            <template v-if="issue.parent_entity_name">{{ issue.parent_entity_name }}.</template>
            <template v-if="issue.property_name">{{ issue.property_name }}</template>
          </span>
        </div>
        <div class="issue-message">{{ issue.message }}</div>
        <div v-if="issue.suggestion" class="issue-suggestion">{{ issue.suggestion }}</div>
        <div v-if="issue.refactor_action" class="issue-actions">
          <button type="button" class="issue-btn issue-btn--preview" @click="handlePreview(issue.id)">
            Preview
          </button>
          <button type="button" class="issue-btn issue-btn--apply" @click="handleApply(issue.id)">
            Apply Fix
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.issues-panel {
  width: 320px;
  height: 100%;
  background-color: var(--background-node);
  border-left: 1px solid var(--border-default);
  display: flex;
  flex-direction: column;
  font-size: 0.8rem;
  overflow: hidden;
}

.issues-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--border-default);
  flex-shrink: 0;
}

.issues-panel-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 600;
  font-size: 0.875rem;
  color: var(--text-primary);
}

.issues-panel-count {
  background-color: rgba(251, 191, 36, 0.2);
  color: rgb(251, 191, 36);
  padding: 0.1rem 0.4rem;
  border-radius: 0.25rem;
  font-size: 0.7rem;
  font-weight: 700;
}

.issues-panel-actions {
  display: flex;
  gap: 0.25rem;
}

.issues-panel-btn {
  background: none;
  border: 1px solid var(--border-default);
  color: var(--text-secondary);
  padding: 0.15rem 0.4rem;
  border-radius: 0.25rem;
  cursor: pointer;
  font-size: 0.75rem;
}

.issues-panel-btn:hover {
  background-color: rgba(255, 255, 255, 0.05);
  color: var(--text-primary);
}

.issues-empty {
  padding: 1.5rem 0.75rem;
  text-align: center;
  color: var(--text-secondary);
  font-size: 0.8rem;
}

.issues-list {
  flex: 1;
  overflow-y: auto;
  padding: 0.25rem 0;
}

.issue-item {
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.issue-item:hover {
  background-color: rgba(255, 255, 255, 0.02);
}

.issue-header {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin-bottom: 0.25rem;
}

.issue-severity {
  font-size: 0.75rem;
  flex-shrink: 0;
}

.issue-severity-error {
  color: #ef4444;
}

.issue-severity-warning {
  color: #fbbf24;
}

.issue-severity-info {
  color: #60a5fa;
}

.issue-location {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.7rem;
  color: var(--text-secondary);
}

.issue-message {
  color: var(--text-primary);
  font-size: 0.75rem;
  line-height: 1.3;
  margin-bottom: 0.2rem;
}

.issue-suggestion {
  color: rgb(94, 234, 212);
  font-size: 0.7rem;
  font-style: italic;
  margin-bottom: 0.35rem;
}

.issue-actions {
  display: flex;
  gap: 0.35rem;
  margin-top: 0.25rem;
}

.issue-btn {
  padding: 0.2rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.7rem;
  cursor: pointer;
  border: 1px solid var(--border-default);
  background: none;
  color: var(--text-secondary);
}

.issue-btn:hover {
  background-color: rgba(255, 255, 255, 0.05);
  color: var(--text-primary);
}

.issue-btn--apply {
  border-color: rgba(94, 234, 212, 0.3);
  color: rgb(94, 234, 212);
}

.issue-btn--apply:hover {
  background-color: rgba(94, 234, 212, 0.1);
}

.issues-preview {
  border-bottom: 1px solid var(--border-default);
  max-height: 50%;
  overflow-y: auto;
  flex-shrink: 0;
}

.issues-preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.35rem 0.75rem;
  font-weight: 600;
  font-size: 0.75rem;
  color: var(--text-primary);
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.issues-preview-sections {
  padding: 0.5rem 0.75rem;
}

.issues-preview-section {
  margin-bottom: 0.5rem;
}

.issues-preview-label {
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: 700;
  color: var(--text-secondary);
  margin-bottom: 0.2rem;
}

.issues-preview-code {
  background-color: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--border-default);
  border-radius: 0.25rem;
  padding: 0.5rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.65rem;
  line-height: 1.4;
  color: var(--text-primary);
  overflow-x: auto;
  white-space: pre;
  max-height: 200px;
  overflow-y: auto;
}

.issues-preview-code--after {
  border-color: rgba(94, 234, 212, 0.2);
}
</style>
