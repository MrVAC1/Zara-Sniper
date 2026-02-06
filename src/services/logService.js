import Log from '../models/Log.js';
import fs from 'fs';
import path from 'path';
import { sessionLogger } from './sessionLogger.js';

let botInstance = null;
const OWNER_IDS = process.env.OWNER_ID ? process.env.OWNER_ID.split(',').map(id => id.trim()) : [];

// Helper to set bot instance externally (from index.js)
export function setLogServiceBot(bot) {
  botInstance = bot;
}

/**
 * Log a message to MongoDB
 * @param {'INFO'|'WARN'|'ERROR'|'DEBUG'} level 
 * @param {string} message 
 * @param {Object} [metadata] 
 */
export async function logToDb(level, message, metadata = {}) {
  try {
    // Console output for immediate visibility
    // Note: Console output is now handled globally in index.js or locally by caller
    // But we keeping this for safety if direct call
    // const timestamp = new Date().toLocaleTimeString();
    // const logMethod = level === 'ERROR' ? console.error : (level === 'WARN' ? console.warn : console.log);

    const { error: errorObj, ...dbMetadata } = metadata;

    await Log.create({
      level,
      message,
      metadata: dbMetadata
    });

    // Session-based File Logging (Includes error stack if provided)
    sessionLogger.log(level === 'DEBUG' ? 'INFO' : level, { context: 'SYSTEM', message, ...metadata }, errorObj);
  } catch (err) {
    console.error(`[System] Failed to write log to DB: ${err.message}`);
  }
}

/**
 * Report an error: Log to DB + Screenshot + Telegram Alert
 * @param {import('playwright').Page} page 
 * @param {Error|string} error 
 * @param {string} contextMsg 
 */
export async function reportError(page, error, contextMsg = '') {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const fullMessage = `${contextMsg} | Error: ${errorMessage}`;

  // 1. Log to DB (+ Session File via hook in logToDb)
  // We pass the actual error object in metadata so logToDb can pass it to sessionLogger
  await logToDb('ERROR', fullMessage, { stack: error.stack, error });

  // 2. Take Screenshot (if page is valid)
  let screenshotBuffer = null;
  if (page && !page.isClosed()) {
    try {
      // User Request: "JPEG format, quality 70%"
      screenshotBuffer = await page.screenshot({
        type: 'jpeg',
        quality: 70,
        fullPage: false
      });
    } catch (shotErr) {
      console.warn(`[LogService] Clean screenshot failed: ${shotErr.message}`);
    }
  }

  // 3. Telegram Alert
  if (botInstance && OWNER_IDS.length > 0) {
    const caption = `🔴 <b>CRITICAL ERROR</b>\n\nContext: ${contextMsg}\nError: <code>${errorMessage}</code>`;

    // Broadcast to all owners
    for (const ownerId of OWNER_IDS) {
      if (!ownerId) continue;

      try {
        if (screenshotBuffer) {
          await botInstance.telegram.sendPhoto(ownerId, { source: screenshotBuffer }, {
            caption,
            parse_mode: 'HTML'
          });
        } else {
          await botInstance.telegram.sendMessage(ownerId, caption, { parse_mode: 'HTML' });
        }
      } catch (tgErr) {
        console.error(`[LogService] Failed to send alert to ${ownerId}: ${tgErr.message}`);
      }
    }
  }
}
