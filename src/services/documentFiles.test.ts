import { describe, expect, it } from 'vitest';
import { createDocument, serializeDocument } from '../domain/document';
import { firstValidRecovery, sameDocumentPath } from './documentFiles';

describe('document file identity', () => {
  it('treats Windows path spelling variants as the same physical target', () => {
    expect(sameDocumentPath('C:\\Books\\Novel.dwrite', 'c:/books/novel.dwrite')).toBe(true);
    expect(sameDocumentPath('C:\\Books\\Novel.dwrite', 'C:\\Books\\Copy.dwrite')).toBe(false);
    expect(sameDocumentPath(null, 'C:\\Books\\Novel.dwrite')).toBe(false);
  });

  it('skips a newer invalid recovery and returns the next valid document', () => {
    const valid = serializeDocument({ ...createDocument('可恢复'), id: 'doc-valid', revision: 1 });
    const recovered = firstValidRecovery([
      { key: 'future', contents: JSON.stringify({ schemaVersion: 999, id: 'future' }) },
      { key: 'valid', contents: valid }
    ]);
    expect(recovered?.key).toBe('valid');
    expect(recovered?.document.id).toBe('doc-valid');
  });
});
