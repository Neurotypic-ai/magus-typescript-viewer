# Performance Investigation Playbook

Systematic approach to diagnosing performance issues in Vue + Pinia + API stack.

## Input Needed

- **Symptom**: What feels slow (initial load, interaction, navigation)
- **Affected area**: Which view/component/feature
- **Severity**: How noticeable is the slowdown

## Instructions

1. **Identify the bottleneck layer**:

   | Symptom | Likely Layer | Investigation |
   | --------- | -------------- | --------------- |
   | Slow initial page load | Network, API, bundle | Check waterfall, bundle size |
   | Slow interaction response | Component, reactivity | Profile with Vue DevTools |
   | Slow list scrolling | Rendering, DOM | Check for unnecessary re-renders |
   | Slow form submission | API, validation | Profile network requests |
   | Janky animations | CSS, JS execution | Check for layout thrashing |

2. **Browser DevTools profiling**:

   **Performance tab**:
   1. Open DevTools → Performance
   2. Click Record
   3. Perform the slow action
   4. Click Stop
   5. Analyze the flame chart

   **Network tab**:
   1. Open DevTools → Network
   2. Reload or perform action
   3. Check for:
      - Large payloads (> 100KB)
      - Slow responses (> 500ms)
      - Waterfall blocking
      - Too many requests

3. **Vue DevTools profiling**:

   ```text
   1. Open Vue DevTools → Performance
   2. Click Record
   3. Perform the slow action
   4. Click Stop
   5. Look for:
      - Components re-rendering unnecessarily
      - Long component render times
      - Excessive reactivity triggers
   ```

4. **Check for common Vue performance issues**:

   **Unnecessary re-renders**:

   ```typescript
   // ❌ Reactive object recreated every render
   const options = computed(() => ({
     items: items.value.map(i => ({ ...i })),
   }));

   // ✅ Only update when needed
   const options = computed(() => ({
     items: items.value,
   }));
   ```

   **Missing key in v-for**:

   ```vue
   <!-- ❌ No key - Vue can't optimize -->
   <div v-for="item in items">

   <!-- ✅ Unique key - Vue can diff efficiently -->
   <div v-for="item in items" :key="item.id">
   ```

   **Computed vs method**:

   ```typescript
   // ❌ Method called every render
   function getFilteredItems() {
     return items.value.filter(i => i.active);
   }

   // ✅ Computed is cached
   const filteredItems = computed(() => items.value.filter(i => i.active));
   ```

   **Deep watchers**:

   ```typescript
   // ❌ Deep watch on large object - expensive
   watch(largeState, () => {}, { deep: true });

   // ✅ Watch specific properties
   watch(() => state.specificField, () => {});
   ```

5. **Check for store performance issues**:

   **Fetching too much data**:

   ```typescript
   // ❌ Fetching all transactions on every view
   onMounted(() => {
     store.fetchAll();
   });

   // ✅ Use pagination and caching
   onMounted(() => {
     if (store.isStale) {
       store.fetchPage(1, { limit: 50 });
     }
   });
   ```

   **Missing cache checks**:

   ```typescript
   // ❌ Always fetching
   async function fetchData() {
     return await api.getData();
   }

   // ✅ Check cache first
   async function fetchData(force = false) {
     if (!force && !isStale.value && items.value.length > 0) {
       return items.value;
     }
     return await api.getData();
   }
   ```

6. **Check for API performance issues**:

   **Add timing instrumentation**:

   ```typescript
   async function fetchWithTiming() {
     const start = performance.now();

     const data = await api.getData();

     const duration = performance.now() - start;
     logger.debug('API call timing', {
       endpoint: '/transactions',
       duration: `${duration.toFixed(2)}ms`,
       count: data.length,
     });

     return data;
   }
   ```

   **Use Sentry performance spans**:

   ```typescript
   import * as Sentry from '@sentry/vue';

   async function fetchTransactions() {
     return await Sentry.startSpan(
       { op: 'http.client', name: 'Fetch Transactions' },
       async (span) => {
         const data = await transactionService.getAll();
         span.setData('count', data.length);
         return data;
       }
     );
   }
   ```

7. **Check bundle size**:

   ```bash
   # Analyze bundle
   pnpm build
   npx vite-bundle-visualizer

   # Or check chunk sizes
   ls -la apps/dollarwise/dist/assets/*.js
   ```

   **Common bundle bloat**:
   - Large libraries imported entirely (lodash, moment)
   - Unused code not tree-shaken
   - Large inline assets

8. **Check for memory leaks**:

   ```typescript
   // ❌ Event listener not cleaned up
   onMounted(() => {
     window.addEventListener('resize', handleResize);
   });

   // ✅ Clean up on unmount
   onMounted(() => {
     window.addEventListener('resize', handleResize);
   });
   onUnmounted(() => {
     window.removeEventListener('resize', handleResize);
   });

   // Or use VueUse
   import { useEventListener } from '@vueuse/core';
   useEventListener(window, 'resize', handleResize);
   ```

9. **Document findings**:

   ```markdown
   ## Performance Investigation: [Feature]

   ### Symptom
   [What's slow and when]

   ### Measurements
   - Initial render: XXms
   - Re-render: XXms
   - API response: XXms
   - Bundle size: XX KB

   ### Root Cause
   [What's causing the slowdown]

   ### Fix
   [What to change]

   ### Expected Improvement
   [Target metrics after fix]
   ```

## Performance Checklist

- [ ] Identified the slow layer (network, component, store)
- [ ] Profiled with browser DevTools
- [ ] Profiled with Vue DevTools
- [ ] Checked for unnecessary re-renders
- [ ] Checked for missing v-for keys
- [ ] Checked for expensive computeds/watchers
- [ ] Checked API response times
- [ ] Checked bundle size
- [ ] Documented findings and fix

## Quick Wins

1. **Add key to v-for loops**
2. **Use computed instead of methods**
3. **Implement pagination for large lists**
4. **Add cache TTL to store fetches**
5. **Lazy load routes (already done in router)**
6. **Use `shallowRef` for large non-reactive data**
