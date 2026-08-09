import { afterEach, describe, expect, it, vi } from 'vitest';
import { debounce } from './debounce';

describe('autosave debounce', () => {
  afterEach(() => vi.useRealTimers());

  it('saves once 1.5 seconds after the last edit', () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const autosave = debounce(save, 1500);
    autosave('revision-1');
    vi.advanceTimersByTime(1000);
    autosave('revision-2');
    vi.advanceTimersByTime(1499);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith('revision-2');
  });

  it('can flush or cancel a pending save', () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const autosave = debounce(save, 1500);
    autosave('now'); autosave.flush(); expect(save).toHaveBeenCalledWith('now');
    autosave('cancelled'); autosave.cancel(); vi.runAllTimers(); expect(save).toHaveBeenCalledOnce();
  });
});
