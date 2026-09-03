export function normalizeDocumentPath(path: string): string {
  return path.trim().replace(/\//g, '\\').replace(/\\+/g, '\\').toLocaleLowerCase('en-US');
}

function pathFingerprint(path: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < path.length; index += 1) {
    const code = path.charCodeAt(index);
    first ^= code;
    first = Math.imul(first, 0x01000193);
    second ^= code + index;
    second = Math.imul(second, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
}

export function documentInstanceKey(documentId: string, path: string | null): string {
  if (!path?.trim()) return documentId;
  return `${documentId}@${pathFingerprint(normalizeDocumentPath(path))}`;
}
