import { Position } from '@vue-flow/core';
import { describe, expect, it } from 'vitest';

import { FOLDER_HANDLE_IDS, MODULE_HANDLE_IDS, getHandlePositions, resolveHandleSide } from '../handleRouting';
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

  it('exposes canonical four-sided module handles (Phase 2)', () => {
    expect(MODULE_HANDLE_IDS).toEqual({
      topIn: 'relational-top-in',
      topOut: 'relational-top-out',
      rightIn: 'relational-right-in',
      rightOut: 'relational-right-out',
      bottomIn: 'relational-bottom-in',
      bottomOut: 'relational-bottom-out',
      leftIn: 'relational-left-in',
      leftOut: 'relational-left-out',
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

  describe('resolveHandleSide', () => {
    it('resolves each of the eight MODULE_HANDLE_IDS to its cardinal side', () => {
      expect(resolveHandleSide(MODULE_HANDLE_IDS.topIn)).toBe('top');
      expect(resolveHandleSide(MODULE_HANDLE_IDS.topOut)).toBe('top');
      expect(resolveHandleSide(MODULE_HANDLE_IDS.rightIn)).toBe('right');
      expect(resolveHandleSide(MODULE_HANDLE_IDS.rightOut)).toBe('right');
      expect(resolveHandleSide(MODULE_HANDLE_IDS.bottomIn)).toBe('bottom');
      expect(resolveHandleSide(MODULE_HANDLE_IDS.bottomOut)).toBe('bottom');
      expect(resolveHandleSide(MODULE_HANDLE_IDS.leftIn)).toBe('left');
      expect(resolveHandleSide(MODULE_HANDLE_IDS.leftOut)).toBe('left');
    });

    it('keeps legacy alias support for relational-in / relational-out', () => {
      expect(resolveHandleSide('relational-in')).toBe('left');
      expect(resolveHandleSide('relational-out')).toBe('right');
    });

    it('resolves folder-* handles by side', () => {
      expect(resolveHandleSide('folder-left-in')).toBe('left');
      expect(resolveHandleSide('folder-right-out')).toBe('right');
      expect(resolveHandleSide('folder-right-stub')).toBe('right');
      expect(resolveHandleSide('folder-left-stub')).toBe('left');
    });

    it('returns undefined for unknown ids and nullish input', () => {
      expect(resolveHandleSide(undefined)).toBeUndefined();
      expect(resolveHandleSide(null)).toBeUndefined();
      expect(resolveHandleSide('')).toBeUndefined();
      expect(resolveHandleSide('not-a-handle')).toBeUndefined();
    });
  });
});
