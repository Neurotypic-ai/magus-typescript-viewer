import { describe, expect, it } from 'vitest';

import { selectFolderHandle } from '../handleRouting';

describe('handleRouting', () => {
  it('maps LR direction handles correctly', () => {
    expect(selectFolderHandle('LR', 'incoming')).toBe('folder-left-in');
    expect(selectFolderHandle('LR', 'outgoing')).toBe('folder-right-out');
  });

  it('maps RL direction handles correctly', () => {
    expect(selectFolderHandle('RL', 'incoming')).toBe('folder-right-in');
    expect(selectFolderHandle('RL', 'outgoing')).toBe('folder-left-out');
  });

  it('maps TB direction handles correctly', () => {
    expect(selectFolderHandle('TB', 'incoming')).toBe('folder-top-in');
    expect(selectFolderHandle('TB', 'outgoing')).toBe('folder-bottom-out');
  });

  it('maps BT direction handles correctly', () => {
    expect(selectFolderHandle('BT', 'incoming')).toBe('folder-bottom-in');
    expect(selectFolderHandle('BT', 'outgoing')).toBe('folder-top-out');
  });
});

