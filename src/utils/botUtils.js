import crypto from 'crypto';

/**
 * Generates a unique, safe identifier for the bot based on its token.
 * This ensures that data (sessions, tasks) is scoped to the specific bot instance,
 * allowing multiple bots to share the same database without conflict.
 * @returns {string} Short hash ID (e.g., 'a1b2c3d4')
 */
export function getBotId() {
  const token = process.env.BOT_TOKEN;
  if (!token) return 'global';

  // Create MD5 hash and take first 8 characters for brevity but uniqueness
  return crypto.createHash('md5').update(token).digest('hex').substring(0, 8);
}
