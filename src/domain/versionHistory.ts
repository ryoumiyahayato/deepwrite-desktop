import { documentStats, plainText, type DeepWriteDocument } from './document';
import { documentInstanceKey } from './documentIdentity';
import type { VersionRecord } from '../services/database';

export function buildVersionRecord(document: DeepWriteDocument, path: string | null, reason: string): VersionRecord {
  return {
    id: crypto.randomUUID(),
    documentId: documentInstanceKey(document.id, path),
    documentPath: path,
    createdAt: new Date().toISOString(),
    reason,
    wordCount: documentStats(plainText(document.content)).words,
    snapshot: structuredClone(document)
  };
}
