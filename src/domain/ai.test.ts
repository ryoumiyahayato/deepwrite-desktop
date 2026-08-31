import { describe, expect, it } from 'vitest';
import { aiResponseSchema, attachSuggestionContext, createSuggestionContext, isSuggestionStale, stableHash } from './ai';

const validResponse = {
  summary: '发现一处表达问题',
  suggestions: [{ id: 's1', type: 'clarity', severity: 'minor', original: '非常的安静', replacement: '非常安静', reason: '删除多余助词' }],
  fullRewrite: null
};

describe('AI response validation and concurrency protection', () => {
  it('strictly validates the documented JSON shape', () => {
    expect(aiResponseSchema.parse(validResponse).suggestions).toHaveLength(1);
    expect(aiResponseSchema.safeParse({ ...validResponse, secretField: true }).success).toBe(false);
    expect(aiResponseSchema.safeParse({ ...validResponse, suggestions: [{ ...validResponse.suggestions[0], severity: 'critical' }] }).success).toBe(false);
  });

  it('uses exact text plus document identity and revision for stale checks', () => {
    expect(stableHash('原文')).toBe(stableHash('原文'));
    const context = createSuggestionContext('doc-1', 7, 10, 16, '这里非常的安静');
    const suggestion = attachSuggestionContext(aiResponseSchema.parse(validResponse), context)[0];
    expect(suggestion.relativeFrom).toBe(2);
    expect(suggestion.relativeTo).toBe(7);
    expect(isSuggestionStale(suggestion, '非常的安静', 'doc-1', 7)).toBe(false);
    expect(isSuggestionStale(suggestion, '已经被用户改写', 'doc-1', 7)).toBe(true);
    expect(isSuggestionStale(suggestion, '非常的安静', 'doc-2', 7)).toBe(true);
    expect(isSuggestionStale(suggestion, '非常的安静', 'doc-1', 8)).toBe(true);
  });

  it('refuses ambiguous or cross-paragraph replacement anchors', () => {
    const duplicateContext = createSuggestionContext('doc-1', 1, 1, 20, '安静，然后仍然安静');
    const duplicate = aiResponseSchema.parse({
      ...validResponse,
      suggestions: [{ ...validResponse.suggestions[0], original: '安静' }]
    });
    expect(attachSuggestionContext(duplicate, duplicateContext)[0].relativeFrom).toBeNull();

    const multilineContext = createSuggestionContext('doc-1', 1, 1, 20, '第一段\n第二段');
    const multiline = aiResponseSchema.parse({
      ...validResponse,
      suggestions: [{ ...validResponse.suggestions[0], original: '第一段\n第二段' }]
    });
    expect(attachSuggestionContext(multiline, multilineContext)[0].relativeFrom).toBeNull();
  });
});
