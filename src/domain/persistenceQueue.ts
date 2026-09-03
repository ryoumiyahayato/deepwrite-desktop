export class PersistenceQueue {
  private tail: Promise<void> = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.catch(() => undefined).then(operation);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  async waitForIdle(): Promise<void> {
    while (true) {
      const observed = this.tail;
      await observed;
      if (observed === this.tail) return;
    }
  }
}
