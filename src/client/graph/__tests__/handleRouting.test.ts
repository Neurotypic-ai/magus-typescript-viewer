import { Position } from '@vue-flow/core';
import { describe, expect, it } from 'vitest';

import {
  FOLDER_HANDLE_IDS,
  FOLDER_ROUTING_KINDS,
  FOLDER_KIND_Y_OFFSET,
  getFolderHandleId,
  getHandlePositions,
} from '../handleRouting';
import * as handleRoutingModule from '../handleRouting';

describe('handleRouting', () => {
  it('exposes only canonical outer folder handles', () => {
    expect(FOLDER_HANDLE_IDS).toEqual({
      leftIn: 'folder-left-in',
      leftStub: 'folder-left-stub',
      rightOut: 'folder-right-out',
      rightStub: 'folder-right-stub',
    });
  });

  it('does not expose any inner folder handle constants', () => {
    expect('FOLDER_INNER_HANDLE_IDS' in handleRoutingModule).toBe(false);
  });

  it.each(['LR', 'RL', 'TB', 'BT'] as const)(
    'returns canonical left/right node handle positions for %s layouts',
    (direction) => {
      expect(getHandlePositions(direction)).toEqual({
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      });
    }
  );

  describe('per-kind routing', () => {
    it('FOLDER_ROUTING_KINDS contains all six routable kinds', () => {
      expect(FOLDER_ROUTING_KINDS).toEqual([
        'peerDependency',
        'devDependency',
        'dependency',
        'import',
        'extends',
        'implements',
      ]);
    });

    it('FOLDER_KIND_Y_OFFSET assigns distinct 8px-spaced offsets', () => {
      expect(FOLDER_KIND_Y_OFFSET['peerDependency']).toBe(-24);
      expect(FOLDER_KIND_Y_OFFSET['devDependency']).toBe(-16);
      expect(FOLDER_KIND_Y_OFFSET['dependency']).toBe(-8);
      expect(FOLDER_KIND_Y_OFFSET['import']).toBe(0);
      expect(FOLDER_KIND_Y_OFFSET['extends']).toBe(8);
      expect(FOLDER_KIND_Y_OFFSET['implements']).toBe(16);
    });

    it.each([
      ['right', 'stub', 'import', 'folder-right-stub-import'],
      ['left', 'in', 'extends', 'folder-left-in-extends'],
      ['right', 'out', 'implements', 'folder-right-out-implements'],
      ['left', 'stub', 'import', 'folder-left-stub-import'],
    ] as const)('getFolderHandleId(%s, %s, %s) → %s', (side, role, kind, expected) => {
      expect(getFolderHandleId(side, role, kind)).toBe(expected);
    });
  });
});
