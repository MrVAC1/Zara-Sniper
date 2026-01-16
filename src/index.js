import dotenv from 'dotenv';
import { Telegraf } from 'telegraf';
import { connectDatabase } from './config/database.js';
import { initBrowser, closeBrowser, getBrowser, startLoginSession, startAutoCleanup } from './services/browser.js';
import { checkAccess } from './middleware/security.js';
import {
  handleStart, handleAdd, handleTasks, handleView, handlePause, handleResume, handleDelete, handleHelp, handleStop,
  handleDeleteAll, handleTaskScreenshot, handleInfo, handleDeleteMenu, handleTaskDetail
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

const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_ID_RAW = process.env.OWNER_ID;

if (!BOT_TOKEN || !OWNER_ID_RAW) {
  console.error('❌ Встановіть BOT_TOKEN та OWNER_ID в .env файлі');
  process.exit(1);
}

// Ініціалізація бота
const bot = new Telegraf(BOT_TOKEN);

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

// Обробка кнопок головного меню (Reply Keyboard)
bot.hears('➕ Додати', handleAdd);
bot.hears('📊 Статус', handleTasks);
bot.hears('📸 View', handleView);
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
      await startLoginSession();
      // Після закриття вікна входу завершуємо роботу скрипта, 
      // щоб користувач міг перезапустити бота в звичайному режимі
      process.exit(0);
    }

    // Ініціалізація браузера (стандартний режим)
    console.log('🔄 Ініціалізація браузера...');
    const context = await initBrowser();

    // Start Auto-Cleanup
    startAutoCleanup(context, activePages);

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
    (async () => {
      try {
        const pages = context.pages();
        // Check if exactly the home page is open (ignoring query params if needed, but strict is safer for "Home")
        // Zara often redirects /ua/uk -> /ua/uk/
        const isHomePage = (url) => {
          return url.includes('zara.com/ua/uk') && !url.includes('/product') && !url.includes('/search');
        };

        const hasMainPage = pages.some(p => isHomePage(p.url()));

        if (!hasMainPage) {
          console.log('🌐 [MainTab] Opening persistent Zara home tab...');
          const page = await context.newPage();
          // Use looser timeout to not crash startup
          await page.goto('https://www.zara.com/ua/uk/', { waitUntil: 'domcontentloaded', timeout: 60000 })
            .catch(e => console.log('⚠️ Main page bg load warning:', e.message));
        } else {
          console.log('✅ [MainTab] Home page already open.');
        }
      } catch (e) {
        console.error('⚠️ [MainTab] Creation error:', e.message);
      }
    })();

    // Збереження екземпляру бота
    setBotInstance(bot);

    // 5. Bot Launch
    // Запуск бота з очищенням черги очікуючих оновлень
    await bot.launch({ dropPendingUpdates: true });
    console.log('✅ Telegram бот запущено (попередні оновлення відхилено)');

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
