/**
 * Simple Async Mutex Lock
 * Usage:
 * const lock = new AsyncLock();
 * await lock.acquire();
 * try { ... } finally { lock.release(); }
 */
export class AsyncLock {
  constructor() {
    this._queue = [];
    this._locked = false;
  }

  /**
   * Acquire the lock. Waits if currently locked.
   * @returns {Promise<void>}
   */
  async acquire() {
    if (this._locked) {
      await new Promise(resolve => this._queue.push(resolve));
    }
    this._locked = true;
  }

  /**
   * Release the lock. Lets the next waiting promise proceed.
   */
  release() {
    if (this._queue.length > 0) {
      const resolve = this._queue.shift();
      resolve();
    } else {
      this._locked = false;
    }
  }
}
