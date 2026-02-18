# Build a Complex Input Component

Create a sophisticated input component with validation, formatting, masking, and full accessibility.

## Input Needed

- **Input name**: What the field captures (e.g., `PhoneField`, `CurrencyField`, `DateField`)
- **Value type**: Internal value type (e.g., `number` for cents, `string` for formatted date)
- **Display format**: How it appears to users (e.g., `$1,234.56`, `(555) 123-4567`)
- **Validation rules**: Required? Min/max? Pattern?

## Files to Touch

- `packages/design-system/src/components/<FieldName>.vue`
- `packages/design-system/src/components/<FieldName>.types.ts` (if complex props)
- `packages/design-system/src/components/<FieldName>.test.ts`

## Instructions

1. **Read the rules first**:
   - [complex-inputs.mdc](mdc:.cursor/rules/complex-inputs.mdc) for input patterns
   - [a11y.mdc](mdc:.cursor/rules/a11y.mdc) for accessibility requirements
   - [unit-testing.mdc](mdc:.cursor/rules/unit-testing.mdc) for test patterns

2. **Reference existing complex inputs**:
   - `CurrencyField.vue` – currency formatting, k/m shortcuts, sign handling
   - `PhoneField.vue` – phone number formatting
   - `DateField.vue` – date picker integration
   - `OTPField.vue` – multi-box OTP input

3. **Create the component** with these features:

   **a) Props interface**:

   ```typescript
   interface Props {
     modelValue: number | string;
     label: string;
     placeholder?: string;
     error?: string;
     disabled?: boolean;
     required?: boolean;
     // Add field-specific props
   }
   ```

   **b) v-model pattern**:

   ```typescript
   const emit = defineEmits<{
     (e: 'update:modelValue', value: number): void;
   }>();

   // Internal display value (formatted)
   const displayValue = ref('');

   // Sync internal ↔ external
   watch(() => props.modelValue, (val) => {
     displayValue.value = formatForDisplay(val);
   }, { immediate: true });

   function handleInput(event: Event) {
     const raw = (event.target as HTMLInputElement).value;
     const parsed = parseInput(raw);
     emit('update:modelValue', parsed);
   }
   ```

   **c) Accessibility**:

   ```vue
   <template>
     <div>
       <label :for="inputId">{{ label }}</label>
       <input
         :id="inputId"
         :value="displayValue"
         :aria-invalid="!!error"
         :aria-describedby="error ? errorId : undefined"
         @input="handleInput"
       />
       <span v-if="error" :id="errorId" role="alert">{{ error }}</span>
     </div>
   </template>
   ```

   **d) Keyboard handling** (if applicable):

   ```typescript
   function handleKeyDown(event: KeyboardEvent) {
     if (event.key === 'k') {
       // Multiply by 1000
     } else if (event.key === 'ArrowUp') {
       // Increment
     }
   }
   ```

4. **Add unit tests** covering:
   - Initial value formatting
   - User input → emitted value
   - Invalid input rejection
   - Keyboard shortcuts
   - Accessibility attributes
   - Edge cases (empty, min/max bounds)

## Acceptance Checklist

- [ ] Component accepts `modelValue` and emits `update:modelValue`
- [ ] Has `label`, `error`, `disabled`, `required` props
- [ ] Formats display value correctly
- [ ] Parses/validates user input
- [ ] Has `aria-invalid`, `aria-describedby` for errors
- [ ] Label is associated with input via `for`/`id`
- [ ] Keyboard navigation works (Tab, Enter, shortcuts)
- [ ] Unit tests cover all major scenarios
- [ ] Works with `useModelForm` field bindings
- [ ] TypeScript compiles without errors
