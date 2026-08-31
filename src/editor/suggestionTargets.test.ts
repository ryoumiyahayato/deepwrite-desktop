import { Schema } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';
import { aiResponseSchema, attachSuggestionContext, createSuggestionContext } from '../domain/ai';
import { positionAtTextOffset, resolveSuggestionTargets } from './suggestionTargets';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block' },
    text: { group: 'inline' }
  }
});

function paragraph(text: string) {
  return schema.node('paragraph', null, text ? [schema.text(text)] : []);
}

describe('structured AI suggestion target mapping', () => {
  it('maps a text offset through multiple ProseMirror blocks', () => {
    const document = schema.node('doc', null, [paragraph('第一段'), paragraph('这里非常的安静')]);
    const fullText = document.textBetween(0, document.content.size, '\n');
    const offset = fullText.indexOf('非常的安静');
    const from = positionAtTextOffset(document, 0, document.content.size, offset);
    const to = positionAtTextOffset(document, 0, document.content.size, offset + '非常的安静'.length);
    expect(from).not.toBeNull();
    expect(to).not.toBeNull();
    expect(document.textBetween(from!, to!, '\n')).toBe('非常的安静');
  });

  it('resolves only suggestions from the same document revision', () => {
    const document = schema.node('doc', null, [paragraph('第一段'), paragraph('这里非常的安静')]);
    const selected = document.textBetween(0, document.content.size, '\n');
    const context = createSuggestionContext('doc-1', 4, 0, document.content.size, selected);
    const response = aiResponseSchema.parse({
      summary: '一处问题',
      suggestions: [{ id: 's1', type: 'clarity', severity: 'minor', original: '非常的安静', replacement: '非常安静', reason: '精简' }],
      fullRewrite: null
    });
    const attached = attachSuggestionContext(response, context);
    const resolved = resolveSuggestionTargets(attached, document, 'doc-1', 4)[0];
    expect(resolved.status).toBe('pending');
    expect(document.textBetween(resolved.targetFrom!, resolved.targetTo!, '\n')).toBe('非常的安静');

    const stale = resolveSuggestionTargets(attached, document, 'doc-1', 5)[0];
    expect(stale.status).toBe('stale');
    expect(stale.targetFrom).toBeNull();
  });
});
