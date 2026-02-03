import crypto from 'crypto';

/**
 * Generates a unique, safe identifier for the bot based on its token.
 * This ensures that data (sessions, tasks) is scoped to the specific bot instance,
 * allowing multiple bots to share the same database without conflict.
 * @returns {string} Short hash ID (e.g., 'a1b2c3d4')
 */
export function getBotId() {
  const token = process.env.BOT_TOKEN ? process.env.BOT_TOKEN.trim() : null;
  if (!token) return 'global';

  // Create MD5 hash and take first 8 characters for brevity but uniqueness
  return crypto.createHash('md5').update(token).digest('hex').substring(0, 8);
}

/**
 * Simple Mutex/Semaphore for serializing tasks
 */
export class Semaphore {
  constructor(maxConcurrency = 1) {
    this.maxConcurrency = maxConcurrency;
    this.running = 0;
    this.queue = [];
  }

  async acquire() {
    if (this.running < this.maxConcurrency) {
      this.running++;
      return;
    }
    return new Promise(resolve => this.queue.push(resolve));
  }

  release() {
    this.running--;
    if (this.queue.length > 0) {
      this.running++;
      const next = this.queue.shift();
      next();
    }
  }
}

