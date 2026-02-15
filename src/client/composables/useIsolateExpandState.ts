import { inject, ref, watch } from 'vue';

import { ISOLATE_EXPAND_ALL_KEY } from '../components/nodes/utils';

/**
 * Shared composable for the isolate-expand-all save/restore pattern.
 *
 * When isolation mode activates (`isolateExpandAll` becomes true), saves current
 * state via `getCurrentState`, then calls `expandAll`. When isolation ends,
 * restores the saved state via `restoreState`.
 */
export function useIsolateExpandState<T>(
  getCurrentState: () => T,
  restoreState: (saved: T) => void,
  expandAll: () => void
): void {
  const isolateExpandAll = inject(ISOLATE_EXPAND_ALL_KEY, ref(false));
  let savedState: T | null = null;

  watch(isolateExpandAll, (expand) => {
    if (expand) {
      savedState ??= getCurrentState();
      expandAll();
      return;
    }

    if (savedState !== null) {
      restoreState(savedState);
      savedState = null;
    }
  });
}
