# Create a New Vue Component

Scaffold a new Vue 3 component following DollarWise conventions (Composition API, `<script setup>`, TypeScript, Tailwind).

## Input Needed

- **Component name**: PascalCase (e.g., `TransactionCard`)
- **Component type**: `ui/inputs`, `ui/display`, `ui/navigation`, `ui/feedback`, or `features/<domain>`
- **Brief purpose**: One sentence describing what this component does

## Files to Touch

- `apps/dollarwise/src/components/ui/<type>/<ComponentName>.vue` (UI components)
- `apps/dollarwise/src/components/features/<domain>/<ComponentName>.vue` (feature components)
- Optionally: `<ComponentName>.types.ts` for complex prop/emit types

## Instructions

1. **Read the rules first**:
   - [components.mdc](mdc:.cursor/rules/components.mdc) for component guidelines
   - [vue-ts-style.mdc](mdc:.cursor/rules/vue-ts-style.mdc) for Vue/TS conventions
   - [a11y.mdc](mdc:.cursor/rules/a11y.mdc) for accessibility requirements

2. **Determine the correct folder**:
   - `ui/inputs/` → form controls, pickers, fields
   - `ui/display/` → read-only display elements (lists, cards, badges)
   - `ui/navigation/` → nav bars, links, tabs
   - `ui/feedback/` → loaders, toasts, alerts
   - `features/<domain>/` → domain-specific composites (transactions, budgets, etc.)

3. **Create the component file** with this structure:

   ```vue
   <script setup lang="ts">
   // Props interface (inline or imported from .types.ts)
   interface Props {
     // Define props with sensible defaults
   }
   const props = withDefaults(defineProps<Props>(), {
     // defaults
   });

   // Emits (if any)
   const emit = defineEmits<{
     (e: 'update:modelValue', value: string): void;
   }>();

   // Composables, refs, computed, handlers
   </script>

   <template>
     <!-- Use semantic HTML + Tailwind classes -->
   </template>
   ```

4. **Follow these conventions**:
   - Use `<script setup lang="ts">` (no Options API)
   - Define props with `withDefaults(defineProps<Props>(), {...})`
   - Use `defineEmits<{...}>()` with explicit event signatures
   - Prefer design-system components (`@neurotypic-ai/design-system`) over raw HTML
   - Apply Tailwind theme tokens from `style.css` (not arbitrary colors)
   - Add ARIA attributes for interactive elements

5. **If the component needs data**, import from data-layer stores:

   ```typescript
   import { useTransactionsStore } from '@neurotypic-ai/data/stores/transactions';
   const transactions = useTransactionsStore();
   ```

   - **NEVER** import directly from `@neurotypic-ai/data` internals

6. **Add logging if needed** (for complex components):

   ```typescript
   import { useLogger } from '@/composables/useLogger';
   const logger = useLogger('ComponentName');
   ```

## Acceptance Checklist

- [ ] Component is in the correct folder per its type
- [ ] Uses `<script setup lang="ts">` with typed props/emits
- [ ] Imports stores from `@neurotypic-ai/data/stores/*` (not internals)
- [ ] Uses design-system components where applicable
- [ ] Has proper ARIA attributes for interactive elements
- [ ] Uses Tailwind theme tokens (no hardcoded colors)
- [ ] No dynamic imports (`import()`) anywhere
- [ ] TypeScript compiles without errors (`pnpm typecheck`)
