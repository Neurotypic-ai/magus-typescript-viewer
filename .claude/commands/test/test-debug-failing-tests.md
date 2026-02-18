# Debug Failing Tests

Systematic workflow to triage and fix failing test suites.

## Input Needed

- **Test output**: The failing test error message
- **Test file**: Which test file is failing
- **Test name**: Specific test case(s) that fail

## Instructions

1. **Run the failing test in isolation**:

   ```bash
   # Run single test file
   pnpm test packages/data/src/stores/__tests__/budgets.test.ts

   # Run single test by name
   pnpm test -t "creates and adds item to store"

   # Run with verbose output
   pnpm test --reporter=verbose
   ```

2. **Categorize the failure type**:

   ### Type A: Assertion Failure

   ```text
   Expected: "expected value"
   Received: "actual value"
   ```

   **Cause**: Code behavior doesn't match expectation
   **Fix**: Either fix the code or update the test expectation

   ### Type B: Type Error

   ```text
   TypeError: Cannot read property 'x' of undefined
   ```

   **Cause**: Missing mock, incorrect setup, or code bug
   **Fix**: Add proper mocks or fix null handling

   ### Type C: Async Timeout

   ```text
   Error: Async callback was not invoked within timeout
   ```

   **Cause**: Promise never resolves, missing await, or slow operation
   **Fix**: Check async handling, add proper awaits, or increase timeout

   ### Type D: Mock Not Called

   ```text
   Expected mock function to have been called
   ```

   **Cause**: Mock not set up correctly or code path not executed
   **Fix**: Verify mock setup and execution path

3. **Check common issues**:

   **Missing mock**:

   ```typescript
   // Make sure API service is mocked
   vi.mock('../../api/services/budget.service', () => ({
     budgetService: {
       getAll: vi.fn(),
       // ... all methods used by the store
     },
   }));
   ```

   **Mock not reset between tests**:

   ```typescript
   beforeEach(() => {
     vi.clearAllMocks();
     // Or vi.resetAllMocks() for full reset
   });
   ```

   **Pinia not initialized**:

   ```typescript
   beforeEach(() => {
     setActivePinia(createPinia());
     store = useMyStore();
   });
   ```

   **Missing async/await**:

   ```typescript
   // ❌ Wrong
   it('fetches data', () => {
     store.fetchAll();
     expect(store.items).toHaveLength(5);
   });

   // ✅ Correct
   it('fetches data', async () => {
     await store.fetchAll();
     expect(store.items).toHaveLength(5);
   });
   ```

4. **Debug with console output**:

   ```typescript
   it('should work', async () => {
     console.log('Before:', store.items);
     await store.fetchAll();
     console.log('After:', store.items);
     console.log('Mock calls:', vi.mocked(service.getAll).mock.calls);
     expect(store.items).toHaveLength(5);
   });
   ```

5. **Check for race conditions**:

   ```typescript
   // Wait for state to settle
   await vi.waitFor(() => {
     expect(store.loading).toBe(false);
   });

   // Or use waitFor from Testing Library
   await waitFor(() => {
     expect(screen.getByText('Loaded')).toBeTruthy();
   });
   ```

6. **Verify mock implementation**:

   ```typescript
   // Check mock is returning expected value
   vi.mocked(budgetService.getAll).mockResolvedValue([
     { id: '1', name: 'Test' },
   ]);

   // Check mock was called with expected args
   expect(budgetService.getAll).toHaveBeenCalledWith(
     expect.objectContaining({ categoryId: '123' })
   );
   ```

7. **For component tests**, check:

   ```typescript
   // Props are passed correctly
   render(Component, {
     props: { modelValue: 'test' } satisfies Props,
   });

   // Events are emitted
   const { emitted } = render(Component, { props });
   await fireEvent.click(button);
   expect(emitted()['update:modelValue']).toBeTruthy();

   // DOM element exists
   expect(screen.getByRole('button')).toBeTruthy();
   ```

8. **For E2E tests**, check:

   ```typescript
   // Element is visible before interacting
   await expect(page.getByRole('button')).toBeVisible();

   // Wait for navigation
   await page.waitForURL('/expected-path');

   // Network request completed
   await page.waitForResponse('**/api/data');
   ```

## Common Fixes

| Symptom | Likely Cause | Fix |
| --------- | -------------- | ----- |
| Mock not called | Wrong import path | Check vi.mock path matches import |
| Undefined error | Missing setup | Add beforeEach with proper init |
| Timeout | Missing await | Add await to async operations |
| Wrong value | Stale state | Clear mocks, reset store |
| Flaky pass/fail | Race condition | Add proper waits |

## Debugging Commands

```bash
# Run tests with coverage to see what's executed
pnpm test --coverage

# Run in watch mode for quick iteration
pnpm test --watch

# Run with full stack traces
pnpm test --reporter=verbose --no-threads

# Run specific test in debug mode
node --inspect-brk ./node_modules/vitest/vitest.mjs run -t "test name"
```

## Acceptance Checklist

- [ ] Identified the failure type (assertion, type, async, mock)
- [ ] Isolated the failing test
- [ ] Checked mock setup is correct
- [ ] Verified async handling (await)
- [ ] Checked Pinia is initialized
- [ ] Verified test expectations are correct
- [ ] Test passes consistently after fix
- [ ] No new test failures introduced
