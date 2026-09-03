import { describe, expect, it } from 'vitest';
import { documentInstanceKey, normalizeDocumentPath } from './documentIdentity';

describe('document physical instance identity', () => {
  it('normalizes Windows path spelling consistently', () => {
    expect(normalizeDocumentPath('C:/Books//Draft.dwrite')).toBe('c:\\books\\draft.dwrite');
  });

  it('treats path spelling variants as the same physical document instance', () => {
    const slashVariant = documentInstanceKey('doc-1', 'C:/Books/Draft.dwrite');
    const caseVariant = documentInstanceKey('doc-1', 'c:\\books\\DRAFT.dwrite');
    expect(slashVariant).toBe(caseVariant);
  });

  it('separates hand-copied files that retain the same embedded document id', () => {
    const original = documentInstanceKey('doc-1', 'C:\\Books\\Draft.dwrite');
    const copy = documentInstanceKey('doc-1', 'C:\\Books\\Draft Copy.dwrite');
    expect(original).not.toBe(copy);
    expect(documentInstanceKey('doc-1', null)).toBe('doc-1');
  });
});
