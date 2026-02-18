# Write Component Unit Tests

Add unit tests for a Vue component using Vitest and Testing Library.

## Input Needed

- **Component path**: Which component to test
- **Key behaviors**: What interactions/rendering to verify
- **Props/events**: Which props and events need coverage

## Files to Touch

- Test file co-located with component: `ComponentName.test.ts`
- Or in `__tests__/` directory if grouped

## Instructions

1. **Read the rules first**:
   - [unit-testing.mdc](mdc:.cursor/rules/unit-testing.mdc) for test patterns

2. **Set up the test file**:

   ```typescript
   import { describe, it, expect, vi } from 'vitest';
   import { render, screen, fireEvent, waitFor } from '@testing-library/vue';
   import { createTestingPinia } from '@pinia/testing';
   import ComponentName from './ComponentName.vue';

   // Optional: import test utilities
   import { renderWithProviders, getEmitted } from '../../../__tests__/test-utils';
   ```

3. **Basic rendering tests**:

   ```typescript
   describe('ComponentName', () => {
     it('renders with default props', () => {
       render(ComponentName, {
         props: {
           modelValue: '',
           label: 'Test Label',
         } satisfies { modelValue: string; label: string },
       });

       expect(screen.getByText('Test Label')).toBeTruthy();
     });

     it('renders initial value', () => {
       render(ComponentName, {
         props: {
           modelValue: 'initial',
           label: 'Label',
         } satisfies { modelValue: string; label: string },
       });

       const input = screen.getByRole('textbox');
       expect(input).toHaveValue('initial');
     });
   });
   ```

4. **Use `satisfies` for type safety**:

   ```typescript
   // ✅ Always use satisfies for prop type checking
   render(CurrencyField, {
     props: {
       modelValue: 12345,
       label: 'Amount',
       isNegative: true,
     } satisfies { modelValue: number; label: string; isNegative: boolean },
   });
   ```

5. **Test user interactions**:

   ```typescript
   describe('user interactions', () => {
     it('emits update:modelValue on input', async () => {
       const { emitted } = render(ComponentName, {
         props: { modelValue: '', label: 'Label' } satisfies Props,
       });

       const input = screen.getByRole('textbox');
       await fireEvent.update(input, 'new value');

       const updates = emitted()['update:modelValue'] as string[][];
       expect(updates[updates.length - 1][0]).toBe('new value');
     });

     it('handles click events', async () => {
       const { emitted } = render(ComponentName, {
         props: { label: 'Click me' } satisfies Props,
       });

       await fireEvent.click(screen.getByRole('button'));

       expect(emitted().click).toBeTruthy();
     });

     it('handles keyboard shortcuts', async () => {
       render(CurrencyField, {
         props: { modelValue: 100, label: 'Amount' } satisfies Props,
       });

       const input = screen.getByRole('textbox');
       await fireEvent.keyDown(input, { key: 'k' }); // Multiply by 1000

       // Check emitted value
     });
   });
   ```

6. **Test accessibility**:

   ```typescript
   describe('accessibility', () => {
     it('input has associated label', () => {
       render(ComponentName, {
         props: { modelValue: '', label: 'Email' } satisfies Props,
       });

       expect(screen.getByLabelText('Email')).toBeTruthy();
     });

     it('shows error with aria-invalid', () => {
       render(ComponentName, {
         props: {
           modelValue: '',
           label: 'Email',
           error: 'Required',
         } satisfies Props,
       });

       const input = screen.getByRole('textbox');
       expect(input.getAttribute('aria-invalid')).toBe('true');
     });

     it('error linked via aria-describedby', () => {
       render(ComponentName, {
         props: { modelValue: '', label: 'Email', error: 'Required' } satisfies Props,
       });

       const input = screen.getByRole('textbox');
       const error = screen.getByText('Required');
       expect(input.getAttribute('aria-describedby')).toBe(error.id);
     });
   });
   ```

7. **Test with providers** (Pinia, Router):

   ```typescript
   import { renderWithProviders } from '../../../__tests__/test-utils';

   it('works with store data', async () => {
     renderWithProviders(ComponentName, {
       props: { modelValue: '' } satisfies Props,
       initialState: {
         categories: {
           items: [
             { id: '1', name: 'Groceries' },
             { id: '2', name: 'Dining' },
           ],
         },
       },
     });

     // Component can now access store
   });
   ```

8. **Test async behavior**:

   ```typescript
   it('shows loading state', async () => {
     render(ComponentName, { props: { loading: true } satisfies Props });

     expect(screen.getByRole('progressbar')).toBeTruthy();
   });

   it('waits for async content', async () => {
     render(ComponentName, { props: {} satisfies Props });

     await waitFor(() => {
       expect(screen.getByText('Loaded content')).toBeTruthy();
     });
   });
   ```

9. **Test disabled state**:

   ```typescript
   it('disables input when disabled prop is true', () => {
     render(ComponentName, {
       props: { modelValue: '', label: 'Label', disabled: true } satisfies Props,
     });

     const input = screen.getByRole('textbox');
     expect(input).toBeDisabled();
   });

   it('prevents interaction when disabled', async () => {
     const { emitted } = render(ComponentName, {
       props: { disabled: true } satisfies Props,
     });

     await fireEvent.click(screen.getByRole('button'));

     expect(emitted().click).toBeFalsy();
   });
   ```

10. **Use locale-flexible assertions**:

    ```typescript
    // For formatted values that vary by locale
    expect(input.value).toMatch(/123\.45|123,45/);
    expect(input.value).toMatch(/\$|€|£/);
    ```

## Test Structure Template

```typescript
describe('ComponentName', () => {
  describe('rendering', () => {
    it('renders with required props', () => {});
    it('renders initial value', () => {});
    it('renders label', () => {});
  });

  describe('user interactions', () => {
    it('emits on input', async () => {});
    it('handles click', async () => {});
    it('handles keyboard', async () => {});
  });

  describe('validation', () => {
    it('shows error message', () => {});
    it('validates input', async () => {});
  });

  describe('accessibility', () => {
    it('has accessible label', () => {});
    it('announces errors', () => {});
  });

  describe('edge cases', () => {
    it('handles empty value', () => {});
    it('handles disabled state', () => {});
  });
});
```

## Acceptance Checklist

- [ ] Test file co-located with component
- [ ] Uses `satisfies` for typed props
- [ ] Tests initial rendering
- [ ] Tests user interactions (click, input, keyboard)
- [ ] Tests emitted events with correct values
- [ ] Tests accessibility (labels, ARIA)
- [ ] Tests error states
- [ ] Tests disabled state
- [ ] Tests edge cases
- [ ] Locale-flexible assertions where needed
- [ ] All tests pass (`pnpm test`)
