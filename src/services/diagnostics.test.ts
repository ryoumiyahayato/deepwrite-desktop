import { describe, expect, it } from 'vitest';
import { buildFullDocumentDiagnosticPlan } from './diagnostics';

describe('full-document diagnostic disclosure', () => {
  it('uses the exact evidence plan disclosed to the user', () => {
    const source = Array.from({ length: 500 }, (_, index) => `段落-${index}-${'x'.repeat(24)}`).join('\n');
    const plan = buildFullDocumentDiagnosticPlan(source, 1600);
    expect(plan.batches.length).toBeGreaterThan(1);
    expect(plan.disclosure.requestCount).toBe(plan.batches.length);
    expect(plan.disclosure.characterCount).toBe(source.trim().length);
    expect(plan.disclosure.message).toContain(`${plan.batches.length} 个有重叠的请求批次`);
    expect(plan.disclosure.message).toContain('当前文档全文');
    expect(plan.disclosure.message).toContain('DeepSeek API');
    expect(plan.disclosure.message).toContain('只有点击“确定”');
  });
});
