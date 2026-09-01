import { describe, expect, it } from 'vitest';
import { buildDocumentEvidence } from './aiEvidence';

describe('document evidence budgeting', () => {
  it('uses the full document when it fits', () => {
    const result = buildDocumentEvidence('完整短文', 2000);
    expect(result.complete).toBe(true);
    expect(result.text).toBe('完整短文');
    expect(result.scopeLabel).toContain('全文');
  });

  it('samples across an oversized document and discloses the limitation', () => {
    const source = Array.from({ length: 1000 }, (_, index) => `段落${index}`).join('\n');
    const result = buildDocumentEvidence(source, 1600);
    expect(result.complete).toBe(false);
    expect(result.text.length).toBeLessThanOrEqual(1600);
    expect(result.text).toContain('段落0');
    expect(result.text).toContain('段落999');
    expect(result.scopeLabel).toContain('未覆盖');
  });
});
