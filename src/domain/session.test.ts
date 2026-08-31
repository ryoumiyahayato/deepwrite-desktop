import { describe, expect, it } from 'vitest';
import { needsDocumentTransitionGuard, shouldWarnBeforeClose } from './session';

describe('document session transition safety', () => {
  it('allows transitions only from a confirmed saved state', () => {
    expect(needsDocumentTransitionGuard('saved')).toBe(false);
    expect(needsDocumentTransitionGuard('unsaved')).toBe(true);
    expect(needsDocumentTransitionGuard('saving')).toBe(true);
    expect(needsDocumentTransitionGuard('error')).toBe(true);
  });

  it('warns before closing any non-saved document state', () => {
    expect(shouldWarnBeforeClose('saved')).toBe(false);
    expect(shouldWarnBeforeClose('unsaved')).toBe(true);
    expect(shouldWarnBeforeClose('saving')).toBe(true);
    expect(shouldWarnBeforeClose('error')).toBe(true);
  });
});
