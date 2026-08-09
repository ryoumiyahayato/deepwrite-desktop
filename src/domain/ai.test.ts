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

  it('hashes deterministically and marks changed targets stale', () => {
    expect(stableHash('原文')).toBe(stableHash('原文'));
    const context = createSuggestionContext('doc-1', 7, 10, 16, '这里非常的安静');
    const suggestion = attachSuggestionContext(aiResponseSchema.parse(validResponse), context)[0];
    expect(suggestion.targetFrom).toBe(12);
    expect(isSuggestionStale(suggestion, '非常的安静', 'doc-1')).toBe(false);
    expect(isSuggestionStale(suggestion, '已经被用户改写', 'doc-1')).toBe(true);
    expect(isSuggestionStale(suggestion, '非常的安静', 'doc-2')).toBe(true);
  });
});
