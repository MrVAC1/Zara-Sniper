import Log from '../models/Log.js';
import fs from 'fs';
import path from 'path';

let botInstance = null;
const OWNER_ID = process.env.OWNER_ID ? process.env.OWNER_ID.split(',')[0].trim() : null;

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
    const timestamp = new Date().toLocaleTimeString();
    const logMethod = level === 'ERROR' ? console.error : (level === 'WARN' ? console.warn : console.log);

    // Avoid double logging if logic already does console.log, but here we centralize.
    // logMethod(`[${level}] ${message}`, metadata); 

    await Log.create({
      level,
      message,
      metadata
    });
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

  // 1. Log to DB
  await logToDb('ERROR', fullMessage, { stack: error.stack });

  // 2. Take Screenshot (if page is valid)
  let screenshotBuffer = null;
  if (page && !page.isClosed()) {
    try {
      // User Request: "JPEG format, quality 85%"
      screenshotBuffer = await page.screenshot({
        type: 'jpeg',
        quality: 85,
        fullPage: false
      });
    } catch (shotErr) {
      console.warn(`[LogService] Clean screenshot failed: ${shotErr.message}`);
    }
  }

  // 3. Telegram Alert
  if (botInstance && OWNER_ID) {
    try {
      const caption = `🔴 <b>CRITICAL ERROR</b>\n\nContext: ${contextMsg}\nError: <code>${errorMessage}</code>`;

      if (screenshotBuffer) {
        await botInstance.telegram.sendPhoto(OWNER_ID, { source: screenshotBuffer }, {
          caption,
          parse_mode: 'HTML'
        });
      } else {
        await botInstance.telegram.sendMessage(OWNER_ID, caption, { parse_mode: 'HTML' });
      }
    } catch (tgErr) {
      console.error(`[LogService] Failed to send Telegram alert: ${tgErr.message}`);
    }
  }
}
