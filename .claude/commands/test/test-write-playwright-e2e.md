# Write Playwright E2E Test

Create an end-to-end test for a user flow using Playwright.

## Input Needed

- **Flow name**: What user journey to test (e.g., "Create transaction", "Login flow")
- **Steps**: Sequence of user actions
- **Assertions**: What to verify at each step

## Files to Touch

- `apps/dollarwise/e2e/<flowName>.spec.ts`

## Instructions

1. **Review existing e2e tests** in `apps/dollarwise/e2e/`.

2. **Set up the test file**:

   ```typescript
   import { test, expect } from '@playwright/test';

   test.describe('Transaction Creation Flow', () => {
     test.beforeEach(async ({ page }) => {
       // Setup: Login and navigate
       await page.goto('/');
       // Add login steps if needed
     });

     test('user can create a new transaction', async ({ page }) => {
       // Test steps here
     });
   });
   ```

3. **Use stable selectors** (prefer in this order):

   ```typescript
   // 1. Role-based (best for a11y)
   await page.getByRole('button', { name: 'Save' }).click();
   await page.getByRole('textbox', { name: 'Description' }).fill('Coffee');

   // 2. Label-based
   await page.getByLabel('Amount').fill('4.50');

   // 3. Test ID (when no semantic option)
   await page.getByTestId('transaction-list').isVisible();

   // 4. Text content
   await page.getByText('Transaction created').isVisible();

   // Avoid: CSS selectors, XPath
   // ❌ await page.locator('.btn-primary').click();
   ```

4. **Write the full flow**:

   ```typescript
   test('user can create an expense transaction', async ({ page }) => {
     // Navigate to transactions
     await page.getByRole('link', { name: 'Transactions' }).click();
     await expect(page).toHaveURL('/transactions');

     // Open create form
     await page.getByRole('button', { name: 'Add Transaction' }).click();

     // Fill the form
     await page.getByLabel('Description').fill('Coffee shop');
     await page.getByLabel('Amount').fill('4.50');

     // Select category
     await page.getByRole('combobox', { name: 'Category' }).click();
     await page.getByRole('option', { name: 'Dining Out' }).click();

     // Submit
     await page.getByRole('button', { name: 'Save' }).click();

     // Verify success
     await expect(page.getByText('Transaction created')).toBeVisible();
     await expect(page.getByText('Coffee shop')).toBeVisible();
     await expect(page.getByText('$4.50')).toBeVisible();
   });
   ```

5. **Handle mobile viewports**:

   ```typescript
   test.describe('Mobile', () => {
     test.use({ viewport: { width: 375, height: 667 } });

     test('navigation works on mobile', async ({ page }) => {
       await page.goto('/');

       // Mobile menu might be hamburger
       await page.getByRole('button', { name: 'Menu' }).click();
       await page.getByRole('link', { name: 'Settings' }).click();

       await expect(page).toHaveURL('/settings');
     });
   });
   ```

6. **Handle async operations**:

   ```typescript
   test('handles loading states', async ({ page }) => {
     await page.goto('/transactions');

     // Wait for data to load
     await expect(page.getByRole('progressbar')).toBeHidden();

     // Or wait for specific content
     await expect(page.getByText('Recent Transactions')).toBeVisible();
   });
   ```

7. **Test error scenarios**:

   ```typescript
   test('shows validation errors', async ({ page }) => {
     await page.getByRole('button', { name: 'Add Transaction' }).click();

     // Submit without filling required fields
     await page.getByRole('button', { name: 'Save' }).click();

     // Check for errors
     await expect(page.getByText('Description is required')).toBeVisible();
     await expect(page.getByText('Amount is required')).toBeVisible();
   });
   ```

8. **Mock API responses** (for isolated tests):

   ```typescript
   test('handles API errors gracefully', async ({ page }) => {
     // Intercept API and return error
     await page.route('**/api/transactions', (route) => {
       route.fulfill({
         status: 500,
         body: JSON.stringify({ message: 'Server error' }),
       });
     });

     await page.goto('/transactions');

     await expect(page.getByText('Failed to load transactions')).toBeVisible();
   });
   ```

9. **Take screenshots for debugging**:

   ```typescript
   test('captures state for debugging', async ({ page }) => {
     await page.goto('/transactions');

     // Screenshot on specific state
     await page.screenshot({ path: 'screenshots/transactions-list.png' });

     // Or on failure (configured in playwright.config.ts)
   });
   ```

## Common Patterns

```typescript
// Wait for navigation
await page.waitForURL('/expected-path');

// Wait for network idle
await page.waitForLoadState('networkidle');

// Check toast message
await expect(page.getByRole('alert')).toContainText('Success');

// Check modal is open
await expect(page.getByRole('dialog')).toBeVisible();

// Check list has items
await expect(page.getByRole('listitem')).toHaveCount(5);

// Fill date input
await page.getByLabel('Date').fill('2024-01-15');

// Handle confirmation dialog
page.on('dialog', (dialog) => dialog.accept());
await page.getByRole('button', { name: 'Delete' }).click();
```

## Running E2E Tests

```bash
# Run all e2e tests
pnpm exec playwright test

# Run specific test file
pnpm exec playwright test e2e/transactions.spec.ts

# Run with UI mode
pnpm exec playwright test --ui

# Run headed (see browser)
pnpm exec playwright test --headed

# Debug mode
pnpm exec playwright test --debug
```

## Acceptance Checklist

- [ ] Test file in `apps/dollarwise/e2e/`
- [ ] Uses role-based selectors (getByRole, getByLabel)
- [ ] Tests the complete user flow
- [ ] Includes assertions at each step
- [ ] Handles async/loading states
- [ ] Tests error scenarios
- [ ] Mobile viewport tested (if applicable)
- [ ] No flaky selectors (no CSS/XPath)
- [ ] Test passes consistently
