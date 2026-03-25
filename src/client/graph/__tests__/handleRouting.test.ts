import { Position } from '@vue-flow/core';
import { describe, expect, it } from 'vitest';

import { FOLDER_HANDLE_IDS, FOLDER_INNER_HANDLE_IDS, getHandlePositions } from '../handleRouting';

describe('handleRouting', () => {
  it('exposes only canonical outer folder handles', () => {
    expect(FOLDER_HANDLE_IDS).toEqual({
      leftIn: 'folder-left-in',
      rightOut: 'folder-right-out',
    });
  });

  it('exposes only canonical inner folder handles', () => {
    expect(FOLDER_INNER_HANDLE_IDS).toEqual({
      leftIn: 'folder-left-in-inner',
      rightOut: 'folder-right-out-inner',
    });
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
});
