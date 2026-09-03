import { describe, expect, it } from 'vitest';
import { PersistenceQueue } from './persistenceQueue';

describe('PersistenceQueue', () => {
  it('serializes persistence operations and waitForIdle observes later queued work', async () => {
    const queue = new PersistenceQueue();
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });

    const first = queue.run(async () => {
      order.push('first-start');
      await firstGate;
      order.push('first-end');
    });
    const idle = queue.waitForIdle().then(() => order.push('idle'));
    const second = queue.run(async () => { order.push('second'); });

    releaseFirst();
    await Promise.all([first, second, idle]);
    expect(order).toEqual(['first-start', 'first-end', 'second', 'idle']);
  });
});
