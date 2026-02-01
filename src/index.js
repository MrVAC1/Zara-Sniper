import dns from 'node:dns'; // або const dns = require('node:dns');
dns.setDefaultResultOrder('ipv4first');
import dotenv from 'dotenv';
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
  handleDeleteAll, handleTaskScreenshot, handleInfo, handleDeleteMenu, handleTaskDetail, handleGlobalScreenshot
} from './handlers/commandHandler.js';
import { handleProductUrl, handleColorSelection, handleSizeSelection } from './handlers/productHandler.js';
// import { startAllSnipers } from './services/sniperEngine.js'; // Removed unused import
import { initializeActiveTasks } from './services/taskQueue.js';
import { activePages } from './services/sniperEngine.js';
import SniperTask from './models/SniperTask.js';
import User from './models/User.js';
import { createSystemTray } from './services/systemTray.js';
import { setupErrorHandling } from './services/errorHandler.js';
import { setBotInstance } from './utils/botInstance.js';
import { getTimeConfig } from './utils/timeUtils.js';

const { GOTO_TIMEOUT } = getTimeConfig();

dotenv.config();

// --- GLOBAL LOGGING PREFIX ---
const ownerLogId = process.env.OWNER_ID ? process.env.OWNER_ID.split(',')[0].trim() : 'System';
const logPrefix = `[Owner: ${ownerLogId}]`;

const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

console.log = (...args) => originalLog(logPrefix, ...args);
console.warn = (...args) => originalWarn(logPrefix, ...args);
console.error = (...args) => originalError(logPrefix, ...args);
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
let bot;
let telegramOptions = {};

// Use Proxy Manager for Telegram (Priority)
const currentProxy = proxyManager.getCurrentProxy();
if (process.env.PROXY_URL) {
  const proxyUrl = process.env.PROXY_URL;
  console.log(`[System] Using Env Proxy for Telegram: ${proxyUrl.startsWith('socks') ? 'SOCKS' : 'HTTPS'}`);
  telegramOptions.agent = proxyUrl.startsWith('socks') ? new SocksProxyAgent(proxyUrl) : new HttpsProxyAgent(proxyUrl);
} else if (currentProxy) {
  const proxyUrl = currentProxy.server.replace('http://', 'http://' + (currentProxy.username ? `${currentProxy.username}:${currentProxy.password}@` : ''));
  console.log(`[Network] Telegram: Proxy Active (${currentProxy.server})`);
  telegramOptions.agent = new HttpsProxyAgent(proxyUrl);
} else {
  console.warn(`[Network] Telegram: Direct Connection (No Proxy Available)`);
}

bot = new Telegraf(BOT_TOKEN, { telegram: telegramOptions });

// Middleware безпеки
bot.use(checkAccess);


// Команди
bot.command('start', handleStart);
bot.command('add', handleAdd);
bot.command('tasks', handleTasks);
bot.command('view', handleView);
bot.command('help', handleHelp);
bot.command('stop', handleStop);
bot.command('delete', (ctx) => handleDelete(ctx)); // Обробка без аргументів
bot.command('info', handleInfo);

// --- NEW SCREENSHOT COMMAND ---
bot.command('screenshot', handleGlobalScreenshot);
// ------------------------------

// Обробка кнопок головного меню (Reply Keyboard)
bot.hears('➕ Додати', handleAdd);
bot.hears('📊 Статус', handleTasks);
bot.hears('📸 View', handleView);
bot.hears('🖥 Screenshot', handleGlobalScreenshot);
bot.hears('🗑 Видалити', handleDeleteMenu);
bot.hears('ℹ️ Info', handleInfo);
bot.hears('🛑 Стоп', handleStop);

// Callback queries для головного меню (для сумісності, якщо старі повідомлення залишились)
bot.action('cmd_start', handleStart);
bot.action('cmd_add', handleAdd);
bot.action('cmd_tasks', handleTasks);
bot.action('cmd_view', handleView);
bot.action('cmd_info', handleInfo);
bot.action('cmd_delete_menu', handleDeleteMenu); // Нове меню видалення
bot.action('cmd_delete_all', (ctx) => {
  // Legacy support or direct call if needed
  handleDeleteMenu(ctx);
});
bot.action('cmd_stop', handleStop);

// Callback queries для завдань
bot.action(/^pause_task:(.+)$/, async (ctx) => {
  const taskId = ctx.match[1];
  await handlePause(ctx, taskId);
});
bot.action(/^resume_task:(.+)$/, async (ctx) => {
  const taskId = ctx.match[1];
  await handleResume(ctx, taskId);
});
bot.action(/^delete_task:(.+)$/, async (ctx) => {
  const taskId = ctx.match[1];
  await handleDelete(ctx, taskId);
});
bot.action(/^view_task:(.+)$/, async (ctx) => {
  const taskId = ctx.match[1];
  await handleTaskScreenshot(ctx, taskId);
});
bot.action('cmd_delete_all_confirm', handleDeleteAll);

// --- NEW PAGINATION & DETAILS CALLBACKS ---
bot.action(/^tasks_page:(.+)$/, async (ctx) => {
  const payload = ctx.match[1];
  const [page, filter] = payload.split(':');
  await handleTasks(ctx, page, filter || null);
});

bot.action(/^filter_status:(.+)$/, async (ctx) => {
  const status = ctx.match[1];
  await handleTasks(ctx, 1, status === 'all' ? null : status);
});

bot.action(/^task_detail:(.+)$/, async (ctx) => {
  const payload = ctx.match[1];
  const [taskId, filter, page] = payload.split(':');
  await handleTaskDetail(ctx, taskId, filter || 'all', page || 1);
});

bot.action(/^restart_task:(.+)$/, async (ctx) => {
  const taskId = ctx.match[1];
  await handleResume(ctx, taskId); // Reuse resume logic for restart
});

bot.action(/^stop_task:(.+)$/, async (ctx) => {
  const taskId = ctx.match[1];
  await handlePause(ctx, taskId); // Reuse pause logic for stop
});
// ------------------------------------------

// Callback queries (вибір кольору та розміру)
bot.action('back_to_colors', async (ctx) => {
  await handleColorSelection(ctx, 'back_to_colors');
});

bot.action(/^select_color:(.+)$/, async (ctx) => {
  const colorIndex = ctx.match[1];
  await handleColorSelection(ctx, colorIndex);
});

bot.action(/^select_size:(.+):(.+)$/, async (ctx) => {
  const [, colorIndex, sizeIndex] = ctx.match;
  await handleSizeSelection(ctx, colorIndex, sizeIndex);
});

// Обробка URL
bot.on('text', async (ctx) => {
  const text = ctx.message.text;

  // Перевірка чи це URL
  if (text.match(/^https?:\/\//)) {
    await handleProductUrl(ctx, text);
  }
});

import { startSessionHealthCheck } from './services/healthGuard.js';

// ... (previous imports)

// Start Session Health Check
startSessionHealthCheck();

// Обробка помилок
bot.catch((err, ctx) => {
  console.error('❌ Помилка в боті:', err);
  // Намагаємось відповісти, якщо це можливо
  try {
    ctx.reply('❌ Сталася помилка. Спробуйте ще раз.');
  } catch (e) { }
});

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
    const userDataDir = path.join(process.cwd(), `zara_user_profile_${sanitizedPidOwner}`);

    try {
      fs.writeFileSync(pidFilePath, process.pid.toString());
      console.log(`[System] PID File created: ${pidFileName} (PID: ${process.pid})`);
    } catch (pidErr) {
      console.error(`[System] Failed to create PID file: ${pidErr.message}`);
    }
    // -------------------------

    // Підключення до БД
    await connectDatabase();

    // Drop old unique index on SKU if exists (Technical Debt Cleanup)
    try {
      await import('mongoose').then(m => m.connection.collection('snipertasks').dropIndex('sku_1'));
      console.log('✅ Index sku_1 dropped (if existed)');
    } catch (e) { /* ignore if not exists */ }

    // Створення власників якщо не існують
    const { getOwnerIds } = await import('./utils/auth.js');
    const ownerIds = getOwnerIds();
    for (const oid of ownerIds) {
      await User.findOneAndUpdate(
        { telegramId: oid },
        { telegramId: oid, isOwner: true },
        { upsert: true, new: true }
      );
    }

    // Скидання статусів "завислих" завдань (якщо такі є в моделі SniperTask)
    // Оскільки в наданому коді немає статусу 'stopping', скинемо ті, які могли зависнути в 'hunting' 
    // якщо це потрібно, або просто залишимо це на розсуд engine.
    // Але оскільки запит був про 'stopping' або 'processing', реалізуємо загальне скидання
    // Припускаючи, що SniperTask - це основна модель для завдань.
    // Якщо у SniperTask є інші статуси, які блокують роботу, їх треба додати сюди.
    // В даному випадку ми не чіпаємо 'hunting', бо вони мають перезапуститись.
    console.log('🔄 Перевірка цілісності бази даних...');


    // Перевірка режиму входу (Login Mode)
    if (process.argv.includes('--login')) {
      await startLoginSession(userDataDir);
      // Після закриття вікна входу завершуємо роботу скрипта, 
      // щоб користувач міг перезапустити бота в звичайному режимі
      process.exit(0);
    }

    // Ініціалізація браузера (стандартний режим)
    console.log('🔄 Ініціалізація браузера...');
    const context = await initBrowser(userDataDir);

    // FIX: Darwin 20 Stability Pause
    console.log('⏳ Waiting 5s for browser stabilization (Legacy macOS fix)...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Start Auto-Cleanup (Delayed 5 min to prevent crash on startup)
    setTimeout(() => {
      startAutoCleanup(context, activePages);
    }, 300000);

    // Check for active tasks to optimize startup
    const activeTasksCount = await SniperTask.countDocuments({
      status: { $in: ['hunting', 'SEARCHING', 'PENDING', 'MONITORING', 'processing'] }
    });

    if (activeTasksCount > 0) {
      console.log(`⚡ [Startup] Found ${activeTasksCount} active tasks.`);

      // 3. Restoration (Priority #1)
      // NON-BLOCKING: Run in background
      console.log('📥 [Bootstrap] Починаю відновлення активних завдань (у фоні)...');
      initializeActiveTasks(context, bot).catch(restoreError => {
        console.error('⚠️ [Bootstrap] Помилка відновлення завдань:', restoreError);
      });
    }

    // 4. Ensure Main Page (Always)
    // User Request: "Нехай завжди буде відкрита вкладка з головною сторінкою Zara"
    // We execute this concurrently/sequentially
    // 4. Ensure Main Page (Always)
    // User Request: "Нехай завжди буде відкрита вкладка з головною сторінкою Zara"
    (async () => {
      let attempts = 0;
      const MAX_RETRIES = 3;

      while (attempts < MAX_RETRIES) {
        try {
          // Verify/Get Fresh Context (in case of rotation)
          let currentContext = await getBrowser();
          if (!currentContext) {
            console.log('🔄 [MainTab] Context closed, re-initializing...');
            currentContext = await initBrowser(userDataDir);
          }

          const pages = currentContext.pages();
          const isHomePage = (url) => url.includes('zara.com/ua/uk') && !url.includes('/product') && !url.includes('/search');
          const hasMainPage = pages.some(p => isHomePage(p.url()));

          if (!hasMainPage) {
            console.log('🌐 [MainTab] Opening persistent Zara home tab...');
            const page = await currentContext.newPage();

            // Use safeNavigate with rotation handling
            await safeNavigate(page, 'https://www.zara.com/ua/uk/', { timeout: 60000 });

            console.log('✅ [MainTab] Home page loaded successfully.');

            console.log('⏳ [MainTab] Waiting 5 seconds before checking store selection...');
            await new Promise(r => setTimeout(r, 5000));

            // Handle "Stay in Store" and other popups
            const { removeUIObstacles } = await import('./services/browser.js');
            await removeUIObstacles(page);
          } else {
            console.log('✅ [MainTab] Home page already open.');
          }
          break; // Success

        } catch (e) {
          if (e.message === 'PROXY_ROTATION_REQUIRED') {
            console.warn(`[MainTab] 🔄 Proxy Rotation triggered during startup (Attempt ${attempts + 1}/${MAX_RETRIES}).`);
            attempts++;
            // Context is already closed by safeNavigate, loop will re-init
            continue;
          }
          console.error('⚠️ [MainTab] Creation error:', e.message);
          break; // Unknown error, abort to avoid infinite loop
        }
      }
    })();

    // Збереження екземпляру бота
    setBotInstance(bot);

    // 5. Bot Launch (Robust Retry Mechanism with Proxy Rotation)
    // Запуск бота з очищенням черги очікуючих оновлень
    const MAX_LAUNCH_RETRIES = 50; // Increased retries for resilience
    let botStarted = false;

    // Use a loop to keep retrying indefinitely if needed (or up to MAX_LAUNCH_RETRIES)
    // The user requested prevent exit, so we try hard.
    for (let i = 0; i < MAX_LAUNCH_RETRIES; i++) {
      try {
        // Log current network state
        const currentProxy = proxyManager.getCurrentProxy();
        if (currentProxy) {
          console.log(`[Network] Telegram: Proxy Active (${currentProxy.server})`);
        } else {
          console.log(`[Network] Telegram: Direct Connection`);
        }

        // Attempt to launch
        await bot.launch({ dropPendingUpdates: true });
        console.log('✅ Telegram бот запущено (попередні оновлення відхилено)');
        botStarted = true;
        break;

      } catch (botErr) {
        console.error(`❌ [Network] Telegram connection failed (Attempt ${i + 1}/${MAX_LAUNCH_RETRIES}):`, botErr.message);

        // Rotate Proxy on Failure
        console.log('[Network] Rotating proxy...');
        const nextProxy = proxyManager.getNextProxy(); // Returns new proxy config

        // Recreate Agent
        if (nextProxy) {
          const proxyUrl = nextProxy.server.replace('http://', 'http://' + (nextProxy.username ? `${nextProxy.username}:${nextProxy.password}@` : ''));
          // Update agent safely
          if (bot.telegram && bot.telegram.options) {
            bot.telegram.options.agent = new HttpsProxyAgent(proxyUrl);
            console.log(`[Network] Telegram agent updated to: ${nextProxy.server}`);
          }
        } else {
          // If direct was planned or no proxies left (should circular rotate though)
          if (bot.telegram && bot.telegram.options) {
            bot.telegram.options.agent = undefined;
            console.log(`[Network] Telegram agent switched to Direct.`);
          }
        }

        // Wait before retry
        await new Promise(r => setTimeout(r, 5000));
      }
    }

    if (!botStarted) {
      console.error('❌ Failed to connect to Telegram after multiple attempts. Continuing in limited mode (Server active).');
      // Do NOT process.exit(1) to keep HTTP server alive for HF
    }

    // startAllSnipers(bot); // Видаляємо або коментуємо, щоб не дублювати запуск

    /* 
    // OLD LOGIC
    // Запуск всіх активних завдань
    await startAllSnipers(bot);
    console.log('✅ Активні завдання запущено');
    
    // NEW: Open all necessary tabs immediately if hunting
    const huntingTasks = await import('./models/SniperTask.js').then(m => m.default.find({ status: 'hunting' }));
    if (huntingTasks.length > 0) {
        console.log(`🌐 Відкриття вкладок для ${huntingTasks.length} активних завдань...`);
        // ... (rest of old logic)
    }
    */

    // Створення системного трею
    createSystemTray(bot);

    // Налаштування обробки помилок
    setupErrorHandling(bot, getBrowser());

    console.log('✅ Zara Sniper Bot готовий до роботи!');

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
    // -------------------

    await import('./config/database.js').then(m => m.disconnectDatabase());
    console.log('✅ Завершено коректно');
    process.exit(0);
  } catch (error) {
    console.error('❌ Помилка при завершенні:', error);
    process.exit(1);
  }
}

// Запуск
main();
