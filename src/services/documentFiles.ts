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

const htmlEscape = (input: string) => input.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);

export async function chooseAndOpenDocument(): Promise<ImportedContent | null> {
  const path = await chooseOpenPath(['dwrite', 'docx', 'txt', 'md', 'html', 'htm'], '写作文档');
  return path ? openDocumentAtPath(path) : null;
}

export async function openDocumentAtPath(path: string): Promise<ImportedContent> {
  const extension = extensionFromPath(path);
  if (extension === 'dwrite') {
    const diskContents = await readText(path);
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

function suggestedPath(directory: string, fileName: string): string {
  const trimmed = directory.trim().replace(/[\\/]+$/, '');
  return trimmed ? `${trimmed}\\${fileName}` : fileName;
}

function normalizedPath(path: string): string {
  return path.replace(/\//g, '\\').replace(/\\+/g, '\\').toLocaleLowerCase('en-US');
}

export function sameDocumentPath(left: string | null, right: string | null): boolean {
  return Boolean(left && right && normalizedPath(left) === normalizedPath(right));
}

export async function saveDwrite(
  document: DeepWriteDocument,
  currentPath: string | null,
  saveAs = false,
  defaultDirectory = '',
  expectedDiskContents: string | null = null
): Promise<SavedDwrite | null> {
  let path = saveAs ? null : currentPath;
  if (!path) path = await chooseSavePath(suggestedPath(defaultDirectory, `${document.title || '未命名文档'}.dwrite`), ['dwrite'], 'DeepWrite 文档');
  if (!path) return null;

  const writingCurrentPath = sameDocumentPath(path, currentPath);
  const isFork = saveAs && Boolean(currentPath) && !writingCurrentPath;
  const savedDocument = isFork ? forkDocumentForSaveAs(document) : document;
  const targetBaseline = writingCurrentPath ? expectedDiskContents : await readTextIfExists(path);
  const diskContents = serializeDocument(savedDocument);
  await compareAndSwapText(path, targetBaseline, diskContents);
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

export async function writeRecovery(document: DeepWriteDocument): Promise<void> {
  await invokeCommand('write_recovery', { documentId: document.id, contents: serializeDocument(document) });
}

export async function readRecovery(): Promise<DeepWriteDocument | null> {
  const contents = await invokeCommand<string | null>('read_recovery');
  if (!contents) return null;
  return parseDocument(contents);
}

export async function clearRecovery(documentId: string): Promise<void> {
  await invokeCommand('clear_recovery', { documentId });
}

export function importedHtmlDocument(title: string, content: JSONContent): DeepWriteDocument {
  return { ...createDocument(title), content, revision: 1, metadata: { importedAt: new Date().toISOString() } };
}
