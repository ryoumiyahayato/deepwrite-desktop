import { describe, expect, it } from 'vitest';
import { SessionGeneration } from './sessionGeneration';

describe('SessionGeneration', () => {
  it('tracks transient edits independently from persisted document revision', () => {
    const generation = new SessionGeneration();
    const initial = generation.current();
    expect(generation.isCurrent(initial)).toBe(true);
    generation.bump();
    expect(generation.isCurrent(initial)).toBe(false);
    expect(generation.current()).toBe(1);
  });

  it('resets when a different document session is loaded', () => {
    const generation = new SessionGeneration();
    generation.bump(); generation.bump();
    generation.reset();
    expect(generation.current()).toBe(0);
  });
});
