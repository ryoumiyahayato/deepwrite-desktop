export type SaveState = 'saved' | 'unsaved' | 'saving' | 'error';

export function needsDocumentTransitionGuard(saveState: SaveState): boolean {
  return saveState !== 'saved';
}

export function shouldWarnBeforeClose(saveState: SaveState): boolean {
  return saveState === 'unsaved' || saveState === 'saving' || saveState === 'error';
}
