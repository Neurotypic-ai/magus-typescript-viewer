# Add Sentry Breadcrumbs

Standardize Sentry breadcrumb capture for debugging error reports.

## Input Needed

- **File path**: Where to add breadcrumbs
- **Breadcrumb type**: Store action, user action, or network
- **What to track**: Which events need breadcrumb trail

## Files to Touch

- The target file (store, component, service)

## Instructions

1. **Read the rules first**:
   - [logging-sentry.mdc](mdc:.cursor/rules/logging-sentry.mdc) for breadcrumb patterns
   - [consola-logging.mdc](mdc:.cursor/rules/consola-logging.mdc) for logging

2. **Understand breadcrumb sources**:

   **Automatic** (no code needed):
   - Consola logs → captured automatically
   - HTTP requests → captured by API client
   - Console.error/warn → captured by Sentry
   - Vue Router navigation → captured by integration

   **Manual** (use helpers):
   - Store actions → `addStoreBreadcrumb()`
   - User interactions → `addUserActionBreadcrumb()`
   - Custom network → `addNetworkBreadcrumb()`

3. **For store actions**, use the breadcrumb helper:

   ```typescript
   import { addStoreBreadcrumb } from '@neurotypic-ai/data/helpers/breadcrumbs';

   async function fetchTransactions() {
     addStoreBreadcrumb('transactions', 'fetchAll.start');

     try {
       const data = await transactionService.getAll();
       addStoreBreadcrumb('transactions', 'fetchAll.success', { count: data.length });
       return data;
     } catch (error) {
       addStoreBreadcrumb('transactions', 'fetchAll.error', {
         message: error instanceof Error ? error.message : 'Unknown error',
       });
       throw error;
     }
   }

   async function createTransaction(request: CreateTransactionRequest) {
     addStoreBreadcrumb('transactions', 'create', {
       categoryId: request.categoryId,
       amount: request.amountCents,
     });
     // ...
   }
   ```

4. **For user actions** in components:

   ```typescript
   import { addUserActionBreadcrumb } from '@neurotypic-ai/data/helpers/breadcrumbs';

   function handleSaveClick() {
     addUserActionBreadcrumb('button.click', 'save-transaction', {
       formValid: form.isValid.value,
       hasChanges: form.isDirty.value,
     });
     // ... save logic
   }

   function handleCategorySelect(categoryId: string) {
     addUserActionBreadcrumb('select.change', 'category-picker', { categoryId });
     // ...
   }
   ```

5. **For component tracking** (optional composable):

   ```typescript
   import { useSentryBreadcrumbs } from '@/composables/useSentryBreadcrumbs';

   const { trackClick, trackInput, trackNavigation } = useSentryBreadcrumbs('TransactionForm');

   function handleSave() {
     trackClick('save-button', { hasChanges: form.isDirty.value });
     // ...
   }

   function handleCategoryChange(id: string) {
     trackInput('category-select', { categoryId: id });
     // ...
   }
   ```

6. **Direct Sentry usage** (when helpers don't fit):

   ```typescript
   import * as Sentry from '@sentry/vue';

   // Manual breadcrumb
   Sentry.addBreadcrumb({
     category: 'custom',
     message: 'Special operation started',
     level: 'info',
     data: {
       operationId: '123',
       parameters: { foo: 'bar' },
     },
   });

   // Set user context
   Sentry.setUser({
     id: user.id,
     email: user.email,
   });

   // Set custom context
   Sentry.setContext('subscription', {
     plan: 'premium',
     expiresAt: '2024-12-31',
   });

   // Set tags for filtering
   Sentry.setTag('feature', 'budgets');
   ```

7. **Capture exceptions with context**:

   ```typescript
   try {
     await riskyOperation();
   } catch (error) {
     Sentry.captureException(error, {
       tags: {
         feature: 'transactions',
         action: 'create',
       },
       contexts: {
         operation: {
           transactionId: id,
           categoryId: categoryId,
         },
       },
     });
     throw error;
   }
   ```

8. **Performance spans** (for timing):

   ```typescript
   async function expensiveOperation() {
     return await Sentry.startSpan(
       {
         op: 'db.query',
         name: 'Fetch All Transactions',
       },
       async (span) => {
         const result = await database.query();
         span.setData('resultCount', result.length);
         return result;
       }
     );
   }
   ```

## Breadcrumb Types

| Category | Use For | Helper |
| ---------- | --------- | -------- |
| `store` | Store actions | `addStoreBreadcrumb()` |
| `user` | User interactions | `addUserActionBreadcrumb()` |
| `http` | Network requests | `addNetworkBreadcrumb()` (or auto) |
| `navigation` | Route changes | Automatic |
| `console` | Console logs | Automatic via consola |

## Best Practices

**Do**:

- Add breadcrumbs at decision points
- Include relevant IDs (transaction, user, category)
- Use consistent action naming (`verb.noun`)
- Let consola handle most breadcrumbs automatically

**Don't**:

- Add breadcrumbs on every render
- Include sensitive data (passwords, tokens)
- Duplicate what consola already captures
- Add breadcrumbs in tight loops

## Acceptance Checklist

- [ ] Store actions have breadcrumbs at start/success/error
- [ ] Key user interactions tracked
- [ ] No sensitive data in breadcrumbs
- [ ] Consistent naming convention
- [ ] Not duplicating automatic breadcrumbs
- [ ] Exception captures include context
- [ ] TypeScript compiles without errors
