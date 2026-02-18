# Data Package Agent

## Overview

Guidance for data layer packages handling API clients, stores, and domain types.
This package is the PRIMARY source of truth for all domain data.

## Directory Structure

- `src/api/` - API client and service modules
- `src/stores/` - Pinia composition stores (PRIMARY data interface)
- `src/types/` - Canonical domain model interfaces
- `src/helpers/` - Utilities, breadcrumbs, logging
- `src/transformers/` - DTO to domain model converters

## Store Patterns

### Pinia Composition API Setup

```typescript
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { consola } from 'consola';

const logger = consola.withTag('example-store');

export const useExampleStore = defineStore('example', () => {
  // State
  const items = ref<Example[]>([]);
  const loading = ref(false);
  const error = ref<Error | null>(null);

  // Getters
  const itemCount = computed(() => items.value.length);

  // Actions
  async function fetchItems() {
    loading.value = true;
    try {
      items.value = await api.getItems();
      logger.info('Items fetched', { count: items.value.length });
    } catch (e) {
      error.value = e as Error;
      logger.error('Failed to fetch items', e);
    } finally {
      loading.value = false;
    }
  }

  return { items, loading, error, itemCount, fetchItems };
});

// Re-export types at bottom of file
export type { Example, ExampleFilter } from '../types';
```

### TTL Caching Pattern

```typescript
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const lastFetch = ref<number>(0);

async function fetchWithCache() {
  if (Date.now() - lastFetch.value < CACHE_TTL && items.value.length > 0) {
    return; // Use cached data
  }
  await fetchItems();
  lastFetch.value = Date.now();
}
```

## API Client Patterns

### Axios Configuration

```typescript
import axios from 'axios';

const client = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  timeout: 30000,
});

// Auth interceptor
client.interceptors.request.use((config) => {
  const token = getAuthToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Typed helpers
export async function get<T>(url: string): Promise<T> {
  const { data } = await client.get<T>(url);
  return data;
}
```

## Type Definitions

- Entity interfaces (domain models)
- Request/Response DTOs
- Filter/Query types
- Pagination metadata

## Critical Rules

- Components MUST import from stores, not types directly
- Stores re-export their relevant types
- ESLint rule `no-direct-data-import` enforces this
- Use consola for all logging
- No dynamic imports
