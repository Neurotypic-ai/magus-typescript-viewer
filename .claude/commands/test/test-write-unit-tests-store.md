# Write Unit Tests for a Store

Add comprehensive Vitest unit tests for a data-layer Pinia store.

## Input Needed

- **Store name**: Which store to test (e.g., `transactions`, `budgets`)
- **Actions to test**: Which store actions need coverage
- **Edge cases**: Specific scenarios to cover

## Files to Touch

- `packages/data/src/stores/__tests__/<storeName>.test.ts`

## Instructions

1. **Read the rules first**:
   - [unit-testing.mdc](mdc:.cursor/rules/unit-testing.mdc) for test patterns
   - [stores-patterns.mdc](mdc:.cursor/rules/stores-patterns.mdc) for store patterns

2. **Set up the test file**:

   ```typescript
   // packages/data/src/stores/__tests__/budgets.test.ts

   import { describe, it, expect, beforeEach, vi } from 'vitest';
   import { setActivePinia, createPinia } from 'pinia';
   import { useBudgetsStore } from '../budgets';

   // Mock the API service
   vi.mock('../../api/services/budget.service', () => ({
     budgetService: {
       getAll: vi.fn(),
       getById: vi.fn(),
       create: vi.fn(),
       update: vi.fn(),
       delete: vi.fn(),
     },
   }));

   // Mock consola
   vi.mock('consola', () => ({
     consola: {
       withTag: vi.fn(() => ({
         debug: vi.fn(),
         info: vi.fn(),
         success: vi.fn(),
         warn: vi.fn(),
         error: vi.fn(),
       })),
     },
   }));

   import { budgetService } from '../../api/services/budget.service';
   ```

3. **Structure tests by action**:

   ```typescript
   describe('useBudgetsStore', () => {
     let store: ReturnType<typeof useBudgetsStore>;

     beforeEach(() => {
       setActivePinia(createPinia());
       store = useBudgetsStore();
       vi.clearAllMocks();
     });

     describe('initial state', () => {
       it('has empty items array', () => {
         expect(store.items).toEqual([]);
       });

       it('is not loading', () => {
         expect(store.loading).toBe(false);
       });

       it('has no error', () => {
         expect(store.error).toBeNull();
       });

       it('isEmpty returns true', () => {
         expect(store.isEmpty).toBe(true);
       });

       it('isStale returns true', () => {
         expect(store.isStale).toBe(true);
       });
     });

     describe('fetchAll', () => {
       const mockBudgets = [
         { id: '1', categoryId: 'cat-1', amountCents: 50000 },
         { id: '2', categoryId: 'cat-2', amountCents: 30000 },
       ];

       it('fetches and stores items', async () => {
         vi.mocked(budgetService.getAll).mockResolvedValue(mockBudgets);

         const result = await store.fetchAll();

         expect(budgetService.getAll).toHaveBeenCalledTimes(1);
         expect(store.items).toEqual(mockBudgets);
         expect(result).toEqual(mockBudgets);
       });

       it('sets loading state during fetch', async () => {
         vi.mocked(budgetService.getAll).mockImplementation(
           () => new Promise((resolve) => setTimeout(() => resolve([]), 10))
         );

         const promise = store.fetchAll();
         expect(store.loading).toBe(true);

         await promise;
         expect(store.loading).toBe(false);
       });

       it('sets error on failure', async () => {
         vi.mocked(budgetService.getAll).mockRejectedValue(new Error('Network error'));

         await expect(store.fetchAll()).rejects.toThrow('Network error');
         expect(store.error).toBe('Network error');
       });

       it('returns cached data when not stale', async () => {
         vi.mocked(budgetService.getAll).mockResolvedValue(mockBudgets);

         await store.fetchAll();
         vi.clearAllMocks();

         const result = await store.fetchAll();

         expect(budgetService.getAll).not.toHaveBeenCalled();
         expect(result).toEqual(mockBudgets);
       });

       it('force=true bypasses cache', async () => {
         vi.mocked(budgetService.getAll).mockResolvedValue(mockBudgets);

         await store.fetchAll();
         vi.clearAllMocks();

         await store.fetchAll(true);

         expect(budgetService.getAll).toHaveBeenCalledTimes(1);
       });
     });

     describe('create', () => {
       it('creates and adds item to store', async () => {
         const newBudget = { id: '3', categoryId: 'cat-3', amountCents: 25000 };
         vi.mocked(budgetService.create).mockResolvedValue(newBudget);

         const result = await store.create({ categoryId: 'cat-3', amountCents: 25000 });

         expect(result).toEqual(newBudget);
         expect(store.items).toContainEqual(newBudget);
       });
     });

     describe('update', () => {
       it('updates existing item in store', async () => {
         store.items = [{ id: '1', categoryId: 'cat-1', amountCents: 50000 }];
         const updated = { id: '1', categoryId: 'cat-1', amountCents: 60000 };
         vi.mocked(budgetService.update).mockResolvedValue(updated);

         const result = await store.update('1', { amountCents: 60000 });

         expect(result).toEqual(updated);
         expect(store.items[0].amountCents).toBe(60000);
       });
     });

     describe('remove', () => {
       it('removes item from store', async () => {
         store.items = [
           { id: '1', categoryId: 'cat-1', amountCents: 50000 },
           { id: '2', categoryId: 'cat-2', amountCents: 30000 },
         ];
         vi.mocked(budgetService.delete).mockResolvedValue(undefined);

         await store.remove('1');

         expect(store.items).toHaveLength(1);
         expect(store.items[0].id).toBe('2');
       });
     });

     describe('getById', () => {
       it('returns item when found', () => {
         store.items = [{ id: '1', categoryId: 'cat-1', amountCents: 50000 }];

         const result = store.getById('1');

         expect(result?.id).toBe('1');
       });

       it('returns undefined when not found', () => {
         store.items = [];

         const result = store.getById('nonexistent');

         expect(result).toBeUndefined();
       });
     });

     describe('$reset', () => {
       it('resets all state', async () => {
         store.items = [{ id: '1' }];
         store.loading = true;
         store.error = 'some error';

         store.$reset();

         expect(store.items).toEqual([]);
         expect(store.loading).toBe(false);
         expect(store.error).toBeNull();
         expect(store.lastFetched).toBeNull();
       });
     });
   });
   ```

4. **Test async error handling**:

   ```typescript
   it('handles API errors gracefully', async () => {
     vi.mocked(budgetService.getAll).mockRejectedValue(new Error('Server error'));

     await expect(store.fetchAll()).rejects.toThrow();

     expect(store.loading).toBe(false);
     expect(store.error).toBe('Server error');
   });
   ```

5. **Test computed/derived state**:

   ```typescript
   describe('computed state', () => {
     it('isEmpty reflects items length', () => {
       expect(store.isEmpty).toBe(true);
       store.items = [{ id: '1' }];
       expect(store.isEmpty).toBe(false);
     });

     it('totalBudgeted sums all amounts', () => {
       store.items = [
         { id: '1', amountCents: 10000 },
         { id: '2', amountCents: 20000 },
       ];
       expect(store.totalBudgeted).toBe(30000);
     });
   });
   ```

## Test Patterns

| What to Test | Pattern |
| -------------- | --------- |
| Initial state | Check refs have correct defaults |
| Success path | Mock resolved value, check state updates |
| Error path | Mock rejected value, check error state |
| Loading state | Check loading before/after async |
| Caching | Verify API not called when cache fresh |
| Mutations | Verify local state updates correctly |
| Computed | Verify derived values are correct |

## Acceptance Checklist

- [ ] Test file created in `__tests__/` directory
- [ ] API service mocked with `vi.mock()`
- [ ] Consola mocked to prevent console noise
- [ ] `beforeEach` creates fresh Pinia instance
- [ ] Initial state tested
- [ ] All CRUD actions tested (success + error)
- [ ] Loading state transitions tested
- [ ] Caching behavior tested
- [ ] `$reset()` tested
- [ ] Computed/getters tested
- [ ] All tests pass (`pnpm test`)
