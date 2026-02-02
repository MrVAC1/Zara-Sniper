import fs from 'fs';
import path from 'path';
import os from 'os';
import SystemCache from '../models/SystemCache.js';

import { getBotId } from '../utils/botUtils.js';

const SESSION_KEY = `zara_session_${getBotId()}`;
console.log(`[Session] Configuration - Key: ${SESSION_KEY}`);
// Use system temp directory or local temp to ensure write permissions
const TEMP_DIR = os.tmpdir();
const SESSION_FILE_PATH = path.join(TEMP_DIR, 'zara_auth.json');

/**
 * Loads session from MongoDB and writes to a temporary file.
 * Returns the path to the temporary file if session exists, else null.
 */
export async function loadSession() {
  try {
    const sessionDoc = await SystemCache.findById(SESSION_KEY);

    if (sessionDoc && sessionDoc.data) {
      console.log(`[Session] Found persisted session (updated: ${sessionDoc.updatedAt})`);

      // Ensure data is stringified correctly for Playwright
      // User Request: "JSON.stringify(data, null, 2)"
      const sessionContent = JSON.stringify(sessionDoc.data, null, 2);

      fs.writeFileSync(SESSION_FILE_PATH, sessionContent);
      console.log(`[Session] Wrote session to temp file: ${SESSION_FILE_PATH}`);

      return SESSION_FILE_PATH;
    } else {
      console.log('[Session] No persisted session found in DB.');
      return null;
    }
  } catch (error) {
    console.error('[Session] Error loading session:', error);
    return null;
  }
}

/**
 * Saves the raw session data object to MongoDB.
 * @param {Object} storageState 
 */
export async function saveSessionData(storageState) {
  try {
    await SystemCache.findOneAndUpdate(
      { _id: SESSION_KEY },
      {
        _id: SESSION_KEY,
        data: storageState,
        updatedAt: new Date()
      },
      { upsert: true, new: true }
    );
    console.log(`[Session] Successfully saved session to DB at ${new Date().toLocaleTimeString()}`);
  } catch (error) {
    console.error('[Session] Failed to save session data:', error.message);
  }
}

/**
 * Saves the current browser context state to MongoDB.
 * @param {import('playwright').BrowserContext} context 
 */
export async function saveSession(context) {
  if (!context) return;

  try {
    const storageState = await context.storageState();
    await saveSessionData(storageState);
  } catch (error) {
    console.error('[Session] Failed to save session:', error.message);
  }
}

/**
 * Starts a periodic sync to save session every 15 minutes.
 * @param {import('playwright').BrowserContext} context 
 */
export function startSessionSync(context) {
  if (!context) {
    console.warn('[Session] Cannot start sync: Context is null');
    return;
  }

  console.log('[Session] Starting periodic session sync (every 15 min)');

  // Initial save attempt
  saveSession(context).catch(e => console.error('[Session] Initial save failed:', e.message));

  setInterval(() => {
    saveSession(context).catch(e => console.error('[Session] Periodic save failed:', e.message));
  }, 15 * 60 * 1000); // 15 minutes
}
