import type { JSONContent } from '@tiptap/core';
import { marked } from 'marked';
import TurndownService from 'turndown';
import {
  createDocument,
  forkDocumentForSaveAs,
  parseDocument,
  serializeDocument,
  type DeepWriteDocument
} from '../domain/document';
import { documentInstanceKey, normalizeDocumentPath } from '../domain/documentIdentity';
import {
  atomicWriteBinary,
  atomicWriteText,
  chooseOpenPath,
  chooseSavePath,
  compareAndSwapText,
  extensionFromPath,
  fileNameFromPath,
  invokeCommand,
  readBinary,
  readText,
  readTextIfExists
} from './platform';

export type ImportedContent =
  | { kind: 'document'; document: DeepWriteDocument; path: string; diskContents: string; warnings: string[] }
  | { kind: 'html'; html: string; title: string; sourcePath: string; warnings: string[] };

export interface SavedDwrite {
  path: string;
  document: DeepWriteDocument;
  diskContents: string;
}

export interface RecoveredDwrite {
  key: string;
  document: DeepWriteDocument;
}

interface RecoveryPayload {
  key: string;
  contents: string;
}

const diskBaselines = new Map<string, string>();
const htmlEscape = (input: string) => input.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);

function suggestedPath(directory: string, fileName: string): string {
  const trimmed = directory.trim().replace(/[\\/]+$/, '');
  return trimmed ? `${trimmed}\\${fileName}` : fileName;
}

export function sameDocumentPath(left: string | null, right: string | null): boolean {
  return Boolean(left && right && normalizeDocumentPath(left) === normalizeDocumentPath(right));
}

export async function chooseAndOpenDocument(): Promise<ImportedContent | null> {
  const path = await chooseOpenPath(['dwrite', 'docx', 'txt', 'md', 'html', 'htm'], '写作文档');
  return path ? openDocumentAtPath(path) : null;
}

export async function openDocumentAtPath(path: string): Promise<ImportedContent> {
  const extension = extensionFromPath(path);
  if (extension === 'dwrite') {
    const diskContents = await readText(path);
    diskBaselines.set(normalizeDocumentPath(path), diskContents);
    return { kind: 'document', document: parseDocument(diskContents), path, diskContents, warnings: [] };
  }
  if (extension === 'docx') {
    const { importDocx } = await import('./docx');
    const imported = await importDocx(await readBinary(path));
    return { kind: 'html', html: imported.html, title: fileNameFromPath(path).replace(/\.docx$/i, ''), sourcePath: path, warnings: imported.warnings };
  }
  const text = await readText(path);
  if (extension === 'txt') {
    const html = text.split(/\r?\n/).map((line) => `<p>${htmlEscape(line) || '<br>'}</p>`).join('');
    return { kind: 'html', html, title: fileNameFromPath(path).replace(/\.txt$/i, ''), sourcePath: path, warnings: [] };
  }
  if (extension === 'md') return { kind: 'html', html: await marked.parse(text), title: fileNameFromPath(path).replace(/\.md$/i, ''), sourcePath: path, warnings: [] };
  if (extension === 'html' || extension === 'htm') return { kind: 'html', html: text, title: fileNameFromPath(path).replace(/\.html?$/i, ''), sourcePath: path, warnings: [] };
  throw new Error(`不支持的文件类型：.${extension}`);
}

export async function saveDwrite(
  document: DeepWriteDocument,
  currentPath: string | null,
  saveAs = false,
  defaultDirectory = ''
): Promise<SavedDwrite | null> {
  let path = saveAs ? null : currentPath;
  if (!path) path = await chooseSavePath(suggestedPath(defaultDirectory, `${document.title || '未命名文档'}.dwrite`), ['dwrite'], 'DeepWrite 文档');
  if (!path) return null;

  const writingCurrentPath = sameDocumentPath(path, currentPath);
  const isFork = saveAs && Boolean(currentPath) && !writingCurrentPath;
  const savedDocument = isFork ? forkDocumentForSaveAs(document) : document;
  const key = normalizeDocumentPath(path);
  const targetBaseline = writingCurrentPath
    ? (diskBaselines.get(key) ?? null)
    : await readTextIfExists(path);
  const diskContents = serializeDocument(savedDocument);
  await compareAndSwapText(path, targetBaseline, diskContents);
  diskBaselines.set(key, diskContents);
  return { path, document: savedDocument, diskContents };
}

export async function exportDocument(
  format: 'docx' | 'txt' | 'md' | 'html',
  title: string,
  content: JSONContent,
  html: string,
  text: string,
  defaultDirectory = ''
): Promise<string | null> {
  const path = await chooseSavePath(suggestedPath(defaultDirectory, `${title}.${format}`), [format], format.toUpperCase());
  if (!path) return null;
  if (format === 'docx') {
    const { exportDocx } = await import('./docx');
    await atomicWriteBinary(path, await exportDocx(content, title));
  }
  else if (format === 'txt') await atomicWriteText(path, text);
  else if (format === 'html') await atomicWriteText(path, `<!doctype html><meta charset="utf-8"><title>${htmlEscape(title)}</title><article>${html}</article>`);
  else {
    const converter = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-' });
    await atomicWriteText(path, `${converter.turndown(html)}\n`);
  }
  return path;
}

export async function writeRecovery(document: DeepWriteDocument, path: string | null): Promise<void> {
  await invokeCommand('write_recovery', {
    documentId: documentInstanceKey(document.id, path),
    contents: serializeDocument(document)
  });
}

export async function readRecovery(): Promise<RecoveredDwrite | null> {
  const payload = await invokeCommand<RecoveryPayload | null>('read_recovery');
  if (!payload) return null;
  return { key: payload.key, document: parseDocument(payload.contents) };
}

export async function clearRecovery(documentId: string, path: string | null): Promise<void> {
  await clearRecoveryKey(documentInstanceKey(documentId, path));
}

export async function clearRecoveryKey(key: string): Promise<void> {
  await invokeCommand('clear_recovery', { documentId: key });
}

export async function startupDocumentPath(): Promise<string | null> {
  return invokeCommand<string | null>('startup_document_path');
}

export async function takePendingOpenDocuments(): Promise<string[]> {
  return invokeCommand<string[]>('take_pending_open_documents');
}

export function importedHtmlDocument(title: string, content: JSONContent): DeepWriteDocument {
  return { ...createDocument(title), content, revision: 1, metadata: { importedAt: new Date().toISOString() } };
}
