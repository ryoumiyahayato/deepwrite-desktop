import { describe, expect, it } from 'vitest';
import { isDiagnosticTask } from './deepseek';

describe('AI diagnostic task contract', () => {
  it('classifies consistency and reasoning checks as diagnostics', () => {
    expect(isDiagnosticTask('logic')).toBe(true);
    expect(isDiagnosticTask('contradiction')).toBe(true);
    expect(isDiagnosticTask('character')).toBe(true);
  });

  it('keeps editing and continuation tasks out of the diagnostic-only path', () => {
    expect(isDiagnosticTask('rewrite')).toBe(false);
    expect(isDiagnosticTask('proofread')).toBe(false);
    expect(isDiagnosticTask('continue')).toBe(false);
  });
});
