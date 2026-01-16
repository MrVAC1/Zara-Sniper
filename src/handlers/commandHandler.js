import SniperTask from '../models/SniperTask.js';
import User from '../models/User.js';
import { startSniper, stopAndCloseTask, getTaskPage } from '../services/sniperEngine.js';
import { getBrowser } from '../services/browser.js';

// Експортуємо клавіатуру, щоб її можна було використовувати в інших місцях
export const MAIN_MENU_KEYBOARD = {
  keyboard: [
    [{ text: '➕ Додати' }, { text: '📊 Статус' }],
    [{ text: '📸 View' }, { text: '🗑 Видалити' }],
    [{ text: 'ℹ️ Info' }, { text: '🛑 Стоп' }]
  ],
  resize_keyboard: true
};

/**
 * Команда /start
 */
export async function handleStart(ctx) {
  const messageText = '👋 Вітаю! Я Zara Sniper Bot.\n\nОберіть дію в меню знизу:';

  try {
    // Завжди відправляємо нове повідомлення з Reply Keyboard
    await ctx.reply(messageText, { reply_markup: MAIN_MENU_KEYBOARD });

    if (ctx.callbackQuery) {
      await ctx.answerCbQuery();
    }
  } catch (e) {
    console.error('Error in handleStart:', e);
    // fallback
    await ctx.reply(messageText, { reply_markup: MAIN_MENU_KEYBOARD });
  }
}

/**
 * Команда /info
 */
export async function handleInfo(ctx) {
  const infoText =
    `🤖 *Zara Sniper Bot Commands:*\n\n` +
    `/start - Головне меню\n` +
    `/add - Додати нове посилання на товар\n` +
    `/tasks - Показати статус активних завдань\n` +
    `/view - Отримати скріншот (перегляд) завдання\n` +
    `/delete - Меню видалення завдань\n` +
    `/info - Показати це повідомлення\n` +
    `/stop - Повна зупинка бота та браузера\n\n` +
    `💡 *Підказка:* Надішліть посилання на товар Zara в будь-який момент, щоб почати відстеження.`;

  try {
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery();
      // Тут краще відправити нове, бо тексту багато
      await ctx.reply(infoText, { parse_mode: 'Markdown' });
    } else {
      await ctx.reply(infoText, { parse_mode: 'Markdown' });
    }
  } catch (e) { }
}

/**
 * Команда /add
 */
export async function handleAdd(ctx) {
  await ctx.reply(
    '📎 Надішліть URL товару з Zara для додавання до списку полювання.'
  );
}

/**
 * Команда /tasks
 */
/**
 * Команда /tasks з пагінацією та фільтрацією
 */
export async function handleTasks(ctx, page = 1, statusFilter = null) {
  page = parseInt(page) || 1;
  const limit = 5;
  const skip = (page - 1) * limit;

  const userId = ctx.from.id;
  const user = await User.findOne({ telegramId: userId });

  if (!user) {
    return ctx.reply('❌ Користувача не знайдено');
  }

  // Get unique statuses for this user
  const uniqueStatuses = await SniperTask.distinct('status', { userId: user._id });

  // Logical Menu Fork: 
  // If no filter selected AND multiple statuses exist -> show Category Menu
  if (!statusFilter && uniqueStatuses.length > 1 && !ctx.callbackQuery?.data?.startsWith('tasks_page')) {
    const statusLabels = {
      'hunting': '🎯 Hunting',
      'completed': '✅ Completed',
      'paused': '⏸ Paused',
      'at_checkout': '🛒 Checkout',
      'failed': '❌ Failed',
      'processing': '⚡ Processing'
    };

    const filterKeyboard = {
      inline_keyboard: []
    };

    uniqueStatuses.sort().forEach(st => {
      const label = statusLabels[st] || st.toUpperCase();
      filterKeyboard.inline_keyboard.push([{ text: label, callback_data: `filter_status:${st}` }]);
    });

    filterKeyboard.inline_keyboard.push([{ text: '🌍 Усі товари', callback_data: `filter_status:all` }]);

    const menuMsg = `📊 *Статус завдань*\nВиявлено декілька категорій. Оберіть фільтр:`;

    if (ctx.callbackQuery) {
      return ctx.editMessageText(menuMsg, { parse_mode: 'Markdown', reply_markup: filterKeyboard }).catch(() => { });
    } else {
      return ctx.reply(menuMsg, { parse_mode: 'Markdown', reply_markup: filterKeyboard });
    }
  }

  // Build query
  const query = { userId: user._id };
  if (statusFilter && statusFilter !== 'all') {
    query.status = statusFilter;
  }

  const totalTasks = await SniperTask.countDocuments(query);
  const totalPages = Math.ceil(totalTasks / limit);

  const tasks = await SniperTask.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  if (tasks.length === 0) {
    const emptyMsg = statusFilter ? `📭 Немає завдань у категорії *${statusFilter.toUpperCase()}*.` : '📭 Немає активних завдань.';
    const emptyKb = statusFilter ? { inline_keyboard: [[{ text: '🔙 Назад до вибору', callback_data: 'cmd_tasks' }]] } : null;
    return ctx.reply(emptyMsg, { parse_mode: 'Markdown', reply_markup: emptyKb });
  }

  const titlePrefix = statusFilter && statusFilter !== 'all' ? `Категорія: ${statusFilter.toUpperCase()} ` : 'Список завдань';
  let message = `📋 *${titlePrefix} (Стор. ${page}/${totalPages || 1})*\n\n`;

  const keyboard = { inline_keyboard: [] };

  for (const task of tasks) {
    const statusEmoji = task.status === 'hunting' ? '🔍' :
      task.status === 'paused' ? '⏸' :
        task.status === 'completed' ? '✅' :
          task.status === 'at_checkout' ? '🛒' : '❌';

    const shortName = task.productName.substring(0, 20) + (task.productName.length > 20 ? '...' : '');
    const size = task.selectedSize?.name || 'N/A';

    message += `${statusEmoji} *${shortName}* | ${size}\n`;
    message += `└ 🆔 \`${task._id}\`\n\n`;

    // Passing filter state to detail view
    const filterState = statusFilter || 'all';
    keyboard.inline_keyboard.push([
      { text: `🔍 Детальніше: ${shortName}`, callback_data: `task_detail:${task._id}:${filterState}:${page}` }
    ]);
  }

  // Pagination Buttons
  const navRow = [];
  const filterSuffix = statusFilter ? `:${statusFilter}` : ':all';

  if (page > 1) {
    navRow.push({ text: '⬅️ Назад', callback_data: `tasks_page:${page - 1}${filterSuffix}` });
  }
  navRow.push({ text: `📄 ${page}/${totalPages || 1}`, callback_data: 'ignore' });
  if (page < totalPages) {
    navRow.push({ text: 'Вперед ➡️', callback_data: `tasks_page:${page + 1}${filterSuffix}` });
  }
  keyboard.inline_keyboard.push(navRow);

  // Bottom buttons
  const bottomRow = [{ text: '🔄 Оновити', callback_data: `tasks_page:${page}${filterSuffix}` }];
  if (uniqueStatuses.length > 1) {
    bottomRow.push({ text: '📁 Категорії', callback_data: 'cmd_tasks' });
  }
  keyboard.inline_keyboard.push(bottomRow);

  try {
    if (ctx.callbackQuery) {
      const isPhoto = ctx.callbackQuery.message.photo;
      if (isPhoto) {
        await ctx.deleteMessage().catch(() => { });
        await ctx.reply(message, { parse_mode: 'Markdown', reply_markup: keyboard });
      } else {
        await ctx.editMessageText(message, { parse_mode: 'Markdown', reply_markup: keyboard });
      }
    } else {
      await ctx.reply(message, { parse_mode: 'Markdown', reply_markup: keyboard });
    }
  } catch (e) {
    console.error('Error in handleTasks navigation:', e.message);
    if (ctx.callbackQuery) {
      await ctx.reply(message, { parse_mode: 'Markdown', reply_markup: keyboard });
    }
  }
}

/**
 * Детальний перегляд завдання
 */
export async function handleTaskDetail(ctx, taskId, prevFilter = 'all', prevPage = 1) {
  const task = await SniperTask.findById(taskId);
  if (!task) {
    return ctx.reply('❌ Завдання не знайдено.');
  }

  const statusEmoji = task.status === 'hunting' ? '🔍' :
    task.status === 'paused' ? '⏸' :
      task.status === 'completed' ? '✅' : '❌';

  let message = `${statusEmoji} *Деталі завдання*\n\n`;
  message += `📦 *Товар:* [${task.productName}](${task.url})\n`;
  message += `🎨 *Колір:* ${task.selectedColor?.name || 'N/A'}\n`;
  message += `📏 *Розмір:* ${task.selectedSize?.name || 'N/A'}\n`;
  message += `🆔 *SKU:* \`${task.skuId}\`\n`;
  message += `📊 *Статус:* \`${task.status}\`\n`;
  message += `🔄 *Спроб:* ${task.attempts}\n`;
  message += `📅 *Створено:* ${new Date(task.createdAt).toLocaleString('uk-UA')}\n`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: '🔄 Рестарт', callback_data: `restart_task:${task._id}` },
        { text: '🛑 Стоп', callback_data: `stop_task:${task._id}` }
      ],
      [
        { text: '🗑️ Видалити', callback_data: `delete_task:${task._id}` }
      ],
      [
        { text: '🔙 До списку', callback_data: `tasks_page:${prevPage}:${prevFilter}` }
      ]
    ]
  };

  // Try to get screenshot
  try {
    const page = getTaskPage(taskId);
    if (page && !page.isClosed()) {
      const screenshot = await page.screenshot({ type: 'png', fullPage: false });
      await ctx.replyWithPhoto({ source: Buffer.from(screenshot) }, {
        caption: message,
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
      // Remove previous message to clean up if called from list
      if (ctx.callbackQuery) {
        await ctx.deleteMessage().catch(() => { });
      }
      return;
    }
  } catch (e) {
    console.log(`[Detail] No screenshot available: ${e.message}`);
  }

  // Fallback if no screenshot
  try {
    if (ctx.callbackQuery) {
      await ctx.editMessageText(message, { parse_mode: 'Markdown', reply_markup: keyboard, disable_web_page_preview: true });
    } else {
      await ctx.reply(message, { parse_mode: 'Markdown', reply_markup: keyboard, disable_web_page_preview: true });
    }
  } catch (e) { }
}

/**
 * Команда /view - вибір завдання для скріншота
 */
export async function handleView(ctx) {
  const userId = ctx.from.id;
  const user = await User.findOne({ telegramId: userId });

  if (!user) return ctx.reply('❌ Користувача не знайдено');

  const tasks = await SniperTask.find({ userId: user._id, status: 'hunting' });

  if (tasks.length === 0) {
    return ctx.reply('📭 Немає активних завдань для перегляду.');
  }

  const keyboard = [];
  for (const task of tasks) {
    keyboard.push([{
      text: `📸 ${task.productName} (${task.selectedSize?.name})`,
      callback_data: `view_task:${task._id}`
    }]);
  }

  await ctx.reply('Оберіть завдання для перегляду:', {
    reply_markup: { inline_keyboard: keyboard }
  });
}

/**
 * Обробка скріншота конкретного завдання
 */
export async function handleTaskScreenshot(ctx, taskId) {
  try {
    const page = getTaskPage(taskId);

    if (!page || page.isClosed()) {
      return ctx.reply('❌ Вкладка для цього завдання не активна або закрита (можливо, завдання на паузі).');
    }

    await ctx.replyWithChatAction('upload_photo');

    // Робимо скріншот
    const screenshot = await page.screenshot({ type: 'png', fullPage: false });

    await ctx.replyWithPhoto(
      { source: Buffer.from(screenshot) },
      { caption: `📸 Стан завдання ${taskId}` }
    );

  } catch (error) {
    console.error('Screenshot error:', error);
    await ctx.reply(`❌ Не вдалося зробити скріншот: ${error.message}`);
  }
}


/**
 * Команда /pause
 */
export async function handlePause(ctx, taskId) {
  if (!taskId) {
    return ctx.reply('❌ Вкажіть ID завдання: /pause <id>');
  }

  const task = await SniperTask.findById(taskId);
  if (!task) {
    return ctx.reply('❌ Завдання не знайдено');
  }

  task.status = 'paused';
  await task.save();

  // Можемо також зупинити активний процес
  await stopAndCloseTask(taskId);

  await ctx.reply(`⏸ Завдання ${taskId} призупинено`);
}

/**
 * Команда /resume
 */
export async function handleResume(ctx, taskId) {
  if (!taskId) {
    return ctx.reply('❌ Вкажіть ID завдання: /resume <id>');
  }

  const task = await SniperTask.findById(taskId);
  if (!task) {
    return ctx.reply('❌ Завдання не знайдено');
  }

  task.status = 'hunting';
  await task.save();

  // Запускаємо
  startSniper(taskId, ctx.telegram).catch(console.error);

  await ctx.reply(`🔍 Завдання ${taskId} активовано`);
}

/**
 * Команда /delete з меню вибору
 */
export async function handleDeleteMenu(ctx) {
  const userId = ctx.from.id;
  const user = await User.findOne({ telegramId: userId });

  if (!user) return ctx.reply('❌ Користувача не знайдено');

  const tasks = await SniperTask.find({ userId: user._id });

  if (tasks.length === 0) {
    return ctx.reply('📭 Список завдань порожній.');
  }

  const keyboard = [];
  for (const task of tasks) {
    // Форматуємо рядок для кращого сприйняття
    const label = `📌 ${task.productName.substring(0, 20)}... | ${task.selectedSize?.name || 'Size'}`;

    // Додаємо інформаційну кнопку (неактивну, просто як лейбл)
    keyboard.push([{ text: label, callback_data: 'ignore' }]);

    // Під нею кнопка видалення
    keyboard.push([{
      text: `🗑 Видалити це завдання`,
      callback_data: `delete_task:${task._id}`
    }]);
  }
  // Опціонально можна залишити "Видалити ВСІ" в самому низу
  keyboard.push([{ text: '⚠️ Видалити ВСІ завдання', callback_data: 'cmd_delete_all_confirm' }]);

  // Кнопка повернення назад
  keyboard.push([{ text: '🔙 Назад в меню', callback_data: 'cmd_start' }]); // Припускаємо, що cmd_start обробляється або треба додати

  await ctx.reply('Оберіть завдання для видалення:', {
    reply_markup: { inline_keyboard: keyboard }
  });
}

/**
 * Команда /delete
 */
export async function handleDelete(ctx, taskId) {
  if (!taskId) {
    return handleDeleteMenu(ctx);
  }

  // Зупиняємо та закриваємо відповідну вкладку
  await stopAndCloseTask(taskId);

  const task = await SniperTask.findByIdAndDelete(taskId);

  const text = task
    ? `🗑 Завдання *${task.productName}* (${task.selectedSize?.name}) видалено, вкладку закрито.`
    : '❌ Завдання не знайдено (можливо вже видалено)';

  try {
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery('Видалено');
      await ctx.editMessageText(text, { parse_mode: 'Markdown' });
    } else {
      await ctx.reply(text, { parse_mode: 'Markdown' });
    }
  } catch (e) {
    // Ігноруємо помилки редагування
  }
}

/**
 * Видалення всіх завдань
 */
export async function handleDeleteAll(ctx) {
  const userId = ctx.from.id;
  const user = await User.findOne({ telegramId: userId });

  if (!user) return;

  const tasks = await SniperTask.find({ userId: user._id });

  for (const task of tasks) {
    await stopAndCloseTask(task._id);
    await SniperTask.findByIdAndDelete(task._id);
  }

  try {
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery('Всі завдання видалено');
      await ctx.editMessageText('🗑 Всі завдання успішно видалено.', { reply_markup: { inline_keyboard: [] } });
    } else {
      await ctx.reply('🗑 Всі завдання успішно видалено.');
    }
  } catch (e) { }
}


/**
 * Команда /stop
 */
export async function handleStop(ctx) {
  console.log(`[Bot] Отримано команду /stop від ${ctx.from.id}`);
  await ctx.reply('🛑 Зупинка бота та закриття браузера...');

  try {
    const { closeBrowser } = await import('../services/browser.js');
    await closeBrowser();
  } catch (e) {
    console.error('Помилка при закритті браузера:', e);
  }

  process.exit(0);
}

/**
 * Команда /help
 */
export async function handleHelp(ctx) {
  await handleStart(ctx); // Показуємо меню замість тексту
}

