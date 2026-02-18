# Generate Test Fixtures

Create comprehensive test data fixtures aligned with domain models.

## Input Needed

- **Domain**: Which entities to generate fixtures for (e.g., transactions, budgets)
- **Scenarios**: What data scenarios are needed (empty, typical, edge cases)

## Files to Touch

- `apps/dollarwise/src/__tests__/storybook-utils.ts` (shared fixtures)
- `packages/data/src/__tests__/fixtures/<domain>.fixtures.ts` (if domain-specific)

## Instructions

1. **Read the rules first**:
   - [storybook-testing.mdc](mdc:.cursor/rules/storybook-testing.mdc) for fixture patterns

2. **Review existing fixture patterns** in `apps/dollarwise/src/__tests__/storybook-utils.ts`.

3. **Create fixture factory functions**:

   ```typescript
   import type { Transaction, TransactionKind } from '@neurotypic-ai/data/stores/transactions';

   /**
    * Create a single transaction fixture with overrides
    */
   export function createTransaction(overrides: Partial<Transaction> = {}): Transaction {
     return {
       id: `tx-${Date.now()}-${Math.random().toString(36).slice(2)}`,
       accountId: 'acc-checking',
       categoryId: 'cat-groceries',
       description: 'Test Transaction',
       amountCents: 1000,
       kind: 'expense',
       date: new Date().toISOString().split('T')[0],
       isReconciled: false,
       isPending: false,
       createdAt: new Date().toISOString(),
       updatedAt: new Date().toISOString(),
       ...overrides,
     };
   }

   /**
    * Create multiple transactions
    */
   export function createTransactions(
     count: number,
     overrides: Partial<Transaction> = {}
   ): Transaction[] {
     return Array.from({ length: count }, (_, i) =>
       createTransaction({
         id: `tx-${i + 1}`,
         description: `Transaction ${i + 1}`,
         ...overrides,
       })
     );
   }
   ```

4. **Create scenario-specific fixtures**:

   ```typescript
   /**
    * Fixtures for typical monthly spending
    */
   export function getTypicalMonthTransactions(): Transaction[] {
     const thisMonth = new Date().toISOString().slice(0, 7);

     return [
       createTransaction({
         id: 'tx-rent',
         description: 'Monthly Rent',
         amountCents: 150000,
         categoryId: 'cat-housing',
         date: `${thisMonth}-01`,
       }),
       createTransaction({
         id: 'tx-groceries-1',
         description: 'Whole Foods',
         amountCents: 8543,
         categoryId: 'cat-groceries',
         date: `${thisMonth}-03`,
       }),
       createTransaction({
         id: 'tx-salary',
         description: 'Salary Deposit',
         amountCents: 500000,
         kind: 'income',
         categoryId: 'cat-income',
         date: `${thisMonth}-15`,
       }),
       // ... more typical transactions
     ];
   }

   /**
    * Edge case: Many small transactions
    */
   export function getManySmallTransactions(): Transaction[] {
     return createTransactions(100, { amountCents: 100 }); // $1.00 each
   }

   /**
    * Edge case: Large transaction amounts
    */
   export function getLargeTransactions(): Transaction[] {
     return [
       createTransaction({
         id: 'tx-large-1',
         description: 'House Down Payment',
         amountCents: 5000000, // $50,000
       }),
       createTransaction({
         id: 'tx-large-2',
         description: 'Car Purchase',
         amountCents: 3500000, // $35,000
       }),
     ];
   }
   ```

5. **Create related entity fixtures**:

   ```typescript
   export function createCategory(overrides: Partial<Category> = {}): Category {
     return {
       id: `cat-${Date.now()}`,
       name: 'Test Category',
       icon: 'SHOPPING',
       type: 'CUSTOM',
       color: '#3B82F6',
       ...overrides,
     };
   }

   export function createBudget(overrides: Partial<Budget> = {}): Budget {
     const now = new Date();
     return {
       id: `budget-${Date.now()}`,
       categoryId: 'cat-groceries',
       month: now.getMonth() + 1,
       year: now.getFullYear(),
       amount: 50000,
       spent: 0,
       remaining: 50000,
       percentUsed: 0,
       ...overrides,
     };
   }

   export function createAccount(overrides: Partial<Account> = {}): Account {
     return {
       id: `acc-${Date.now()}`,
       memberId: 'm-1',
       name: 'Test Account',
       currentBalance: 100000,
       type: 'checking',
       connectionStatus: 'connected',
       isActive: true,
       ...overrides,
     };
   }
   ```

6. **Create full store state fixture**:

   ```typescript
   export interface MockStoreState {
     accounts: { items: Account[] };
     categories: { items: Category[] };
     budgets: { items: Budget[] };
     transactions: { items: Transaction[] };
   }

   export function getDefaultStoreState(): MockStoreState {
     const accounts = [
       createAccount({ id: 'acc-checking', name: 'Checking', currentBalance: 250000 }),
       createAccount({ id: 'acc-savings', name: 'Savings', currentBalance: 1000000, type: 'savings' }),
     ];

     const categories = [
       createCategory({ id: 'cat-groceries', name: 'Groceries', icon: 'GROCERIES' }),
       createCategory({ id: 'cat-dining', name: 'Dining Out', icon: 'DINING' }),
       createCategory({ id: 'cat-housing', name: 'Housing', icon: 'HOME' }),
       createCategory({ id: 'cat-income', name: 'Income', icon: 'INCOME' }),
     ];

     const budgets = [
       createBudget({
         id: 'b-groceries',
         categoryId: 'cat-groceries',
         amount: 50000,
         spent: 32000,
         remaining: 18000,
         percentUsed: 64,
       }),
       createBudget({
         id: 'b-dining',
         categoryId: 'cat-dining',
         amount: 20000,
         spent: 18500,
         remaining: 1500,
         percentUsed: 92.5,
       }),
     ];

     const transactions = getTypicalMonthTransactions();

     return { accounts, categories, budgets, transactions };
   }

   export function getEmptyStoreState(): MockStoreState {
     return {
       accounts: { items: [] },
       categories: { items: [] },
       budgets: { items: [] },
       transactions: { items: [] },
     };
   }
   ```

7. **Use in tests**:

   ```typescript
   import { createTransaction, getDefaultStoreState } from '../__tests__/storybook-utils';

   describe('TransactionList', () => {
     it('renders transactions', () => {
       renderWithProviders(TransactionList, {
         initialState: getDefaultStoreState(),
       });
       // ...
     });

     it('handles custom transaction', () => {
       const tx = createTransaction({
         description: 'Special Case',
         amountCents: 99999,
       });
       // ...
     });
   });
   ```

8. **Use in Storybook**:

   ```typescript
   import { getDefaultStoreState } from '../../../__tests__/storybook-utils';

   export const WithData: Story = {
     decorators: [
       (story) => ({
         components: { story },
         setup() {
           const pinia = createTestingPinia({
             initialState: getDefaultStoreState(),
           });
           return { pinia };
         },
         template: '<story />',
       }),
     ],
   };
   ```

## Fixture Best Practices

- **Use factories** (`createX()`) for single items with overrides
- **Use scenario functions** (`getTypicalX()`) for common data sets
- **Include edge cases**: empty, large amounts, many items, special characters
- **Keep IDs predictable** for assertions (`tx-1`, `cat-groceries`)
- **Use realistic data** that reflects production scenarios
- **Export types** alongside fixtures for type safety

## Acceptance Checklist

- [ ] Factory functions for each entity type
- [ ] Scenario fixtures (typical, empty, edge cases)
- [ ] Full store state fixture
- [ ] Related entities are consistent (IDs match)
- [ ] Dates are dynamic (not hardcoded past dates)
- [ ] Amounts are realistic
- [ ] Types are properly exported
- [ ] Used in at least one test/story
