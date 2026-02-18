# Vue Application Agent

## Overview
Guidance for Vue 3 applications using Composition API, Pinia, and Vue Router.

## Directory Structure
- `src/views/` - Top-level route views
- `src/components/` - Vue components (ui/, features/)
- `src/composables/` - Reusable composition functions
- `src/stores/` - UI-only Pinia stores
- `src/router/` - Vue Router configuration
- `src/lib/` - App-specific utilities
- `e2e/` - Playwright E2E tests

## Component Patterns

### Script Setup Template
```vue
<script setup lang="ts">
import { ref, computed } from 'vue';
import { useExampleStore } from '@neurotypic-ai/data/stores/example';

interface Props {
  title: string;
  variant?: 'default' | 'primary';
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'default',
});

const emit = defineEmits<{
  submit: [data: FormData];
}>();

const store = useExampleStore();
const localState = ref('');

const computedValue = computed(() => {
  return props.title.toUpperCase();
});
</script>

<template>
  <div>
    <h1>{{ computedValue }}</h1>
    <slot />
  </div>
</template>
```

## Store Architecture

### UI Stores (App-Level)
App stores handle UI state ONLY:
- Modal visibility
- Navigation state
- UI preferences
- Form state

```typescript
// apps/{{APP_NAME}}/src/stores/ui.ts
export const useUIStore = defineStore('ui', () => {
  const sidebarOpen = ref(false);
  const activeModal = ref<string | null>(null);

  return { sidebarOpen, activeModal };
});
```

### Data Layer Integration
Import domain data from data layer stores:
```typescript
import { useTransactionsStore } from '@neurotypic-ai/data/stores/transactions';
import type { Transaction } from '@neurotypic-ai/data/stores/transactions';

const store = useTransactionsStore();
await store.fetchTransactions();
```

## Routing Patterns

### Lazy Loading (ONLY place for dynamic imports)
```typescript
const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: () => import('../views/HomeView.vue'),
  },
  {
    path: '/dashboard',
    component: () => import('../views/DashboardView.vue'),
    meta: { requiresAuth: true },
  },
];
```

### Route Guards
```typescript
router.beforeEach((to, from) => {
  const authStore = useAuthStore();
  if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    return { name: 'login' };
  }
});
```

## Composables Patterns

### Logger Composable
```typescript
// src/composables/useLogger.ts
import { consola } from 'consola';

export function useLogger(tag: string) {
  const logger = consola.withTag(tag);
  return { logger };
}
```

### Usage
```vue
<script setup lang="ts">
import { useLogger } from '@/composables/useLogger';

const { logger } = useLogger('MyComponent');
logger.info('Component mounted');
</script>
```

## Critical Rules
- NEVER import from `@neurotypic-ai/data` internals directly
- ONLY import from `@neurotypic-ai/data/stores/*`
- ESLint rule `no-direct-data-import` enforces this
- UI state in app stores, domain data in data layer stores
- No dynamic imports except in Vue Router routes
- Use consola for all logging
