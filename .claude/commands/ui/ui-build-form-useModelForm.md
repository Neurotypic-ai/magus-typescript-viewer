# Build a Form with useModelForm

Implement a complete form using the `useModelForm` composable with validation, error handling, and proper field bindings.

## Input Needed

- **Form purpose**: What data is being collected (e.g., create transaction, edit budget)
- **Fields**: List of fields with their types and validation requirements
- **Submit action**: What happens on successful submission

## Files to Touch

- Component file (e.g., `TransactionForm.vue`, `BudgetFormModal.vue`)
- Possibly a types file for complex form data

## Instructions

1. **Read the rules first**:
   - [forms-validation.mdc](mdc:.cursor/rules/forms-validation.mdc) for complete patterns
   - [components.mdc](mdc:.cursor/rules/components.mdc) for component structure

2. **Define the form data interface**:

   ```typescript
   interface FormData extends Record<string, unknown> {
     description: string;
     amountStr: string;
     categoryId?: string;
     date: string;
   }
   ```

   - **Must extend `Record<string, unknown>`** for type compatibility

3. **Initialize useModelForm**:

   ```typescript
   import { useModelForm, validators } from '@neurotypic-ai/design-system/composables/useModelForm';

   const form = useModelForm<FormData>(
     {
       description: '',
       amountStr: '',
       categoryId: undefined,
       date: today,
     },
     {
       onSubmit: handleSubmit,
       validation: {
         description: [validators.required('Description is required')],
         amountStr: [
           validators.required('Amount is required'),
           validators.pattern(/^\d*(?:\.\d{1,2})?$/, 'Invalid amount'),
         ],
         date: [validators.required('Date is required')],
       },
     }
   );
   ```

4. **Create field bindings**:

   ```typescript
   const description = form.field('description');
   const amountStr = form.field('amountStr');
   const categoryId = form.field('categoryId');
   const date = form.field('date');
   ```

5. **Bind to template**:

   ```vue
   <template>
     <Form :on-submit="form.submit">
       <TextField
         v-model="description.model.value"
         label="Description"
         :error="description.error.value || ''"
         :disabled="form.isSubmitting.value"
       />

       <CurrencyField
         v-model="amountCents"
         label="Amount"
         :error="amountStr.error.value || ''"
       />

       <template #footer>
         <Button type="submit" :loading="form.isSubmitting.value">
           Save
         </Button>
       </template>
     </Form>
   </template>
   ```

6. **Handle type adapters** (e.g., CurrencyField expects cents):

   ```typescript
   const amountCents = computed<number>({
     get: () => parseCurrency(amountStr.model.value || ''),
     set: (cents: number) => {
       const dollars = cents / 100;
       form.setFieldValue('amountStr', Math.abs(dollars).toFixed(2));
     },
   });
   ```

7. **Implement submit handler**:

   ```typescript
   async function handleSubmit() {
     if (!form.validateForm()) return;

     const payload = {
       description: form.formData.value.description?.trim(),
       amountCents: parseCurrency(form.formData.value.amountStr ?? ''),
       categoryId: form.formData.value.categoryId,
       date: form.formData.value.date,
     };

     try {
       await store.createItem(payload);
       toast.show('Saved successfully', 'success');
       emit('close');
     } catch (error) {
       const msg = error instanceof Error ? error.message : 'Failed to save';
       toast.show(msg, 'error');
     }
   }
   ```

8. **For modals**, reset on close:

   ```typescript
   const openRef = toRef(props, 'open');
   watch(openRef, (open) => {
     if (!open) form.reset();
   });
   ```

## Built-in Validators

```typescript
validators.required(message?)
validators.min(n, message?)
validators.max(n, message?)
validators.minLength(n, message?)
validators.maxLength(n, message?)
validators.email(message?)
validators.pattern(regex, message?)
```

## Acceptance Checklist

- [ ] Form data type extends `Record<string, unknown>`
- [ ] All required fields have `validators.required()`
- [ ] Field bindings created with `form.field('name')`
- [ ] Template uses `fieldName.model.value` for v-model
- [ ] Template uses `fieldName.error.value` for error display
- [ ] Submit button uses `form.isSubmitting.value` for loading
- [ ] Type adapters handle mismatched value types
- [ ] Submit validates before API call
- [ ] Error handling shows toast on failure
- [ ] Modal forms reset on close
- [ ] TypeScript compiles without errors
