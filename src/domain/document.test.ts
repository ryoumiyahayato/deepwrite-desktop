import { describe, expect, it } from 'vitest';
import { createDocument, documentStats, DWRITE_EDITOR_SCHEMA, DWRITE_SCHEMA_VERSION, extractOutline, forkDocumentForSaveAs, parseDocument, serializeDocument } from './document';

describe('DeepWrite document serialization', () => {
  it('round-trips independent .dwrite JSON content', () => {
    const document = createDocument('测试长篇');
    document.metadata = { author: '作者', tags: ['小说'] };
    const restored = parseDocument(serializeDocument(document));
    expect(restored).toEqual(document);
    expect(restored.schemaVersion).toBe(DWRITE_SCHEMA_VERSION);
    expect(restored.editorSchema).toBe(DWRITE_EDITOR_SCHEMA);
    expect(restored.content.type).toBe('doc');
  });

  it('migrates schema v1 documents into the current editor contract', () => {
    const current = createDocument('旧稿');
    const legacy = { ...current, schemaVersion: 1 } as Record<string, unknown>;
    delete legacy.editorSchema;
    const restored = parseDocument(JSON.stringify(legacy));
    expect(restored.schemaVersion).toBe(DWRITE_SCHEMA_VERSION);
    expect(restored.editorSchema).toBe(DWRITE_EDITOR_SCHEMA);
    expect(restored.id).toBe(current.id);
    expect(restored.content).toEqual(current.content);
  });

  it('rejects malformed or future documents with a clear error', () => {
    expect(() => parseDocument('{bad json')).toThrow(/有效的 JSON/);
    expect(() => parseDocument(JSON.stringify({ schemaVersion: 1 }))).toThrow(/文档结构无效/);
    const future = { ...createDocument(), schemaVersion: 99 };
    expect(() => parseDocument(JSON.stringify(future))).toThrow(/更新版本/);
  });

  it('gives Save As copies an independent identity while preserving lineage', () => {
    const source = createDocument('原稿');
    const firstCopy = forkDocumentForSaveAs(source);
    const secondCopy = forkDocumentForSaveAs(firstCopy);
    expect(firstCopy.id).not.toBe(source.id);
    expect(secondCopy.id).not.toBe(firstCopy.id);
    expect(firstCopy.metadata.lineageId).toBe(source.id);
    expect(secondCopy.metadata.lineageId).toBe(source.id);
    expect(firstCopy.metadata.forkedFromDocumentId).toBe(source.id);
    expect(secondCopy.metadata.forkedFromDocumentId).toBe(firstCopy.id);
    expect(firstCopy.content).toEqual(source.content);
    expect(firstCopy.revision).toBe(source.revision);
  });

  it('counts Chinese characters, latin words and paragraphs', () => {
    expect(documentStats('你好 world\n第二段')).toEqual({ words: 6, characters: 10, paragraphs: 2 });
  });

  it('calculates outline positions using ProseMirror node sizes', () => {
    const content = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '标题' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '一段很长的正文' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '下一章' }] }
      ]
    };
    expect(extractOutline(content)).toEqual([
      expect.objectContaining({ text: '标题', position: 1 }),
      expect.objectContaining({ text: '下一章', position: 14 })
    ]);
  });
});
