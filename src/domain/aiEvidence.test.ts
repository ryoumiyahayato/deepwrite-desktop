import { describe, expect, it } from 'vitest';
import { buildDocumentEvidence, buildDocumentEvidenceBatches } from './aiEvidence';

describe('document evidence budgeting', () => {
  it('uses the full document when it fits', () => {
    const result = buildDocumentEvidence('完整短文', 2000);
    expect(result.complete).toBe(true);
    expect(result.text).toBe('完整短文');
    expect(result.scopeLabel).toContain('全文');
  });

  it('covers every part of an oversized document with bounded overlapping batches', () => {
    const source = Array.from({ length: 1000 }, (_, index) => `段落${index}`).join('\n');
    const batches = buildDocumentEvidenceBatches(source, 1600);
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.every((batch) => batch.text.length <= 1600)).toBe(true);
    expect(batches[0].start).toBe(0);
    expect(batches.at(-1)?.end).toBe(source.length);
    for (let index = 1; index < batches.length; index += 1) {
      expect(batches[index].start).toBeLessThanOrEqual(batches[index - 1].end);
    }
    expect(batches.map((batch) => batch.text).join('\n')).toContain('段落0');
    expect(batches.map((batch) => batch.text).join('\n')).toContain('段落999');
    expect(batches[0].scopeLabel).toContain(`1/${batches.length}`);
  });

  it('does not silently fall back to five representative samples', () => {
    const source = Array.from({ length: 300 }, (_, index) => `SECTION-${String(index).padStart(3, '0')}-${'x'.repeat(30)}`).join('\n');
    const batches = buildDocumentEvidenceBatches(source, 1800);
    const covered = batches.map((batch) => batch.text).join('\n');
    expect(batches.length).toBeGreaterThan(5);
    expect(covered).toContain('SECTION-000');
    expect(covered).toContain('SECTION-150');
    expect(covered).toContain('SECTION-299');
  });
});
