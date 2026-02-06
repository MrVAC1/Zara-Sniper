import dns from 'node:dns'; // або const dns = require('node:dns');
dns.setDefaultResultOrder('ipv4first');
import dotenv from 'dotenv';
dotenv.config();
import fs from 'fs';
import path from 'path';
import http from 'http'; // Keep-alive for HF Spaces
import { SocksProxyAgent } from 'socks-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { Telegraf } from 'telegraf';
import { connectDatabase } from './config/database.js';
import { initBrowser, closeBrowser, getBrowser, startLoginSession, startAutoCleanup, safeNavigate } from './services/browser.js';
import { checkAccess } from './middleware/security.js';
import {
  handleStart, handleAdd, handleTasks, handleView, handlePause, handleResume, handleDelete, handleHelp, handleStop,
  handleDeleteAll, handleTaskScreenshot, handleInfo, handleDeleteMenu, handleTaskDetail, handleGlobalScreenshot,
  handleLogs, handleRestart, handleConfirmRestart, handlePauseAll, handleResumeAll, handleUACheck
} from './handlers/commandHandler.js';
import { handleProductUrl, handleColorSelection, handleSizeSelection } from './handlers/productHandler.js';
import { handleLogin } from './handlers/authHandler.js';
// import { startAllSnipers } from './services/sniperEngine.js'; // Removed unused import
import { initializeActiveTasks } from './services/taskQueue.js';
import { activePages, startGlobalWatchdog } from './services/sniperEngine.js';
import SniperTask from './models/SniperTask.js';
import User from './models/User.js';
import { createSystemTray } from './services/systemTray.js';
import { setupErrorHandling } from './services/errorHandler.js';
import { setBotInstance } from './utils/botInstance.js';
import { getBotId } from './utils/botUtils.js';
import { getTimeConfig } from './utils/timeUtils.js';
import { setLogServiceBot } from './services/logService.js';
// import { startSessionSync } from './services/session.js'; // REMOVED (Read-Only)

const { GOTO_TIMEOUT } = getTimeConfig();

// Environment already loaded at top

// --- SSL CERTIFICATE RESTORATION ---
// (Only if Proxy is used, otherwise direct connection is safe/standard)
if (process.env.USE_BROWSER_PROXY !== 'false') {
  if (process.env.SSL_CERT_BASE64) {
    try {
      const certBuffer = Buffer.from(process.env.SSL_CERT_BASE64, 'base64');
      const certPath = path.resolve(process.cwd(), 'custom_ca.crt');
      fs.writeFileSync(certPath, certBuffer);
      process.env.NODE_EXTRA_CA_CERTS = certPath;
      console.log('[System] 🛡️ Loaded custom SSL certificate from SSL_CERT_BASE64 (ENV)');
    } catch (err) {
      console.error('❌ [System] SSL Restoration failed:', err.message);
    }
  } else {
    const sslCertPath = path.join(process.cwd(), 'brightdata_proxy.crt');
    if (fs.existsSync(sslCertPath)) {
      process.env.NODE_EXTRA_CA_CERTS = sslCertPath;
      console.log(`[System] 🛡️ Loaded custom SSL certificate: ${sslCertPath}`);
    }
  }
} else {
  console.log('[System] ⚠️ SSL Restoration Skipped (USE_BROWSER_PROXY=false)');
}
// -----------------------------------
// -----------------------------------

// --- GLOBAL LOGGING PREFIX ---
const ownerLogId = process.env.OWNER_ID ? process.env.OWNER_ID.split(',')[0].trim() : 'System';
const logPrefix = `[Owner: ${ownerLogId}]`;

const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

const formatArgs = (args) => {
  if (args.length === 0) return [];
  // If first arg is a string with newlines, we need to handle it
  if (typeof args[0] === 'string' && args[0].includes('\n')) {
    const lines = args[0].split('\n');
    return lines.map(line => {
      if (line.trim() === '') return '';
      if (line.includes('[Owner:')) return line;
      return `${logPrefix} ${line}`;
    }).join('\n');
  }
  if (typeof args[0] === 'string' && args[0].includes('[Owner:')) {
    return args;
  }
  return [logPrefix, ...args];
};

console.log = (...args) => {
  if (args.length === 0 || (args.length === 1 && args[0] === '')) {
    return originalLog('');
  }
  const formatted = formatArgs(args);
  if (Array.isArray(formatted)) {
    originalLog(...formatted);
  } else {
    originalLog(formatted);
  }
};
console.warn = (...args) => {
  if (args.length === 0 || (args.length === 1 && args[0] === '')) {
    return originalWarn('');
  }
  const formatted = formatArgs(args);
  if (Array.isArray(formatted)) {
    originalWarn(...formatted);
  } else {
    originalWarn(formatted);
  }
};
console.error = (...args) => {
  if (args.length === 0 || (args.length === 1 && args[0] === '')) {
    return originalError('');
  }
  const formatted = formatArgs(args);
  if (Array.isArray(formatted)) {
    originalError(...formatted);
  } else {
    originalError(formatted);
  }
};
// -----------------------------

const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_ID_RAW = process.env.OWNER_ID;

if (!BOT_TOKEN || !OWNER_ID_RAW) {
  console.error('❌ Встановіть BOT_TOKEN та OWNER_ID в .env файлі');
  process.exit(1);
}

// Ініціалізація бота
import { proxyManager } from './services/proxyManager.js';

// Ініціалізація бота
// Bot variable declaration (init moved to main)
let bot;
let telegramOptions = {};

// Proxy checking moved to internal main() logic
// ...

// Middleware безпеки
// Handlers moved to setupBotHandlers function


import { startSessionHealthCheck } from './services/healthGuard.js';

// ... (previous imports)

// Start Session Health Check
startSessionHealthCheck();

// Error handling moved to setupErrorHandling provided by service


// Головна функція
async function main() {
  try {
    console.log('🚀 Запуск Zara Sniper Bot...');

    // --- HF SPACES KEEP-ALIVE (MOVED TO TOP) ---
    // Start server IMMEDIATELY to pass health checks while waiting for network
    if (process.env.PORT) {
      http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.write('Zara Sniper Bot is Running!');
        res.end();
      }).listen(process.env.PORT, () => {
        console.log(`[Server] HTTP Server listening on port ${process.env.PORT}`);
      });
    }
    // ----------------------------

    // --- CONTAINER NETWORK WAIT (ROBUST) ---
    const checkInternet = async (retries = 5, delayMs = 2000) => {
      for (let i = 0; i < retries; i++) {
        try {
          await new Promise((resolve, reject) => {
            dns.lookup('api.telegram.org', (err) => {
              if (err) reject(err);
              else resolve();
            });
          });
          console.log('✅ [Network] Internet connection confirmed (DNS working).');
          return true;
        } catch (e) {
          console.log(`⏳ [Network] Waiting for connectivity... (${i + 1}/${retries})`);
          await new Promise(r => setTimeout(r, delayMs));
        }
      }
      return false;
    };

    console.log('[System] Verifying network connectivity...');
    const hasInternet = await checkInternet();
    if (!hasInternet) console.error('❌ [Network] Warning: DNS resolution failed after 10s.');
    // ------------------------------

    // --- PID FILE CREATION ---
    const ownerIdFull = process.env.OWNER_ID || 'default';
    const primaryOwner = ownerIdFull.split(',')[0].trim();
    const sanitizedPidOwner = primaryOwner.replace(/[^a-zA-Z0-9]/g, '');
    const pidFileName = `.pid_${sanitizedPidOwner}`;

    const pidFilePath = path.join(process.cwd(), pidFileName);
    const userDataDir = path.join(process.cwd(), 'profiles', `zara_user_profile_${sanitizedPidOwner}`);

    // Ensure profiles directory exists
    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
    }

    try {
      fs.writeFileSync(pidFilePath, process.pid.toString());
      console.log(`[System] PID File created: ${pidFileName} (PID: ${process.pid})`);
    } catch (pidErr) {
      console.error(`[System] Failed to create PID file: ${pidErr.message}`);
    }
    // -------------------------

    // Підключення до БД
    await connectDatabase();

    // 1. TELEGRAM PROXY & INIT (Conditional based on .env)
    console.log('[Bootstrap] 1. Initializing Telegram...');

    // Check if Telegram proxy is enabled
    const useTelegramProxy = process.env.USE_TELEGRAM_PROXY === 'true';
    let telegramProxy = null;

    // CLEAN OPTIONS: Always start with explicit agent configuration
    let telegramOptions = { agent: null };

    if (useTelegramProxy) {
      // STRICT: Retrieve proxy from dedicated Webshare list
      try {
        telegramProxy = proxyManager.getTelegramProxy();
        console.log(`[Proxy: Telegram] Using ${telegramProxy.masked}`);
        telegramOptions.agent = new HttpsProxyAgent(telegramProxy.url, {
          timeout: 10000,
          keepAlive: true,
          keepAliveMsecs: 30000
        });
      } catch (e) {
        console.error(`[FATAL] Telegram Proxy Error: ${e.message}`);
        process.exit(1);
      }
    } else {
      console.log('[Proxy: Telegram] Direct connection (USE_TELEGRAM_PROXY=false)');
      telegramOptions.agent = null; // Explicit null for direct connection
    }

    bot = new Telegraf(BOT_TOKEN, { telegram: telegramOptions });

    // Initialize Handlers BEFORE validation
    setupBotHandlers(bot);
    console.log('[Handlers] Registering Telegram handlers...');
    console.log('[Bootstrap] Bot Handlers Configured.');

    // 2. VALIDATE TELEGRAM CONNECTION (using getMe() instead of launch)
    console.log('[Bootstrap] 2. Validating Telegram Connection...');

    // Show actual Telegram proxy status
    if (telegramProxy) {
      console.log(`[Network] Telegram: Tunneled via ${telegramProxy.masked}`);
    } else {
      console.log(`[Network] Telegram: Direct Connection`);
    }

    // Validation wrapper using getMe() (proven to work in 194ms)
    const validateWithTimeout = (timeout = 30000) => {
      return Promise.race([
        bot.telegram.getMe(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('CONNECTION_TIMEOUT')), timeout)
        )
      ]);
    };

    const MAX_TELEGRAM_RETRIES = 3;
    let connectionValid = false;

    for (let attempt = 1; attempt <= MAX_TELEGRAM_RETRIES; attempt++) {
      try {
        console.log(`[Bootstrap] Connection validation attempt ${attempt}/${MAX_TELEGRAM_RETRIES}...`);

        const me = await validateWithTimeout(30000);
        console.log(`✅ Telegram connection validated: @${me.username} (ID: ${me.id})`);
        connectionValid = true;
        break;

      } catch (err) {
        const errorCode = err.code || err.name || 'UNKNOWN';
        console.error(`❌ [Telegram] Validation failed (Attempt ${attempt}/${MAX_TELEGRAM_RETRIES})`);
        console.error(`   Error Code: ${errorCode}`);
        console.error(`   Message: ${err.message}`);

        // If more attempts left, rotate to next Telegram proxy (ONLY if proxy mode enabled)
        if (attempt < MAX_TELEGRAM_RETRIES) {
          if (useTelegramProxy) {
            // Rotate to next proxy
            try {
              const nextProxy = proxyManager.getNextTelegramProxy();
              console.log(`[Network] Rotating to next Telegram proxy: ${nextProxy.masked}`);

              // Update agent with socket timeout
              if (bot.telegram && bot.telegram.options) {
                bot.telegram.options.agent = new HttpsProxyAgent(nextProxy.url, {
                  timeout: 10000,
                  keepAlive: true,
                  keepAliveMsecs: 30000
                });
              }

              await new Promise(r => setTimeout(r, 2000)); // Brief delay before retry
            } catch (proxyErr) {
              console.error(`[FATAL] ${proxyErr.message}`);
              break; // No more proxies available
            }
          } else {
            // Direct connection mode - just wait and retry
            console.log('[Network] Retrying direct connection...');
            await new Promise(r => setTimeout(r, 2000));
          }
        }
      }
    }

    // STRICT: If validation failed, EXIT
    if (!connectionValid) {
      console.error('');
      console.error('═══════════════════════════════════════════════════════════');
      console.error('❌ FATAL ERROR: Telegram Connection Validation Failed');
      console.error('═══════════════════════════════════════════════════════════');
      if (useTelegramProxy) {
        console.error('Reason: All Webshare proxies exhausted or invalid.');
        console.error('Action: Check "Webshare 10 proxies.txt" credentials.');
      } else {
        console.error('Reason: Unable to reach Telegram API servers.');
        console.error('Action: Check your internet connection.');
      }
      console.error('═══════════════════════════════════════════════════════════');
      console.error('');
      process.exit(1);
    }

    // 3. LAUNCH BOT IN BACKGROUND (non-blocking)
    console.log('[Bootstrap] 3. Starting Telegram bot...');
    bot.launch({ dropPendingUpdates: true })
      .then(() => {
        console.log('✅ Telegram бот запущено (попередні оновлення відхілено)');
      })
      .catch(err => {
        console.error(`⚠️ Bot launch warning: ${err.message}`);
        // Connection is validated, so this is non-critical
      });

    // Save bot instance early
    setBotInstance(bot);
    setLogServiceBot(bot);

    // 3. BROWSER PROXY SELECTION (Conditional)
    let globalProxy = null;
    if (process.env.USE_BROWSER_PROXY === 'true') {
      console.log('[Bootstrap] 3. Selecting Global Browser Proxy...');
      globalProxy = proxyManager.getBrowserProxy(0);
      if (!globalProxy) {
        console.error('[FATAL] No Browser Proxy found (ips-isp_proxy.txt)!');
        process.exit(1);
      }
      console.log(`[Proxy: Browser] Selected Global Proxy: ${globalProxy.server}`);
    } else {
      console.warn('[Bootstrap] ⚠️ BROWSER PROXY DISABLED via .env (USE_BROWSER_PROXY=false)');
    }

    // 4. STRICT SESSION VALIDATION
    console.log('[Bootstrap] 4. Validating Session File...');
    const { loadSession, saveSession } = await import('./services/session.js');
    const sessionPath = await loadSession();

    let isLoginMode = process.argv.includes('--login');

    if (!sessionPath && !isLoginMode) {
      console.log('[Bootstrap] ⚠️ Session missing. Switching to AUTO-LOGIN mode.');
      isLoginMode = true;
    } else if (isLoginMode) {
      console.log('[Bootstrap] ⚠️ Login Mode: Starting fresh session to authenticate.');
    }

    // 5. STRICT BROWSER LAUNCH (Kill-Switch inside)
    // DECOUPLED: Browser init deferred to allow Telegram event loop to process pending updates first
    console.log('[Bootstrap] 5. Decoupling Browser Init (setImmediate for Telegram responsiveness)...');

    setImmediate(async () => {
      try {
        console.log('[Bootstrap] 🚀 Starting browser initialization...');
        const context = await initBrowser(userDataDir, globalProxy);

        if (isLoginMode) {
          await startLoginSession(userDataDir);
          console.log('[System] Login session finished. Exiting.');
          await closeBrowser();
          process.exit(0);
        }

        // 6. AUTOMATION START
        console.log('[Bootstrap] 6. Starting Automation...');

        // Wait for browser to stabilize (especially on Legacy macOS)
        await new Promise(resolve => setTimeout(resolve, 2000));
        console.log(`[Owner: ${process.env.OWNER_ID.split(',')[0].trim()}] ⏳ Waiting 2s for browser stabilization... [OPTIMIZED: was 5s]`);
        setTimeout(() => {
          startAutoCleanup(context, activePages);
        }, 300000);

        // Check for active tasks to optimize startup
        const currentBotId = getBotId();
        const activeTasksCount = await SniperTask.countDocuments({
          botId: currentBotId,
          status: { $in: ['hunting', 'SEARCHING', 'PENDING', 'MONITORING', 'processing', 'at_checkout'] }
        });

        // Browser initialization has completed, active tasks can start
        if (activeTasksCount > 0) {
          console.log(`⚡ [Startup] Found ${activeTasksCount} active tasks.`);

          // NON-BLOCKING: Run in background
          console.log('📥 [Bootstrap] Починаю відновлення активних завдань (у фоні)...');
          initializeActiveTasks(context, bot).catch(restoreError => {
            console.error('⚠️ [Bootstrap] Помилка відновлення завдань:', restoreError);
          });
        }

        // 4. Ensure Main Page (Handled by initBrowser Keeper Tab)
        // No explicit check needed here as initBrowser now awaits the keeper tab.

        // Створення системного трею
        createSystemTray(bot);

        // Налаштування обробки помилок
        setupErrorHandling(bot, getBrowser());

        // --- START WATCHDOG ---
        startGlobalWatchdog(bot);

        console.log('✅ Zara Sniper Bot готовий до роботи!');
      } catch (browserError) {
        console.error('❌ [Bootstrap] Browser initialization failed:', browserError);
        process.exit(1);
      }
    });

    // Telegram bot is now ready to respond immediately while browser initializes in background
    console.log('✅ Telegram бот активний і готовий приймати команди (браузер ініціалізується у фоні)...');

    // Graceful shutdown
    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));

    // Захист від Zombie процесів
    process.on('unhandledRejection', (reason) => {
      if (reason && reason.message && reason.message.includes('User data directory is already in use')) {
        console.error('❌ ПОМИЛКА: Директорія профілю заблокована. Завершіть усі процеси браузера у Диспетчері завдань.');
        process.exit(1);
      }
    });

  } catch (error) {
    console.error('❌ Критична помилка:', error);
    process.exit(1);
  }
}

async function shutdown(signal) {
  console.log(`\n🛑 Отримано сигнал ${signal}, завершення роботи...`);

  try {
    await bot.stop(signal);
    await closeBrowser();

    // --- PID CLEANUP ---
    const ownerIdFull = process.env.OWNER_ID || 'default';
    const primaryOwner = ownerIdFull.split(',')[0].trim();
    const sanitizedPidOwner = primaryOwner.replace(/[^a-zA-Z0-9]/g, '');
    const pidFileName = `.pid_${sanitizedPidOwner}`;
    const pidFilePath = path.join(process.cwd(), pidFileName);

    if (fs.existsSync(pidFilePath)) {
      try {
        fs.unlinkSync(pidFilePath);
        console.log(`[System] PID File removed: ${pidFileName}`);
      } catch (e) {
        console.warn(`[System] Failed to remove PID file: ${e.message}`);
      }
    }

    // Force save session before exit
    try {
      const context = await getBrowser();
      if (context) {
        console.log('[Shutdown] Saving session before exit...');
        const { saveSession } = await import('./services/session.js');
        await saveSession(context);
      }
    } catch (e) {
      console.warn('[Shutdown] Failed to save session:', e.message);
    }
    // -------------------
    // -------------------

    await import('./config/database.js').then(m => m.disconnectDatabase());
    console.log('✅ Завершено коректно');
    process.exit(0);
  } catch (error) {
    console.error('❌ Помилка при завершенні:', error);
    process.exit(1);
  }
}

// --- BOT HANDLERS SETUP ---
function setupBotHandlers(bot) {
  console.log('[Handlers] Registering Telegram handlers...');

  // Global Callback Query Middleware (Logging ONLY - handlers answer individually)
  bot.on('callback_query', async (ctx, next) => {
    try {
      const data = ctx.callbackQuery?.data || 'unknown';
      const userId = ctx.from?.id || 'unknown';
      console.log(`[Telegram] 🔘 Click detected: ${data} (User: ${userId})`);
      // Do NOT answer here - let individual handlers do it to avoid double-answer errors
    } catch (e) {
      console.error(`[Telegram] Callback middleware error: ${e.message}`);
    }
    return next();
  });

  // Commands
  bot.start(handleStart);
  bot.help(handleHelp);
  bot.command('add', handleAdd);
  bot.command('tasks', (ctx) => handleTasks(ctx));
  bot.command('view', handleView);
  bot.command('pause', (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length > 1) handlePause(ctx, args[1]);
    else ctx.reply('⚠️ Usage: /pause <taskId>');
  });
  bot.command('resume', (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length > 1) handleResume(ctx, args[1]);
    else ctx.reply('⚠️ Usage: /resume <taskId>');
  });
  bot.command('delete', (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length > 1) handleDelete(ctx, args[1]);
    else handleDeleteMenu(ctx);
  });
  bot.command('stop', handleStop);
  bot.command('deleteall', handleDeleteAll);
  bot.command('screenshot', handleGlobalScreenshot);
  bot.command('info', handleInfo);
  bot.command('logs', handleLogs);
  bot.command('restart', handleRestart);
  bot.command('pause_all', handlePauseAll);
  bot.command('resume_all', (ctx) => handleResumeAll(ctx, bot));
  bot.command('ua', handleUACheck);
  bot.command('login', handleLogin);

  // Actions (Callbacks)
  bot.action('confirm_global_restart', (ctx) => handleConfirmRestart(ctx, bot));
  bot.action('cancel_restart', async (ctx) => {
    await ctx.answerCbQuery('❌ Cancelled');
    await ctx.deleteMessage();
  });

  // Dynamic Callbacks (Regex)
  bot.action(/^task_detail:(.+):(.+):(.+)$/, async (ctx) => {
    const match = ctx.match;
    await handleTaskDetail(ctx, match[1], match[2], match[3]);
  });

  bot.action(/^tasks_page:(.+):(.+)$/, async (ctx) => {
    const match = ctx.match;
    await handleTasks(ctx, match[1], match[2]);
  });

  bot.action(/^filter_status:(.+)$/, async (ctx) => {
    const match = ctx.match;
    await handleTasks(ctx, 1, match[1]);
  });

  bot.action(/^view_task:(.+)$/, async (ctx) => {
    await handleTaskScreenshot(ctx, ctx.match[1]);
  });

  bot.action(/^delete_task:(.+)$/, async (ctx) => {
    await handleDelete(ctx, ctx.match[1]);
  });

  bot.action(/^restart_task:(.+)$/, async (ctx) => {
    await handleResume(ctx, ctx.match[1]);
  });

  bot.action(/^stop_task:(.+)$/, async (ctx) => {
    await handlePause(ctx, ctx.match[1]);
  });

  bot.action('cmd_tasks', (ctx) => handleTasks(ctx));
  bot.action('cmd_start', (ctx) => handleStart(ctx));
  bot.action('cmd_delete_all_confirm', (ctx) => handleDeleteAll(ctx));
  bot.action('ignore', (ctx) => ctx.answerCbQuery());

  // Reply Keyboard Handlers (for buttons under chat)
  bot.hears('➕ Додати', handleAdd);
  bot.hears('📊 Статус', (ctx) => handleTasks(ctx));
  bot.hears('📸 View', handleView);
  bot.hears('🖥 Screenshot', handleGlobalScreenshot);
  bot.hears('🗑 Видалити', handleDeleteMenu);
  bot.hears('ℹ️ Info', handleInfo);
  bot.hears('⏸ Pause All', handlePauseAll);
  bot.hears('▶️ Resume All', (ctx) => handleResumeAll(ctx, bot));
  bot.hears('🛑 Стоп', handleStop);
  bot.hears('🔄 Рестарт', handleRestart);

  // Text Handlers (Product URLs, Color/Size selection)
  bot.on('text', async (ctx) => {
    if (ctx.message.text.startsWith('/')) return; // Ignore other commands

    const text = ctx.message.text;
    // Simple URL check
    if (text.includes('zara.com') && text.includes('/')) {
      await handleProductUrl(ctx, text);
    }
  });

  // Selection Callbacks (Color/Size)
  bot.action(/^select_color:(.+)$/, async (ctx) => {
    await handleColorSelection(ctx, ctx.match[1]);
  });
  bot.action(/^select_size:(.+):(.+)$/, async (ctx) => {
    await handleSizeSelection(ctx, ctx.match[1], ctx.match[2]);
  });
  // Note: match[1] and match[2] depends on regex in productHandler or here.
  // In productHandler: `callback_data: select_size:${colorIndex}:${index}` -> 2 parts.

  console.log('[Bootstrap] Bot Handlers Configured.');
}

// Запуск
main();
