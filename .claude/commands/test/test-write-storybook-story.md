# Create a Storybook Story

Write a comprehensive Storybook story for a component with multiple states and variants.

## Input Needed

- **Component path**: Which component to create stories for
- **States to cover**: Default, error, disabled, loading, different data scenarios
- **Interactive controls**: Which props should be controllable in Storybook

## Files to Touch

- `<ComponentPath>.stories.ts` (co-located with component)

## Instructions

1. **Read the rules first**:
   - [storybook-testing.mdc](mdc:.cursor/rules/storybook-testing.mdc) for story patterns

2. **Set up the story file**:

   ```typescript
   import type { Meta, StoryObj } from '@storybook/vue3-vite';
   import ComponentName from './ComponentName.vue';

   // If component has a types file
   import type { ComponentNameProps } from './ComponentName.types';

   const meta: Meta<typeof ComponentName> = {
     title: 'Category/ComponentName', // e.g., 'UI/Inputs/CurrencyField'
     component: ComponentName,
     tags: ['autodocs'], // Enable auto-generated docs
     args: {
       // Sensible defaults for all stories
       modelValue: '',
       label: 'Field Label',
     },
     argTypes: {
       // Control types for Storybook UI
       modelValue: { control: 'text' },
       label: { control: 'text' },
       error: { control: 'text' },
       disabled: { control: 'boolean' },
       // For select controls
       variant: {
         control: 'select',
         options: ['primary', 'secondary', 'ghost'],
       },
     },
   };

   export default meta;
   type Story = StoryObj<typeof meta>;
   ```

3. **Create the Default story**:

   ```typescript
   export const Default: Story = {
     render: (args) => ({
       components: { ComponentName },
       setup() {
         return { args };
       },
       template: '<ComponentName v-bind="args" />',
     }),
   };
   ```

4. **Create state variants**:

   ```typescript
   export const WithValue: Story = {
     args: {
       modelValue: 'Some value',
     },
   };

   export const WithError: Story = {
     args: {
       error: 'This field is required',
     },
   };

   export const Disabled: Story = {
     args: {
       disabled: true,
       modelValue: 'Cannot edit this',
     },
   };

   export const Loading: Story = {
     args: {
       loading: true,
     },
   };
   ```

5. **Create interactive stories** (for inputs):

   ```typescript
   import { ref } from 'vue';

   export const Interactive: Story = {
     render: (args) => ({
       components: { ComponentName },
       setup() {
         const value = ref(args.modelValue);
         return { args, value };
       },
       template: `
         <div class="space-y-4">
           <ComponentName v-bind="args" v-model="value" />
           <p class="text-sm text-gray-500">Current value: {{ value }}</p>
         </div>
       `,
     }),
   };
   ```

6. **Create domain-specific variants**:

   ```typescript
   // For CurrencyField
   export const Expense: Story = {
     args: {
       modelValue: 12345, // $123.45
       isNegative: true,
       label: 'Expense Amount',
     },
   };

   export const Income: Story = {
     args: {
       modelValue: 50000, // $500.00
       isNegative: false,
       label: 'Income Amount',
     },
   };

   export const LargeAmount: Story = {
     args: {
       modelValue: 999999999, // $9,999,999.99
       label: 'Large Amount',
     },
   };

   export const ZeroValue: Story = {
     args: {
       modelValue: 0,
       label: 'Zero Amount',
     },
   };
   ```

7. **Add stories with mock data** (for components using stores):

   ```typescript
   import { createTestingPinia } from '@pinia/testing';
   import { getDefaultStoreState } from '../../../__tests__/storybook-utils';

   export const WithCategories: Story = {
     decorators: [
       (story) => ({
         components: { story },
         setup() {
           const pinia = createTestingPinia({
             initialState: getDefaultStoreState(),
             stubActions: false,
           });
           return { pinia };
         },
         template: '<story />',
       }),
     ],
   };
   ```

8. **Create showcase story** (all variants):

   ```typescript
   export const AllVariants: Story = {
     render: () => ({
       components: { ComponentName },
       template: `
         <div class="grid gap-4">
           <ComponentName label="Default" />
           <ComponentName label="With Value" model-value="Hello" />
           <ComponentName label="With Error" error="Required" />
           <ComponentName label="Disabled" disabled model-value="Locked" />
         </div>
       `,
     }),
   };
   ```

9. **Document with JSDoc**:

   ```typescript
   /**
    * CurrencyField handles monetary input with locale-aware formatting.
    *
    * Features:
    * - Automatic comma/decimal formatting
    * - Keyboard shortcuts (k for thousand, m for million)
    * - Sign handling for expenses/income
    */
   const meta: Meta<typeof CurrencyField> = {
     // ...
   };
   ```

## Story Organization

```text
title: 'Category/Subcategory/ComponentName'

Categories:
- UI/Layout (Page, Card, Section)
- UI/Inputs (TextField, Button, Select)
- UI/Display (List, Empty, Badge)
- UI/Navigation (Header, BottomNav, Link)
- UI/Feedback (Toast, Loading, Alert)
- Features/Transactions
- Features/Budgets
- Features/Categories
```

## Acceptance Checklist

- [ ] Story file co-located with component
- [ ] `title` follows category convention
- [ ] `tags: ['autodocs']` enabled
- [ ] Default args set with sensible values
- [ ] `argTypes` configured for controls
- [ ] Default story created
- [ ] Error state story
- [ ] Disabled state story
- [ ] Interactive story (if input)
- [ ] Domain-specific variants
- [ ] Edge cases covered (empty, large values, etc.)
- [ ] Component renders correctly in Storybook
