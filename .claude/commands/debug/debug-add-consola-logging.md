# Add Structured Consola Logging

Add structured logging with `consola.withTag()` for debugging and observability.

## Input Needed

- **File path**: Where to add logging
- **What to log**: Which operations/events need visibility
- **Log level**: debug, info, warn, error, etc.

## Files to Touch

- The target file (component, store, service)

## Instructions

1. **Read the rules first**:
   - [consola-logging.mdc](mdc:.cursor/rules/consola-logging.mdc) for logging patterns
   - [logging-sentry.mdc](mdc:.cursor/rules/logging-sentry.mdc) for Sentry integration

2. **Import and create tagged logger**:

   **In Vue components** (use composable):

   ```typescript
   import { useLogger } from '@/composables/useLogger';

   const logger = useLogger('ComponentName');
   ```

   **In stores/services** (direct import):

   ```typescript
   import { consola } from 'consola';

   const logger = consola.withTag('storename.store');
   // or
   const logger = consola.withTag('servicename.service');
   ```

   **In data package**:

   ```typescript
   import { getDataLogger } from '@neurotypic-ai/data/logging';

   const logger = getDataLogger('module-name'); // Becomes 'data.module-name'
   ```

3. **Add logging at key points**:

   **Component lifecycle**:

   ```typescript
   onMounted(() => {
     logger.debug('Component mounted', { props: toRaw(props) });
   });

   onUnmounted(() => {
     logger.debug('Component unmounted');
   });
   ```

   **User actions**:

   ```typescript
   function handleSave() {
     logger.info('Save initiated', { formData: form.formData.value });
     // ... save logic
   }

   function handleDelete(id: string) {
     logger.info('Delete requested', { id });
     // ... delete logic
   }
   ```

   **Async operations**:

   ```typescript
   async function fetchData() {
     logger.debug('Fetching data');

     try {
       const data = await api.getData();
       logger.success('Data fetched', { count: data.length });
       return data;
     } catch (error) {
       logger.error('Failed to fetch data', { error });
       throw error;
     }
   }
   ```

   **State changes**:

   ```typescript
   watch(selectedCategory, (newVal, oldVal) => {
     logger.debug('Category changed', { from: oldVal, to: newVal });
   });
   ```

4. **Choose appropriate log levels**:

   | Level | Use For | Example |
   | ------- | --------- | --------- |
   | `fatal` | App crashes | Unrecoverable initialization failure |
   | `error` | Errors needing attention | API failures, exceptions |
   | `warn` | Potential issues | Deprecation, rate limits |
   | `info` | User actions, state changes | Button clicks, navigation |
   | `success` | Completed operations | Saved, created, updated |
   | `debug` | Development info | Variable values, execution flow |
   | `trace` | Verbose tracing | Rarely used |

5. **Log structured data** (objects, not strings):

   **❌ Bad**:

   ```typescript
   logger.info(`User ${userId} created transaction ${txId}`);
   logger.error('Failed: ' + error.message);
   ```

   **✅ Good**:

   ```typescript
   logger.info('Transaction created', { userId, transactionId: txId });
   logger.error('Operation failed', { error, context: 'create-transaction' });
   ```

6. **Avoid logging sensitive data**:

   ```typescript
   // ❌ Never log passwords, tokens, or full credit card numbers
   logger.info('Login attempt', { password: '***' }); // Don't do this

   // ✅ Log identifiers, not sensitive values
   logger.info('Login attempt', { email: user.email, hasPassword: !!password });
   ```

7. **Logging in stores** (with breadcrumbs):

   ```typescript
   import { consola } from 'consola';
   import { addStoreBreadcrumb } from '../helpers/breadcrumbs';

   const logger = consola.withTag('transactions.store');

   async function createTransaction(request: CreateTransactionRequest) {
     // Breadcrumb for Sentry trail
     addStoreBreadcrumb('transactions', 'create', { categoryId: request.categoryId });

     // Verbose log for debugging
     logger.debug('Creating transaction', { request });

     try {
       const result = await transactionService.create(request);
       logger.success('Transaction created', { id: result.id });
       return result;
     } catch (error) {
       logger.error('Failed to create transaction', { error, request });
       throw error;
     }
   }
   ```

8. **Namespace conventions**:

   ```typescript
   // Components
   useLogger('TransactionForm');
   useLogger('BudgetCard');

   // Stores
   consola.withTag('transactions.store');
   consola.withTag('auth.store');

   // Services
   consola.withTag('api.client');
   consola.withTag('iap.service');

   // Data package
   getDataLogger('auth');      // → 'data.auth'
   getDataLogger('quiltt');    // → 'data.quiltt'
   ```

## Sentry Integration Note

All consola logs are **automatically captured as Sentry breadcrumbs**. You don't need to manually call `Sentry.addBreadcrumb()` — just log with consola and Sentry tracks it.

## Acceptance Checklist

- [ ] Logger created with descriptive tag
- [ ] Uses composable in components, direct import in stores
- [ ] Logs at appropriate levels
- [ ] Uses structured data (objects, not string concatenation)
- [ ] No sensitive data logged (passwords, tokens)
- [ ] Key operations logged (start, success, failure)
- [ ] Error cases include error object
- [ ] No excessive logging (not on every render)
- [ ] TypeScript compiles without errors
