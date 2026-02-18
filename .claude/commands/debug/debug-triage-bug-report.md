# Triage Bug Report

Turn a vague bug report into a reproducible case with hypothesized root causes.

## Input Needed

- **Bug description**: What the user reported
- **Steps to reproduce**: If known
- **Environment**: Web, iOS, Android, browser info
- **Sentry issue link**: If available

## Instructions

1. **Gather information**:
   - What is the expected behavior?
   - What is the actual behavior?
   - When did this start happening?
   - Does it happen consistently or intermittently?
   - Which users/accounts are affected?

2. **Check Sentry** for related issues:
   - Search by error message
   - Look for breadcrumbs leading to the error
   - Check user context and device info
   - Look for patterns (specific OS, browser, account)

3. **Create a reproduction checklist**:

   ```markdown
   ## Reproduction Steps
   - [ ] Step 1: Navigate to /transactions
   - [ ] Step 2: Click "Add Transaction"
   - [ ] Step 3: Fill form with [specific data]
   - [ ] Step 4: Click Save
   - [ ] Expected: Transaction appears in list
   - [ ] Actual: Error toast shows "Failed to save"
   ```

4. **Identify affected code paths**:

   ```markdown
   ## Likely Code Paths
   1. Component: TransactionFormModal.vue
      - Form submission handler
      - API call to create transaction

   2. Store: packages/data/src/stores/transactions.ts
      - create() action
      - Error handling

   3. API: packages/data/src/api/services/transaction.service.ts
      - create() method
      - Request/response transformation

   4. Backend: apps/backend/app/Http/Controllers/TransactionController.php
      - store() method
      - Validation rules
   ```

5. **List hypotheses** (most to least likely):

   ```markdown
   ## Hypotheses

   ### H1: Validation failing on backend (High likelihood)
   - Evidence: Error message mentions "validation"
   - Test: Check backend logs for validation errors
   - Fix: Adjust frontend validation to match backend

   ### H2: Auth token expired during long form fill (Medium likelihood)
   - Evidence: User was logged in for extended time
   - Test: Check if token refresh is working
   - Fix: Improve token refresh handling

   ### H3: Network timeout on slow connection (Low likelihood)
   - Evidence: User on mobile network
   - Test: Throttle network in dev tools
   - Fix: Increase timeout, add retry logic
   ```

6. **Add logging for investigation** (if needed):

   ```typescript
   // Temporarily add verbose logging
   import { useLogger } from '@/composables/useLogger';
   const logger = useLogger('TransactionForm:debug');

   async function handleSubmit() {
     logger.debug('Submit started', { formData: form.formData.value });

     try {
       const result = await store.create(payload);
       logger.debug('Create succeeded', { result });
     } catch (error) {
       logger.error('Create failed', {
         error,
         payload,
         formState: form.formData.value,
       });
       throw error;
     }
   }
   ```

7. **Create test case** if reproducible:

   ```typescript
   it('handles the specific bug scenario', async () => {
     // Setup exact conditions from bug report
     const store = useTransactionsStore();

     // Reproduce the issue
     await expect(store.create({
       description: 'Bug scenario data',
       amountCents: specificValue,
     })).rejects.toThrow();
   });
   ```

8. **Document findings**:

   ```markdown
   ## Investigation Summary

   **Root Cause**: [What actually caused the bug]

   **Affected Users**: [Scope of impact]

   **Fix**: [What needs to change]

   **Prevention**: [How to prevent similar issues]
   ```

## Bug Report Template

```markdown
## Bug Report: [Short Title]

**Reporter**: [Name/source]
**Date**: [When reported]
**Severity**: [Critical/High/Medium/Low]

### Description
[What the user reported]

### Reproduction Steps
1. [Step 1]
2. [Step 2]
3. [Step 3]

### Expected Behavior
[What should happen]

### Actual Behavior
[What actually happens]

### Environment
- Platform: [Web/iOS/Android]
- Browser/OS: [Chrome 120, iOS 17, etc.]
- App Version: [1.2.3]
- User ID: [If available]

### Sentry Link
[URL to Sentry issue]

### Screenshots/Videos
[Attach if available]

### Investigation Notes
[Your findings]

### Hypotheses
1. [Most likely cause]
2. [Alternative cause]

### Proposed Fix
[What to change]
```

## Acceptance Checklist

- [ ] Bug description is clear and specific
- [ ] Reproduction steps are documented
- [ ] Environment info captured
- [ ] Sentry checked for related issues
- [ ] Affected code paths identified
- [ ] Hypotheses listed with evidence
- [ ] Root cause identified (or hypotheses to test)
- [ ] Fix proposed or next investigation steps clear
