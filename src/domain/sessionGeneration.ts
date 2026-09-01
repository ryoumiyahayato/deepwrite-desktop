export class SessionGeneration {
  private value = 0;

  current(): number { return this.value; }

  bump(): number {
    this.value += 1;
    return this.value;
  }

  reset(): void { this.value = 0; }

  isCurrent(generation: number): boolean { return this.value === generation; }
}
