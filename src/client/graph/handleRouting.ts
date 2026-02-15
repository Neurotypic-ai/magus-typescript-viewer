export const FOLDER_HANDLE_IDS = {
  topIn: 'folder-top-in',
  topOut: 'folder-top-out',
  rightIn: 'folder-right-in',
  rightOut: 'folder-right-out',
  bottomIn: 'folder-bottom-in',
  bottomOut: 'folder-bottom-out',
  leftIn: 'folder-left-in',
  leftOut: 'folder-left-out',
} as const;

export const FOLDER_INNER_HANDLE_IDS = {
  topIn: 'folder-top-in-inner',
  topOut: 'folder-top-out-inner',
  rightIn: 'folder-right-in-inner',
  rightOut: 'folder-right-out-inner',
  bottomIn: 'folder-bottom-in-inner',
  bottomOut: 'folder-bottom-out-inner',
  leftIn: 'folder-left-in-inner',
  leftOut: 'folder-left-out-inner',
} as const;

export function selectFolderHandle(
  direction: 'LR' | 'RL' | 'TB' | 'BT',
  role: 'incoming' | 'outgoing'
): string {
  if (direction === 'LR') {
    return role === 'incoming' ? FOLDER_HANDLE_IDS.leftIn : FOLDER_HANDLE_IDS.rightOut;
  }
  if (direction === 'RL') {
    return role === 'incoming' ? FOLDER_HANDLE_IDS.rightIn : FOLDER_HANDLE_IDS.leftOut;
  }
  if (direction === 'TB') {
    return role === 'incoming' ? FOLDER_HANDLE_IDS.topIn : FOLDER_HANDLE_IDS.bottomOut;
  }
  return role === 'incoming' ? FOLDER_HANDLE_IDS.bottomIn : FOLDER_HANDLE_IDS.topOut;
}

