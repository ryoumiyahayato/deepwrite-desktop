import { describe, expect, it } from 'vitest';
import type { JSONContent } from '@tiptap/core';
import { exportDocx } from './docx';

describe('basic DOCX export', () => {
  it('creates a valid OOXML zip containing basic rich structure', async () => {
    const content: JSONContent = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '标题' }] },
        { type: 'paragraph', attrs: { textAlign: 'center' }, content: [
          { type: 'text', text: '粗体', marks: [{ type: 'bold' }] },
          { type: 'text', text: '与下划线', marks: [{ type: 'underline' }] }
        ] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '列表项' }] }] }] },
        { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '单元格' }] }] }] }] },
        { type: 'pageBreak' }
      ]
    };
    const bytes = await exportDocx(content, '测试文档');
    expect(bytes.byteLength).toBeGreaterThan(1000);
    expect(Array.from(bytes.slice(0, 2))).toEqual([0x50, 0x4b]);
  });
});
