/**
 * A FIFO counting semaphore for bounding in-process concurrency. Never exceeds
 * `max` active permits; releasing hands a freed slot directly to the next
 * waiter (so the count stays stable rather than dropping then re-incrementing).
 */
export class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly max: number) {}

  acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  release(): void {
    const next = this.waiters.shift();
    if (next)
      next(); // transfer the slot; active stays the same
    else this.active--; // no waiter → free the slot
  }

  /** Run `fn` while holding a permit, releasing it on success or failure. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}
