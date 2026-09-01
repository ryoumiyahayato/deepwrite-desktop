import type { JSONContent } from '@tiptap/core';
import { z } from 'zod';

export const DWRITE_SCHEMA_VERSION = 2;
export const DWRITE_EDITOR_SCHEMA = 'tiptap-json-v1' as const;

export interface DocumentMetadata {
  author?: string;
  description?: string;
  tags?: string[];
  language?: string;
  [key: string]: unknown;
}

export interface DeepWriteDocument {
  schemaVersion: number;
  editorSchema: typeof DWRITE_EDITOR_SCHEMA;
  id: string;
  title: string;
  content: JSONContent;
  createdAt: string;
  updatedAt: string;
  revision: number;
  metadata: DocumentMetadata;
}

const jsonContentSchema: z.ZodType<JSONContent> = z.lazy(() =>
  z.object({
    type: z.string().optional(),
    attrs: z.record(z.string(), z.unknown()).optional(),
    content: z.array(jsonContentSchema).optional(),
    marks: z.array(z.object({ type: z.string(), attrs: z.record(z.string(), z.unknown()).optional() })).optional(),
    text: z.string().optional()
  })
);

const legacyV1Schema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  title: z.string(),
  content: jsonContentSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  revision: z.number().int().nonnegative(),
  metadata: z.record(z.string(), z.unknown())
});

export const deepWriteDocumentSchema: z.ZodType<DeepWriteDocument> = z.object({
  schemaVersion: z.literal(DWRITE_SCHEMA_VERSION),
  editorSchema: z.literal(DWRITE_EDITOR_SCHEMA),
  id: z.string().min(1),
  title: z.string(),
  content: jsonContentSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  revision: z.number().int().nonnegative(),
  metadata: z.record(z.string(), z.unknown())
});

const sampleContent: JSONContent = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '未命名作品' }] },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '第一章' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '从这里开始写作。DeepWrite 会把文章保存在本地。' }] }
  ]
};

export function createDocument(title = '未命名文档'): DeepWriteDocument {
  const now = new Date().toISOString();
  return {
    schemaVersion: DWRITE_SCHEMA_VERSION,
    editorSchema: DWRITE_EDITOR_SCHEMA,
    id: crypto.randomUUID(),
    title,
    content: structuredClone(sampleContent),
    createdAt: now,
    updatedAt: now,
    revision: 0,
    metadata: { language: 'zh-CN', tags: [] }
  };
}

export function forkDocumentForSaveAs(document: DeepWriteDocument): DeepWriteDocument {
  const now = new Date().toISOString();
  const lineageId = typeof document.metadata.lineageId === 'string' && document.metadata.lineageId.trim()
    ? document.metadata.lineageId
    : document.id;
  return {
    ...document,
    id: crypto.randomUUID(),
    updatedAt: now,
    metadata: {
      ...document.metadata,
      lineageId,
      forkedFromDocumentId: document.id,
      forkedAt: now
    }
  };
}

export function serializeDocument(document: DeepWriteDocument): string {
  return `${JSON.stringify(deepWriteDocumentSchema.parse(document), null, 2)}\n`;
}

export function parseDocument(input: string): DeepWriteDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new Error('文件不是有效的 JSON，无法作为 DeepWrite 文档打开。');
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('文档结构无效：缺少文档对象。');
  const version = (parsed as { schemaVersion?: unknown }).schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version)) throw new Error('文档结构无效：缺少有效的 schemaVersion。');
  if (version > DWRITE_SCHEMA_VERSION) {
    throw new Error(`该文档由更新版本的 DeepWrite 创建（schema ${version}）。`);
  }
  if (version === 1) {
    const legacy = legacyV1Schema.safeParse(parsed);
    if (!legacy.success) throw new Error(`文档结构无效：${legacy.error.issues[0]?.message ?? '未知错误'}`);
    return deepWriteDocumentSchema.parse({ ...legacy.data, schemaVersion: DWRITE_SCHEMA_VERSION, editorSchema: DWRITE_EDITOR_SCHEMA });
  }
  if (version !== DWRITE_SCHEMA_VERSION) throw new Error(`不支持的旧版 DeepWrite 文档 schema：${version}。`);
  const result = deepWriteDocumentSchema.safeParse(parsed);
  if (!result.success) throw new Error(`文档结构无效：${result.error.issues[0]?.message ?? '未知错误'}`);
  return result.data;
}

export function plainText(content: JSONContent): string {
  if (typeof content.text === 'string') return content.text;
  const children = content.content ?? [];
  const value = children.map(plainText).join(content.type === 'doc' ? '\n' : '');
  return ['paragraph', 'heading', 'blockquote', 'listItem'].includes(content.type ?? '') ? `${value}\n` : value;
}

export interface DocumentStats {
  words: number;
  characters: number;
  paragraphs: number;
}

export function documentStats(text: string): DocumentStats {
  const normalized = text.replace(/\r\n/g, '\n');
  const han = normalized.match(/[\p{Script=Han}]/gu)?.length ?? 0;
  const nonHanWords = normalized
    .replace(/[\p{Script=Han}]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  return {
    words: han + nonHanWords,
    characters: [...normalized.replace(/\s/g, '')].length,
    paragraphs: normalized.split(/\n+/).filter((line) => line.trim().length > 0).length
  };
}

export interface OutlineItem { id: string; level: number; text: string; position: number }

export function extractOutline(content: JSONContent): OutlineItem[] {
  const result: OutlineItem[] = [];
  const nodeSize = (node: JSONContent): number => {
    if (typeof node.text === 'string') return node.text.length;
    const contentSize = (node.content ?? []).reduce((total, child) => total + nodeSize(child), 0);
    return node.type === 'doc' ? contentSize : Math.max(1, contentSize + 2);
  };
  const walk = (node: JSONContent, position: number) => {
    if (node.type === 'heading') {
      result.push({
        id: `heading-${position}`,
        level: Number(node.attrs?.level ?? 1),
        text: plainText(node).trim() || '无标题',
        position: position + 1
      });
    }
    let childPosition = node.type === 'doc' ? position : position + 1;
    for (const child of node.content ?? []) {
      walk(child, childPosition);
      childPosition += nodeSize(child);
    }
  };
  walk(content, 0);
  return result;
}
