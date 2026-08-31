import { describe, expect, it } from 'vitest';
import { sameDocumentPath } from './documentFiles';

describe('document file identity', () => {
  it('treats Windows path spelling variants as the same physical target', () => {
    expect(sameDocumentPath('C:\\Books\\Novel.dwrite', 'c:/books/novel.dwrite')).toBe(true);
    expect(sameDocumentPath('C:\\Books\\Novel.dwrite', 'C:\\Books\\Copy.dwrite')).toBe(false);
    expect(sameDocumentPath(null, 'C:\\Books\\Novel.dwrite')).toBe(false);
  });
});
