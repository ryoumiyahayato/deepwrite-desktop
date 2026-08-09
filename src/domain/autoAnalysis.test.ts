import { describe, expect, it } from 'vitest';
import { recentContext, shouldAutoAnalyze } from './autoAnalysis';
import { stableHash } from './ai';

describe('idle AI analysis guard', () => {
  it('does not repeat unchanged content or run while disabled', () => {
    expect(shouldAutoAnalyze(0, true, '变化', null)).toBe(false);
    expect(shouldAutoAnalyze(3, false, '变化', null)).toBe(false);
    expect(shouldAutoAnalyze(3, true, '相同内容', stableHash('相同内容'))).toBe(false);
    expect(shouldAutoAnalyze(3, true, '新内容', stableHash('旧内容'))).toBe(true);
  });

  it('selects recent paragraphs within the context budget', () => {
    expect(recentContext('第一段\n第二段较长\n最后一段', 9)).toBe('最后一段');
  });
});
