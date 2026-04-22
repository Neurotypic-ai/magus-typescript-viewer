import { Position } from '@vue-flow/core';

export const FOLDER_HANDLE_IDS = {
  rightOut: 'folder-right-out',
  leftIn: 'folder-left-in',
  rightStub: 'folder-right-stub',
  leftStub: 'folder-left-stub',
} as const;

/**
 * Module-level handle identifiers for the four cardinal sides.
 *
 * Every module-level node (module, externalPackage, group, scc, class,
 * interface, etc.) exposes one source (out) and one target (in) handle per
 * side — eight handles total. Phase 2 assigns edges to specific sides via
 * `assignEdgeSides`; pre-Phase-2 layouts default to `rightOut`/`leftIn`
 * which preserves the original left/right attachment behaviour.
 *
 * The two legacy IDs (`relational-in`, `relational-out`) are retained for
 * backward compatibility with callers that were written before Phase 2 —
 * they alias to `leftIn` / `rightOut` respectively.
 */
export const MODULE_HANDLE_IDS = {
  topIn: 'relational-top-in',
  topOut: 'relational-top-out',
  rightIn: 'relational-right-in',
  rightOut: 'relational-right-out',
  bottomIn: 'relational-bottom-in',
  bottomOut: 'relational-bottom-out',
  leftIn: 'relational-left-in',
  leftOut: 'relational-left-out',
} as const;

export type ModuleHandleId = (typeof MODULE_HANDLE_IDS)[keyof typeof MODULE_HANDLE_IDS];

export type HandleSide = 'top' | 'right' | 'bottom' | 'left';

/**
 * Legacy handle IDs kept for backward compatibility with callers (drilldown
 * builders, edge geometry fallbacks, collapsed-folder stubs) that were written
 * before the four-sided handle catalogue existed.
 *
 * `relational-in` aliases to `leftIn` (target side), `relational-out` aliases
 * to `rightOut` (source side).
 */
export const LEGACY_HANDLE_IDS = {
  in: 'relational-in',
  out: 'relational-out',
} as const;

/**
 * @deprecated Use `assignEdgeSides` + `MODULE_HANDLE_IDS` instead. This
 * function always returns right/left regardless of direction argument and
 * exists only to keep legacy drilldown builders and tests compiling. New
 * callers should never use it; each edge now carries its own per-edge
 * handle assignments.
 */
export const getHandlePositions = (
  _direction: 'LR' | 'RL' | 'TB' | 'BT'
): { sourcePosition: Position; targetPosition: Position } => {
  return { sourcePosition: Position.Right, targetPosition: Position.Left };
};

/**
 * Resolve the cardinal side for any handle identifier. Accepts:
 *   - Any of the eight `MODULE_HANDLE_IDS.*` values
 *   - Legacy `relational-in` / `relational-out`
 *   - `folder-(right|left)-(in|out|stub)` identifiers
 *
 * Returns `undefined` for unknown IDs so callers can fall back to
 * geometry-based inference.
 */
export function resolveHandleSide(handleId: string | null | undefined): HandleSide | undefined {
  if (!handleId) return undefined;

  if (handleId === MODULE_HANDLE_IDS.topIn || handleId === MODULE_HANDLE_IDS.topOut) return 'top';
  if (handleId === MODULE_HANDLE_IDS.rightIn || handleId === MODULE_HANDLE_IDS.rightOut) return 'right';
  if (handleId === MODULE_HANDLE_IDS.bottomIn || handleId === MODULE_HANDLE_IDS.bottomOut) return 'bottom';
  if (handleId === MODULE_HANDLE_IDS.leftIn || handleId === MODULE_HANDLE_IDS.leftOut) return 'left';

  if (handleId === LEGACY_HANDLE_IDS.in) return 'left';
  if (handleId === LEGACY_HANDLE_IDS.out) return 'right';

  if (handleId.startsWith('folder-')) {
    if (handleId.startsWith('folder-right-')) return 'right';
    if (handleId.startsWith('folder-left-')) return 'left';
  }

  return undefined;
}
