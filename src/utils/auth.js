/**
 * Checks if a given Telegram User ID is in the OWNER_ID list.
 * OWNER_ID in .env can be a single ID or a comma-separated list.
 * @param {number|string} userId 
 * @returns {boolean}
 */
export function isOwner(userId) {
  const ownerIdEnv = process.env.OWNER_ID;
  if (!ownerIdEnv) return false;

  const owners = ownerIdEnv.split(',').map(id => id.trim());
  return owners.includes(userId.toString());
}

/**
 * Returns an array of all owner IDs as numbers.
 * @returns {number[]}
 */
export function getOwnerIds() {
  const ownerIdEnv = process.env.OWNER_ID;
  if (!ownerIdEnv) return [];

  return ownerIdEnv.split(',')
    .map(id => parseInt(id.trim()))
    .filter(id => !isNaN(id));
}
