import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import { getApiBaseUrl } from '../assemblers/api';

import type { CodeIssueRef } from '../types/CodeIssueRef';

export const useIssuesStore = defineStore('issues', () => {
  const issues = ref<CodeIssueRef[]>([]);
  const panelOpen = ref(false);
  const selectedNodeFilter = ref<string | null>(null);
  const previewResult = ref<{ original: string; transformed: string } | null>(null);

  const issuesByModuleId = computed(() => {
    const map = new Map<string, CodeIssueRef[]>();
    for (const issue of issues.value) {
      let arr = map.get(issue.module_id);
      if (!arr) {
        arr = [];
        map.set(issue.module_id, arr);
      }
      arr.push(issue);
    }
    return map;
  });

  const issuesByEntityId = computed(() => {
    const map = new Map<string, CodeIssueRef[]>();
    for (const issue of issues.value) {
      const entityId = issue.entity_id ?? issue.parent_entity_id;
      if (!entityId) continue;
      let arr = map.get(entityId);
      if (!arr) {
        arr = [];
        map.set(entityId, arr);
      }
      arr.push(issue);

      // Also index by parent entity if different from entity
      if (issue.parent_entity_id && issue.parent_entity_id !== entityId) {
        let parentArr = map.get(issue.parent_entity_id);
        if (!parentArr) {
          parentArr = [];
          map.set(issue.parent_entity_id, parentArr);
        }
        parentArr.push(issue);
      }
    }
    return map;
  });

  const issueCountByNodeId = computed(() => {
    const map = new Map<string, number>();
    for (const issue of issues.value) {
      // Count by module
      map.set(issue.module_id, (map.get(issue.module_id) ?? 0) + 1);
      // Count by entity
      if (issue.entity_id) {
        map.set(issue.entity_id, (map.get(issue.entity_id) ?? 0) + 1);
      }
      if (issue.parent_entity_id) {
        map.set(issue.parent_entity_id, (map.get(issue.parent_entity_id) ?? 0) + 1);
      }
    }
    return map;
  });

  const filteredIssues = computed(() => {
    if (!selectedNodeFilter.value) return issues.value;
    const nodeId = selectedNodeFilter.value;
    return issues.value.filter(
      (issue) =>
        issue.module_id === nodeId ||
        issue.entity_id === nodeId ||
        issue.parent_entity_id === nodeId
    );
  });

  async function fetchIssues(): Promise<void> {
    try {
      const baseUrl = getApiBaseUrl();
      const response = await fetch(`${baseUrl}/issues`);
      if (!response.ok) {
        issues.value = [];
        return;
      }
      const data = (await response.json()) as CodeIssueRef[];
      issues.value = Array.isArray(data) ? data : [];
    } catch {
      issues.value = [];
    }
  }

  async function previewRefactor(issueId: string): Promise<void> {
    try {
      const baseUrl = getApiBaseUrl();
      const response = await fetch(`${baseUrl}/refactor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueId, preview: true }),
      });
      if (!response.ok) {
        previewResult.value = null;
        return;
      }
      const data = (await response.json()) as {
        success: boolean;
        originalSource?: string;
        transformedSource?: string;
        error?: string;
      };
      if (data.success && data.originalSource && data.transformedSource) {
        previewResult.value = {
          original: data.originalSource,
          transformed: data.transformedSource,
        };
      } else {
        previewResult.value = null;
      }
    } catch {
      previewResult.value = null;
    }
  }

  async function executeRefactor(issueId: string): Promise<boolean> {
    try {
      const baseUrl = getApiBaseUrl();
      const response = await fetch(`${baseUrl}/refactor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueId, preview: false }),
      });
      if (!response.ok) return false;
      const data = (await response.json()) as { success: boolean };
      if (data.success) {
        // Remove the applied issue from the local store
        issues.value = issues.value.filter((i) => i.id !== issueId);
        previewResult.value = null;
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  function setNodeFilter(id: string | null): void {
    selectedNodeFilter.value = id;
    if (id) {
      panelOpen.value = true;
    }
  }

  function togglePanel(): void {
    panelOpen.value = !panelOpen.value;
    if (!panelOpen.value) {
      selectedNodeFilter.value = null;
      previewResult.value = null;
    }
  }

  return {
    issues,
    panelOpen,
    selectedNodeFilter,
    previewResult,
    issuesByModuleId,
    issuesByEntityId,
    issueCountByNodeId,
    filteredIssues,
    fetchIssues,
    previewRefactor,
    executeRefactor,
    setNodeFilter,
    togglePanel,
  };
});
