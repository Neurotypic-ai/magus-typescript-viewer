# Add a New View and Route

Create a new top-level view component and register it in Vue Router with lazy loading.

## Input Needed

- **View name**: PascalCase ending in `View` (e.g., `SettingsView`, `ReportsView`)
- **Route path**: URL path (e.g., `/settings`, `/reports`)
- **Auth requirement**: Does this route require authentication?

## Files to Touch

- `apps/dollarwise/src/views/<ViewName>.vue`
- `apps/dollarwise/src/router.ts`

## Instructions

1. **Read the rules first**:
   - [routing-nav.mdc](mdc:.cursor/rules/routing-nav.mdc) for routing patterns
   - [components.mdc](mdc:.cursor/rules/components.mdc) for view structure

2. **Create the view file** at `apps/dollarwise/src/views/<ViewName>.vue`:

   ```vue
   <script setup lang="ts">
   import Page from '@neurotypic-ai/design-system/components/Page.vue';
   import Header from '@neurotypic-ai/design-system/components/Header.vue';
   // Import data stores as needed
   </script>

   <template>
     <Page>
       <Header title="Page Title" />
       <!-- Page content -->
     </Page>
   </template>
   ```

3. **Add the route** in `apps/dollarwise/src/router.ts`:

   ```typescript
   {
     path: '/your-path',
     name: 'your-route-name',
     component: () => import('@/views/YourView.vue'), // Lazy load is OK here
     meta: {
       requiresAuth: true, // Set based on requirement
       title: 'Page Title',
     },
   },
   ```

4. **Lazy loading note**:
   - Vue Router route definitions are the **ONLY** place where `import()` is allowed
   - This is enforced by ESLint and documented in [no-dynamic-imports.mdc](mdc:.cursor/rules/no-dynamic-imports.mdc)

5. **If the view needs data**, use data-layer stores:

   ```typescript
   import { useAuthStore } from '@neurotypic-ai/data/stores/auth';
   import { useTransactionsStore } from '@neurotypic-ai/data/stores/transactions';
   ```

6. **Add navigation** (if needed):
   - Update `BottomNav.vue` if this is a primary navigation destination
   - Or add a link from an existing view

## Acceptance Checklist

- [ ] View file exists in `apps/dollarwise/src/views/`
- [ ] View uses `Page` and `Header` from design-system
- [ ] Route added to `router.ts` with lazy import
- [ ] Route has correct `meta.requiresAuth` setting
- [ ] Route has `meta.title` for page title
- [ ] Data accessed via stores, not direct API calls
- [ ] Navigation to the view is accessible from somewhere
- [ ] TypeScript compiles without errors
