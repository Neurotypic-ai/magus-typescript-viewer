<script setup lang="ts">
import { computed, ref } from "vue";

import BaseNode from "./BaseNode.vue";

import type { DependencyProps } from "../types";

const props = defineProps<DependencyProps>();

const nodeData = computed(() => props.data);
const nodeType = computed(() => props.type);

// Collapsible sections state
const isPropertiesExpanded = ref(true);
const isMethodsExpanded = ref(true);

const toggleProperties = () => {
  isPropertiesExpanded.value = !isPropertiesExpanded.value;
};

const toggleMethods = () => {
  isMethodsExpanded.value = !isMethodsExpanded.value;
};

// Compute visibility color class and icon
const getVisibilityColor = (visibility: string) => {
  if (visibility === "public") return "visibility-public-symbol";
  if (visibility === "protected") return "visibility-protected-symbol";
  return "visibility-private-symbol";
};

const getVisibilitySymbol = (visibility: string) => {
  if (visibility === "public") return "+";
  if (visibility === "protected") return "#";
  return "-";
};

// Get type-specific styling
const getTypeColor = computed(() => {
  switch (nodeType.value) {
    case "class":
      return "type-class";
    case "interface":
      return "type-interface";
    case "enum":
      return "type-enum";
    case "type":
      return "type-type";
    default:
      return "type-default";
  }
});

const hasContent = computed(() => {
  const hasProps =
    nodeData.value.properties && nodeData.value.properties.length > 0;
  const hasMethods =
    nodeData.value.methods && nodeData.value.methods.length > 0;
  return hasProps || hasMethods;
});

// Badge text is the node type uppercased
const badgeText = computed(() => String(nodeType.value).toUpperCase());
</script>

<template>
  <BaseNode
    v-bind="props"
    :badge-text="badgeText"
    :badge-class="getTypeColor"
    :z-index="2"
    min-width="280px"
    max-width="450px"
  >
    <template #content>
      <!-- Node Content -->
      <div v-if="hasContent" class="symbol-content">
        <!-- Properties Section -->
        <div
          v-if="nodeData.properties && nodeData.properties.length > 0"
          class="collapsible-section"
        >
          <!-- Collapsible Header -->
          <button
            class="collapsible-header"
            @click="toggleProperties"
            type="button"
            :aria-expanded="isPropertiesExpanded"
            aria-label="Toggle properties section"
          >
            <div class="collapsible-header-label">
              <span class="section-title">Properties</span>
              <span class="section-count"
                >({{ nodeData.properties.length }})</span
              >
            </div>
            <svg
              class="collapsible-icon"
              :class="{ 'collapsible-icon-expanded': isPropertiesExpanded }"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>

          <!-- Collapsible Content -->
          <div v-show="isPropertiesExpanded" class="collapsible-content">
            <div
              v-for="(prop, index) in nodeData.properties"
              :key="index"
              class="member-item"
            >
              <span
                v-if="prop.visibility"
                :class="['visibility-dot', getVisibilityColor(prop.visibility)]"
                :title="`${prop.visibility} visibility`"
              ></span>
              <span
                v-if="prop.visibility"
                class="visibility-symbol"
                :title="`${prop.visibility} visibility`"
              >
                {{ getVisibilitySymbol(prop.visibility) }}
              </span>
              <div class="member-signature">
                <span class="member-name">{{ prop.name }}</span>
                <span class="member-separator">: </span>
                <span class="member-type-property" :title="prop.type">{{
                  prop.type
                }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Methods Section -->
        <div
          v-if="nodeData.methods && nodeData.methods.length > 0"
          class="collapsible-section"
        >
          <!-- Collapsible Header -->
          <button
            class="collapsible-header"
            @click="toggleMethods"
            type="button"
            :aria-expanded="isMethodsExpanded"
            aria-label="Toggle methods section"
          >
            <div class="collapsible-header-label">
              <span class="section-title">Methods</span>
              <span class="section-count">({{ nodeData.methods.length }})</span>
            </div>
            <svg
              class="collapsible-icon"
              :class="{ 'collapsible-icon-expanded': isMethodsExpanded }"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>

          <!-- Collapsible Content -->
          <div v-show="isMethodsExpanded" class="collapsible-content">
            <div
              v-for="(method, index) in nodeData.methods"
              :key="index"
              class="member-item"
            >
              <span
                v-if="method.visibility"
                :class="[
                  'visibility-dot',
                  getVisibilityColor(method.visibility),
                ]"
                :title="`${method.visibility} visibility`"
              ></span>
              <span
                v-if="method.visibility"
                class="visibility-symbol"
                :title="`${method.visibility} visibility`"
              >
                {{ getVisibilitySymbol(method.visibility) }}
              </span>
              <div class="member-signature">
                <span class="member-name">{{ method.name }}</span>
                <span class="member-separator">()</span>
                <span class="member-separator">: </span>
                <span class="member-type-method" :title="method.returnType">{{
                  method.returnType
                }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <template #empty>
      <!-- Empty State -->
      <div v-if="!hasContent" class="symbol-empty-state">
        No properties or methods
      </div>
    </template>
  </BaseNode>
</template>

<style scoped>
/* Type-specific Badge Colors */
.type-class {
  background-color: rgba(59, 130, 246, 0.2);
  color: rgb(147, 197, 253);
}

.type-interface {
  background-color: rgba(168, 85, 247, 0.2);
  color: rgb(216, 180, 254);
}

.type-enum {
  background-color: rgba(249, 115, 22, 0.2);
  color: rgb(253, 186, 116);
}

.type-type {
  background-color: rgba(20, 184, 166, 0.2);
  color: rgb(94, 234, 212);
}

.type-default {
  background-color: rgba(255, 255, 255, 0.1);
  color: var(--text-secondary);
}

/* Collapsible Section */
.collapsible-section {
  border-bottom: 1px solid rgba(var(--border-default-rgb), 0.5);
}

.collapsible-header {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  transition: background-color 200ms;
  text-align: left;
  background: transparent;
  border: none;
  cursor: pointer;
}

.collapsible-header:hover {
  background-color: rgba(255, 255, 255, 0.05);
}

.collapsible-header-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.section-title {
  color: var(--text-secondary);
  font-size: 0.625rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.025em;
}

.section-count {
  color: rgba(var(--text-secondary-rgb), 0.6);
  font-size: 0.625rem;
}

.collapsible-icon {
  width: 0.75rem;
  height: 0.75rem;
  color: var(--text-secondary);
  transition: transform 200ms;
}

.collapsible-icon-expanded {
  transform: rotate(180deg);
}

.collapsible-content {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  padding: 0 0.75rem 0.75rem 0.75rem;
  max-height: 200px;
  overflow-y: auto;
  animation: fade-in 200ms ease-out, slide-in-from-top 200ms ease-out;
}

/* Custom Scrollbar */
.collapsible-content::-webkit-scrollbar {
  width: 6px;
}

.collapsible-content::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 3px;
}

.collapsible-content::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 3px;
}

.collapsible-content::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.3);
}

/* Member Item */
.member-item {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  font-size: 0.75rem;
  line-height: 1rem;
  padding: 0.375rem;
  border-radius: 0.25rem;
  transition: background-color 200ms;
}

.member-item:hover {
  background-color: rgba(255, 255, 255, 0.05);
}

/* Visibility Indicators */
.visibility-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 9999px;
  flex-shrink: 0;
  margin-top: 0.25rem;
}

.visibility-public-symbol {
  background-color: rgb(34, 197, 94);
}

.visibility-protected-symbol {
  background-color: rgb(234, 179, 8);
}

.visibility-private-symbol {
  background-color: rgb(239, 68, 68);
}

.visibility-symbol {
  color: rgba(var(--text-secondary-rgb), 0.6);
  font-family: ui-monospace, monospace;
  font-size: 0.625rem;
  flex-shrink: 0;
  width: 1rem;
}

/* Member Signature */
.member-signature {
  flex: 1;
  min-width: 0;
  font-family: ui-monospace, monospace;
}

.member-name {
  color: var(--text-primary);
  font-weight: 600;
}

.member-separator {
  color: var(--text-secondary);
}

.member-type-property {
  color: rgb(147, 197, 253);
  word-break: break-all;
}

.member-type-method {
  color: rgb(134, 239, 172);
}

/* Empty State */
.symbol-empty-state {
  padding: 1rem;
  text-align: center;
  color: var(--text-secondary);
  font-size: 0.75rem;
  line-height: 1rem;
  font-style: italic;
  opacity: 0.6;
}
</style>
