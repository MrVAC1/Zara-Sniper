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

export async function loadSession() {
  try {
    const ownerIdFull = process.env.OWNER_ID || 'default';
    const primaryOwner = ownerIdFull.split(',')[0].trim();
    const sanitizedPidOwner = primaryOwner.replace(/[^a-zA-Z0-9]/g, '');

    // STRICT PATH HYGIENE: ./profiles/zara_user_profile_{owner}/zara_auth.json
    const PROFILE_DIR = path.join(process.cwd(), 'profiles', `zara_user_profile_${sanitizedPidOwner}`);
    const SESSION_FILE_PATH = path.join(PROFILE_DIR, 'zara_auth.json');

    if (!fs.existsSync(PROFILE_DIR)) {
      fs.mkdirSync(PROFILE_DIR, { recursive: true });
    }

    // 1. Check File Existence
    if (!fs.existsSync(SESSION_FILE_PATH)) {
      console.warn(`[Session] ⚠️ Session file missing at ${SESSION_FILE_PATH}`);
      console.warn('[Session] Starting fresh session. Please log in manually or via automation.');
      return null;
    }

    // 2. Read & Validate Content
    const fileContent = fs.readFileSync(SESSION_FILE_PATH, 'utf-8');
    if (!fileContent || fileContent.trim() === '') {
      console.warn(`[Session] ⚠️ Session file is empty at ${SESSION_FILE_PATH}. Starting fresh.`);
      return null;
    }

    let data;
    try {
      data = JSON.parse(fileContent);
    } catch (e) {
      console.error(`[Session] ❌ Session file corrupted (JSON Parse Error): ${e.message}. Starting fresh.`);
      return null;
    }

    if (!data.cookies || !Array.isArray(data.cookies) || data.cookies.length === 0) {
      console.warn(`[Session] ⚠️ Session is empty (0 Cookies found). Starting fresh.`);
      return null;
    }

    console.log(`[Session] ✅ Validated session from: ${SESSION_FILE_PATH} (Cookies: ${data.cookies.length})`);
    return SESSION_FILE_PATH;

  } catch (error) {
    console.error('[Session] Critical Error loading session:', error);
    // Don't exit, just return null to try fresh
    return null;
  }
}

/**
 * Save browser session (cookies & storage) to file
 * @param {import('playwright').BrowserContext} context 
 */
export async function saveSession(context) {
  try {
    const ownerIdFull = process.env.OWNER_ID || 'default';
    const primaryOwner = ownerIdFull.split(',')[0].trim();
    const sanitizedPidOwner = primaryOwner.replace(/[^a-zA-Z0-9]/g, '');

    const PROFILE_DIR = path.join(process.cwd(), 'profiles', `zara_user_profile_${sanitizedPidOwner}`);
    const SESSION_FILE_PATH = path.join(PROFILE_DIR, 'zara_auth.json');

    if (!fs.existsSync(PROFILE_DIR)) {
      fs.mkdirSync(PROFILE_DIR, { recursive: true });
    }

    const cookies = await context.cookies();
    // We can also save origins/localStorage if needed using context.storageState()
    // But existing logic seemed to focus on cookies or full state.
    // context.storageState() returns { cookies: [], origins: [] }
    const storageState = await context.storageState();

    fs.writeFileSync(SESSION_FILE_PATH, JSON.stringify(storageState, null, 2));
    console.log(`[Session] 💾 Saved session to ${SESSION_FILE_PATH} (Cookies: ${cookies.length})`);
    return true;
  } catch (error) {
    console.error(`[Session] ❌ Failed to save session: ${error.message}`);
    return false;
  }
}

