import { parseProductOptions } from '../services/zaraParser.js';
import SniperTask from '../models/SniperTask.js';
import User from '../models/User.js';
import { getBotInstance } from '../utils/botInstance.js';
import { startSniper } from '../services/sniperEngine.js';
import { getContext } from '../services/browser.js';
import { checkAvailability, getSizingInfo, STORE_IDS } from '../services/zaraApi.js';
import { getBotId } from '../utils/botUtils.js';

const CURRENT_BOT_ID = getBotId();

// Тимчасове сховище для стану вибору
const userSelectionState = new Map();

// Тимчасове сховище для активних сторінок налаштування (userId -> page)
const activeSetupPages = new Map();

/**
 * Обробка URL товару
 */
export async function handleProductUrl(ctx, url) {
  try {
    const userId = ctx.from.id;
    const message = await ctx.reply('🔍 Аналізую товар та перевіряю регіони... (ES, PL, DE, UA)');

    // Закриваємо попередню сторінку налаштування, якщо є
    if (activeSetupPages.has(userId)) {
      try {
        await activeSetupPages.get(userId).close();
      } catch (e) { }
      activeSetupPages.delete(userId);
    }

    // Переконаємось, що браузер ініціалізовано
    const context = getContext();
    if (!context) {
      throw new Error("Браузер не ініціалізовано. Будь ласка, запустіть бота заново або зачекайте ініціалізації.");
    }

    // Парсинг товару з Retry логікою (3 спроби)
    let productData = null;
    let attempts = 0;
    while (attempts < 3 && !productData) {
      try {
        // Use existing page or create new one
        const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

        // Тепер parseProductOptions повертає { ..., page, productId }
        productData = await parseProductOptions(url, page);
      } catch (e) {
        attempts++;
        console.warn(`Attempt ${attempts} failed: ${e.message}`);

        // Сповіщаємо користувача про проблеми, якщо це не перша спроба
        if (attempts > 1) {
          await ctx.reply(`⚠️ Спроба ${attempts}/3: ${e.message}...`);
        }

        if (attempts === 3) throw e;
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    if (!productData || !productData.colors || productData.colors.length === 0) {
      if (productData?.page) await productData.page.close().catch(() => { });
      return ctx.reply('❌ Не вдалося отримати інформацію про товар. Можливо, сторінка недоступна або змінилася верстка.');
    }

    // Зберігаємо сторінку для подальшої взаємодії
    if (productData.page) {
      activeSetupPages.set(userId, productData.page);
      // Видаляємо page з productData перед збереженням в state
      delete productData.page;
    }

    // --- PHASE A: Multi-region analysis ---

    // Default to UA if not detected
    let targetStoreId = STORE_IDS.UA;
    try {
      const urlObj = new URL(url);
      if (urlObj.pathname.includes('/es/')) targetStoreId = STORE_IDS.ES;
      else if (urlObj.pathname.includes('/pl/')) targetStoreId = STORE_IDS.PL;
      else if (urlObj.pathname.includes('/de/')) targetStoreId = STORE_IDS.DE;
    } catch (e) { }

    // Global Discovery Strategy:
    // Scan all relevant regions (ES, PL, DE, UA) to gather full color/size payload
    // and merge it into a single view.

    // We already have data from the INITIAL URL (could be any region).
    // Let's identify which regions we still need to scan.

    const regionsToScan = [
      { id: STORE_IDS.ES, code: 'es', urlPart: '/es/en/' }, // ES (Master) - English for better parsing
      { id: STORE_IDS.PL, code: 'pl', urlPart: '/pl/pl/' }, // PL
      { id: STORE_IDS.DE, code: 'de', urlPart: '/de/de/' }, // DE
      { id: STORE_IDS.UA, code: 'ua', urlPart: '/ua/uk/' }  // UA
    ];

    // Filter out the region we already scanned (the target URL)
    // Note: productData.productId is available now

    // We need to fetch data from ALL regions to ensure we don't miss any unique colors
    // and to get correct "availability" status if we wanted to show per-region status (though requirement says sync to TARGET).
    // But mainly to find ALL variations.

    if (productData.productId) {
      try {
        // We will scan regions sequentially (or parallel limited) to avoid overloading
        const { parseProductOptions } = await import('../services/zaraParser.js');

        for (const region of regionsToScan) {
          // Skip if this region matches the target store (already parsed in productData)
          if (region.id === targetStoreId) continue;

          console.log(`🔍 Global Discovery: Scanning ${region.code.toUpperCase()}...`);

          // Construct URL for this region
          // We use the ID-based URL format which is more robust
          // https://www.zara.com/[country]/[lang]/product-p[ID].html?v1=[ID]
          // But country/lang part is tricky.
          // Safer: use the regex replace on original URL if possible, or construct standard one.

          let scanUrl = url;
          try {
            const u = new URL(url);
            // Replace the path first segment /xx/xx/ with region's
            const pathParts = u.pathname.split('/');
            // usually ["", "ua", "uk", "product..."]
            if (pathParts.length >= 3) {
              const newPath = region.urlPart + pathParts.slice(3).join('/');
              scanUrl = `${u.origin}${newPath}`;
            }
          } catch (e) {
            scanUrl = `https://www.zara.com${region.urlPart}product-p${productData.productId}.html?v1=${productData.productId}`;
          }

          // Run parallel scans for speed instead of sequential
          // We need to manage multiple pages carefully
          try {
            // const regionData = await parseProductOptions(scanUrl);

            // Use concurrent promise with parseProductOptions if resource allows
            // For now, sequential but optimized

            // Optimization: Use a shared browser context or existing page if possible?
            // parseProductOptions creates new page. 
            // We can optimize parseProductOptions to be lighter? 
            // It already blocks some resources? No, stealth plugin might load full.

            const regionData = await parseProductOptions(scanUrl);

            if (regionData && regionData.colors) {
              // Merge Colors
              regionData.colors.forEach(rColor => {
                const existing = productData.colors.find(c => c.value === rColor.value);
                if (!existing) {
                  // Add new global color
                  rColor.isGlobal = true; // Mark as found globally
                  rColor.sourceRegion = region.code;
                  rColor.isAvailable = false; // Force unavailable in target region
                  if (rColor.sizes) {
                    rColor.sizes.forEach(s => s.available = false);
                  }
                  productData.colors.push(rColor);
                  console.log(`   + Found new color in ${region.code}: ${rColor.name}`);
                } else {
                  // Optionally merge extra info
                }
              });
            }

            // Close the page used for scanning immediately
            if (regionData.page) await regionData.page.close().catch(() => { });

          } catch (scanErr) {
            console.warn(`   - Failed to scan ${region.code}: ${scanErr.message}`);
          }
        }

      } catch (e) {
        console.warn('Global discovery warning:', e.message);
      }
    }

    // Map Availability:
    // We have the full list of colors.
    // Now we need to know if they are available in TARGET region.
    // productData.colors already has availability from TARGET viewPayload (initial parse).

    // Check if parser provided availability
    // Note: parser now sets `isAvailable` based on payload data.
    const hasAvailabilityInfo = productData.colors.some(c => c.isAvailable !== undefined);

    // REMOVED: API fallback logic. We rely 100% on viewPayload from page scans.
    // "Потрібно видалити усю роботу з API, залишивши лише роботу з viewPayLoad"

    if (!hasAvailabilityInfo) {
      console.warn('[Handler] Warning: No availability info from payload. Assuming unavailable or needs manual check.');
      // We do NOT call API here anymore.
    }

    // Збереження стану
    userSelectionState.set(userId, {
      url,
      productName: productData.productName,
      productId: productData.productId, // Store ID
      targetStoreId: targetStoreId, // Save target store
      colors: productData.colors,
      step: 'color'
    });

    // VALIDATION LOG as requested
    const urlRefMatch = url.match(/-p(\d+)\.html/);
    const urlRef = urlRefMatch ? urlRefMatch[1] : 'unknown';
    console.log(`[DISCOVERY] Артикул з URL: ${urlRef}, але для API збережено Internal ID: ${productData.productId}`);

    // Видаляємо повідомлення "Аналізую..."
    try {
      await ctx.telegram.deleteMessage(ctx.chat.id, message.message_id);
    } catch (e) { }

    // Якщо кольорів > 1 -> вибір кольору
    if (productData.colors.length > 0) { // Changed condition to always show if colors exist
      // Додаємо логування знайдених кольорів
      console.log(`[Product] Знайдено ${productData.colors.length} кольорів: ${productData.colors.map(c => c.name).join(', ')}`);

      const colorButtons = productData.colors.map((color, index) => {
        // STATUS FIRST + TRUNCATED NAME for better UX
        const isAvailable = color.isAvailable;
        const statusIcon = isAvailable ? '✅' : '❌';

        // Truncate long names to 20 chars
        let colorName = color.name;
        if (colorName.length > 20) {
          colorName = colorName.substring(0, 20) + '...';
        }

        const text = `${statusIcon} ${colorName}`;
        return {
          text: text,
          callback_data: `select_color:${index}`
        };
      });

      // Розбиваємо кнопки по 2 в ряд
      const keyboard = [];
      for (let i = 0; i < colorButtons.length; i += 2) {
        keyboard.push(colorButtons.slice(i, i + 2));
      }

      await ctx.reply(
        `📦 *${productData.productName}*\n📍 Регіон: ${targetStoreId === STORE_IDS.UA ? '🇺🇦 UA' : '🌍 Global'}\n\n🔴 Оберіть колір:`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: keyboard
          }
        }
      );
    } else {
      // Якщо колір один - одразу розміри
      console.log(`[Product] Знайдено 1 колір: ${productData.colors[0].name}`);
      const singleColor = productData.colors[0];
      await showSizeSelection(ctx, singleColor, 0);
    }
  } catch (error) {
    console.error('❌ Помилка обробки URL:', error);
    await ctx.reply(`❌ Помилка: ${error.message}`);
  }
}

/**
 * Показати вибір розмірів
 */
async function showSizeSelection(ctx, colorData, colorIndex) {
  const userId = ctx.from.id;
  const state = userSelectionState.get(userId);

  if (!state) {
    return ctx.reply('❌ Сесія застаріла. Будь ласка, надішліть URL знову.');
  }

  // --- Multi-region check for Sizes ---
  // If we have productId, let's verify availability in target region (UA) via API for accuracy
  // We can show ✅/❌ based on REAL API data, not just HTML parse

  // REMOVED API CHECK: "Потрібно видалити усю роботу з API"
  // We rely on the availability status already present in `colorData.sizes` (from parser/payload)

  /*
  if (state.productId) {
      try {
           const apiData = await getSizingInfo(STORE_IDS.UA, state.productId);
           // ...
      } catch (e) {
          console.warn('Size API update failed:', e);
      }
  }
  */

  if (!colorData.sizes || colorData.sizes.length === 0) {
    // Спроба динамічного допарсингу тут була б доречною, але складною.
    // Повернемо повідомлення.
    return ctx.reply('❌ Для цього кольору розміри не завантажились. Спробуйте відкрити пряме посилання на цей колір.');
  }

  state.selectedColorIndex = colorIndex;
  state.selectedColor = colorData;
  state.step = 'size';
  userSelectionState.set(userId, state);

  const sizeButtons = colorData.sizes.map((size, index) => {
    let icon = size.available ? '✅' : '❌';

    // STATUS FIRST + SIZE format
    let sizeName = size.name;
    if (sizeName.length > 15) {
      sizeName = sizeName.substring(0, 15) + '...';
    }

    let text = `${icon} ${sizeName}`;

    return {
      text: text,
      callback_data: `select_size:${colorIndex}:${index}`
    };
  });

  // Розбиваємо по 3 в ряд для компактності
  const keyboard = [];
  for (let i = 0; i < sizeButtons.length; i += 3) {
    keyboard.push(sizeButtons.slice(i, i + 3));
  }
  // Додаємо кнопку "Назад" якщо було більше 1 кольору
  if (state.colors.length > 1) {
    keyboard.push([{ text: '🔙 Назад до кольорів', callback_data: 'back_to_colors' }]);
  }

  const messageText = state.colors.length > 1
    ? `🔴 Колір: *${colorData.name}*\n📏 Оберіть розмір:`
    : `📦 *${state.productName}*\n📏 Оберіть розмір:`;

  const extra = {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: keyboard
    }
  };

  try {
    // Спробуємо відредагувати попереднє, якщо це колбек
    if (ctx.callbackQuery) {
      // Wrap in try-catch specifically for telegram 400 errors (message not modified)
      try {
        await ctx.editMessageText(messageText, extra);
      } catch (editError) {
        if (!editError.description.includes('message is not modified')) {
          throw editError;
        }
      }
    } else {
      await ctx.reply(messageText, extra);
    }
  } catch (error) {
    // Фоллбек на нове повідомлення
    await ctx.reply(messageText, extra);
  }
}

/**
 * Обробка вибору кольору
 */
export async function handleColorSelection(ctx, colorIndex) {
  const userId = ctx.from.id;

  // Обробка кнопки "Назад"
  if (colorIndex === 'back_to_colors') {
    const state = userSelectionState.get(userId);
    if (!state) return ctx.answerCbQuery('❌ Сесія застаріла');

    await ctx.answerCbQuery('🔄 Оновлюю дані...');
    const loadingMsg = await ctx.reply('🔄 Оновлення сторінки та сканування регіонів...');

    // Закриваємо попередню сторінку, щоб звільнити ресурси перед новим парсингом
    if (activeSetupPages.has(userId)) {
      try {
        await activeSetupPages.get(userId).close();
      } catch (e) { }
      activeSetupPages.delete(userId);
    }

    try {
      // Повторний парсинг з глобальним скануванням
      const productData = await parseProductOptions(state.url);

      if (!productData || !productData.colors || productData.colors.length === 0) {
        if (productData?.page) await productData.page.close().catch(() => { });
        throw new Error('Не вдалося отримати свіжі дані');
      }

      // Зберігаємо нову сторінку
      if (productData.page) {
        activeSetupPages.set(userId, productData.page);
        delete productData.page;
      }

      // --- GLOBAL DISCOVERY SCAN (same as in handleProductUrl) ---
      const targetStoreId = state.targetStoreId || STORE_IDS.UA;

      const regionsToScan = [
        { id: STORE_IDS.ES, code: 'es', urlPart: '/es/en/' },
        { id: STORE_IDS.PL, code: 'pl', urlPart: '/pl/pl/' },
        { id: STORE_IDS.DE, code: 'de', urlPart: '/de/de/' },
        { id: STORE_IDS.UA, code: 'ua', urlPart: '/ua/uk/' }
      ];

      if (productData.productId) {
        for (const region of regionsToScan) {
          if (region.id === targetStoreId) continue;

          console.log(`🔍 Global Discovery: Scanning ${region.code.toUpperCase()}...`);

          let scanUrl = state.url;
          try {
            const u = new URL(state.url);
            const pathParts = u.pathname.split('/');
            if (pathParts.length >= 3) {
              const newPath = region.urlPart + pathParts.slice(3).join('/');
              scanUrl = `${u.origin}${newPath}`;
            }
          } catch (e) {
            scanUrl = `https://www.zara.com${region.urlPart}product-p${productData.productId}.html?v1=${productData.productId}`;
          }

          try {
            const regionData = await parseProductOptions(scanUrl);

            if (regionData && regionData.colors) {
              regionData.colors.forEach(rColor => {
                const existing = productData.colors.find(c => c.value === rColor.value);
                if (!existing) {
                  rColor.isGlobal = true;
                  rColor.sourceRegion = region.code;
                  rColor.isAvailable = false; // Force unavailable in target region
                  if (rColor.sizes) {
                    rColor.sizes.forEach(s => s.available = false);
                  }
                  productData.colors.push(rColor);
                  console.log(`   + Found new color in ${region.code}: ${rColor.name}`);
                }
              });
            }

            if (regionData.page) await regionData.page.close().catch(() => { });
          } catch (scanErr) {
            console.warn(`   - Failed to scan ${region.code}: ${scanErr.message}`);
          }
        }
      }
      // -----------------------------------------------------------

      // Оновлюємо стейт з новими даними включаючи глобальні кольори
      state.colors = productData.colors;
      state.productName = productData.productName;
      state.productId = productData.productId;
      delete state.selectedColorIndex;
      delete state.selectedColor;
      state.step = 'color';
      userSelectionState.set(userId, state);

      // Видаляємо повідомлення про завантаження
      try {
        await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id);
      } catch (e) { }

      // Видаляємо старе повідомлення з розмірами (те, де натиснули "Назад")
      try {
        await ctx.deleteMessage();
      } catch (e) { }

      // Формуємо кнопки з статусами доступності
      const colorButtons = state.colors.map((color, index) => {
        const isAvailable = color.isAvailable;
        const statusIcon = isAvailable ? '✅' : '❌';

        // Truncate long names
        let colorName = color.name;
        if (colorName.length > 20) {
          colorName = colorName.substring(0, 20) + '...';
        }

        const text = `${statusIcon} ${colorName}`;
        return {
          text: text,
          callback_data: `select_color:${index}`
        };
      });

      const keyboard = [];
      for (let i = 0; i < colorButtons.length; i += 2) {
        keyboard.push(colorButtons.slice(i, i + 2));
      }

      await ctx.reply(
        `📦 *${state.productName}*\n\n🔴 Оберіть колір (оновлено + глобальний скан):`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: keyboard
          }
        }
      );

    } catch (error) {
      console.error('Refresh error:', error);
      await ctx.reply('❌ Не вдалося оновити дані. Спробуйте ще раз /start');
      // Видаляємо лоадер якщо помилка
      try {
        await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id);
      } catch (e) { }
    }
    return;
  }

  const state = userSelectionState.get(userId);

  if (!state) {
    return ctx.answerCbQuery('❌ Сесія застаріла');
  }

  const colorIndexNum = parseInt(colorIndex);
  if (isNaN(colorIndexNum) || colorIndexNum < 0 || colorIndexNum >= state.colors.length) {
    return ctx.answerCbQuery('❌ Невірний вибір кольору');
  }

  const selectedColor = state.colors[colorIndexNum];

  // Якщо розмірів немає (бо парсер взяв тільки для активного кольору),
  // нам треба спробувати їх допарсити прямо зараз.

  if (!selectedColor.sizes || selectedColor.sizes.length === 0) {
    await ctx.answerCbQuery('🔄 Завантажую розміри...');
    const loadingMsg = await ctx.reply('⏳ Зміна кольору та пошук розмірів...');

    try {
      // Використовуємо збережену сторінку, якщо вона є
      let page = activeSetupPages.get(userId);
      let pageCreated = false;

      // Якщо сторінка закрилася або відсутня - створюємо нову
      if (!page || page.isClosed()) {
        const { createTaskPage } = await import('../services/browser.js');
        page = await createTaskPage('temp-parse-' + userId);
        activeSetupPages.set(userId, page);
        pageCreated = true;
      }

      // Таймаути з env
      const GOTO_TIMEOUT = parseInt(process.env.GOTO_TIMEOUT) || 60000;
      const SELECTOR_TIMEOUT = parseInt(process.env.SELECTOR_TIMEOUT) || 10000;
      const ACTION_PAUSE = parseInt(process.env.ACTION_PAUSE) || 2000;

      try {
        // Якщо сторінка нова або ми не на тій URL, переходимо
        if (pageCreated || page.url() !== state.url) {
          await page.goto(state.url, { waitUntil: 'domcontentloaded', timeout: GOTO_TIMEOUT });
        }

        // Знаходимо і клікаємо колір
        // Використовуємо hex або name для ідентифікації
        const colorClicked = await page.evaluate(({ targetName, targetHex }) => {
          const buttons = Array.from(document.querySelectorAll('.product-detail-color-item__color-button, button[data-qa-action="select-color"]'));
          for (const btn of buttons) {
            const label = (btn.getAttribute('aria-label') || btn.innerText || '').toLowerCase();
            const style = btn.querySelector('div[style], span[style]')?.getAttribute('style');

            // Спробуємо знайти за назвою або стилем
            if (label.includes(targetName.toLowerCase()) || (targetHex && style && style.includes(targetHex))) {
              btn.click();
              return true;
            }
          }
          return false;
        }, { targetName: selectedColor.name, targetHex: selectedColor.hex });

        if (colorClicked) {
          await new Promise(r => setTimeout(r, ACTION_PAUSE));

          // Парсимо розміри з viewPayload (надійно)
          const sizes = await page.evaluate(({ targetColorName }) => {
            try {
              if (window.zara && window.zara.viewPayload && window.zara.viewPayload.product) {
                const p = window.zara.viewPayload.product;
                const targetNameNorm = targetColorName.toLowerCase().trim();

                // Find the color by name (flexible match)
                const color = p.detail.colors.find(c =>
                  c.name.toLowerCase().trim() === targetNameNorm ||
                  (c.id && c.id.toString() === targetColorName)
                );

                if (color && color.sizes) {
                  return color.sizes.map(s => ({
                    name: s.name,
                    value: s.name,
                    skuId: s.id, // REAL ZARA ID (e.g. 485248616)
                    available: (s.availability === 'in_stock' || s.availability === 'low_stock')
                  }));
                }
              }
            } catch (e) { console.error('Payload extract error:', e); }
            return [];
          }, { targetColorName: selectedColor.name });

          if (!sizes || sizes.length === 0) {
            throw new Error('Не вдалося отримати ID розмірів з Payload.');
          }

          // Оновлюємо стейт
          selectedColor.sizes = sizes;
          state.colors[colorIndexNum] = selectedColor; // Оновлюємо в загальному масиві
          userSelectionState.set(userId, state);

          // НЕ закриваємо сторінку тут! Залишаємо відкритою для подальших дій
          // await page.close();

          await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id);

          // Продовжуємо як зазвичай
          await showSizeSelection(ctx, selectedColor, colorIndexNum);

        } else {
          throw new Error('Не вдалося знайти кнопку кольору на сторінці.');
        }

      } catch (e) {
        // Якщо помилка - закриваємо сторінку, щоб не висіла
        if (page && !page.isClosed()) await page.close();
        activeSetupPages.delete(userId);
        throw e;
      }

    } catch (error) {
      console.error('Color switch error:', error);
      await ctx.reply('❌ Не вдалося завантажити розміри для цього кольору. Спробуйте надіслати пряме посилання.');
    }
    return;
  }

  await ctx.answerCbQuery(`Обрано: ${selectedColor.name}`);
  await showSizeSelection(ctx, selectedColor, colorIndexNum);
}

/**
 * Обробка вибору розміру та створення завдання
 */
export async function handleSizeSelection(ctx, colorIndex, sizeIndex) {
  // 1. Fix Telegram Timeout: Answer immediately
  if (ctx.callbackQuery) {
    await ctx.answerCbQuery('🚀 Починаю покупку...').catch(() => { });
  }

  const userId = ctx.from.id;
  const state = userSelectionState.get(userId);

  // Закриваємо сторінку налаштування після вибору розміру (бо далі стартує снайпер)
  if (activeSetupPages.has(userId)) {
    try {
      await activeSetupPages.get(userId).close();
    } catch (e) { }
    activeSetupPages.delete(userId);
  }

  if (!state) {
    // Спробуємо відновити з повідомлення? Ні, це складно.
    return ctx.reply('❌ Сесія застаріла. Надішліть посилання знову.');
  }

  const colorIdx = parseInt(colorIndex);
  const sizeIdx = parseInt(sizeIndex);

  const selectedColor = state.colors[colorIdx];
  const selectedSize = selectedColor.sizes[sizeIdx];

  if (!selectedColor || !selectedSize) {
    return ctx.answerCbQuery('❌ Помилка даних');
  }

  const user = await User.findOne({ telegramId: userId });
  if (!user) {
    return ctx.reply('❌ Користувача не знайдено в базі. Напишіть /start');
  }

  // Створення завдання
  // Генеруємо SKU ID надійно
  const skuId = selectedSize.skuId || `${selectedColor.name}-${selectedSize.name}`;

  // NEW: Check Unique Constraint (Phase B Requirement)
  // "Unique Constraint: Заборони створення ідентичних завдань для одного SKU на одного користувача."
  // Check if a task with the same URL and Size is ACTIVE for this BOT
  const existingTask = await SniperTask.findOne({
    botId: CURRENT_BOT_ID,
    url: state.url, // Check by URL
    'selectedColor.name': selectedColor.name, // NEW: Check by Color Name
    'selectedSize.name': selectedSize.name, // Check by Size Name
    status: { $in: ['hunting', 'SEARCHING', 'processing', 'at_checkout', 'monitoring', 'MONITORING', 'PENDING'] }
  });

  if (existingTask) {
    console.warn(`[Guard] Duplicate task rejected for URL: ${state.url} | Size: ${selectedSize.name}`);
    return ctx.reply(`⚠️ Цей товар із вказаним розміром уже доданий до списку відстеження та активний! \nСтатус: ${existingTask.status}`);
  }

  // --- Monitoring & Status Mapping Logic ---
  // If we selected a size that is marked "SEARCHING" (not available), we add to monitoring.
  // We need to clarify if "available" in state.selectedSize reflects REAL TIME status.
  // In `showSizeSelection` we updated it via API.

  // If available -> Immediate Buy (Stealth)
  // If NOT available -> Monitoring (API)

  // Note: logic below was: if page open -> try buy. If failed -> hunting.
  // We should enforce the logic:
  // If size.available === true: Go to checkout immediately.
  // If size.available === false: Go to monitoring.

  const isAvailable = selectedSize.available; // This was updated in showSizeSelection via API

  // REMOVED Scenario A (Immediate Buy) - Delegated to Instant Start in Sniper Engine
  // ...

  // Сценарій Б (або фоллбек): Створюємо снайпер-таску
  try {
    const task = await SniperTask.create({
      userId: user._id,
      botId: CURRENT_BOT_ID, // Use Bot Scope
      url: state.url,
      productName: state.productName,
      productId: state.productId, // Save productId
      targetStoreId: state.targetStoreId || STORE_IDS.UA, // NEW: Save target store
      selectedColor: {
        name: selectedColor.name,
        value: selectedColor.value,
        hex: selectedColor.hex
      },
      selectedSize: {
        name: selectedSize.name,
        value: selectedSize.value,
        skuId: selectedSize.skuId // Ensure SKU is saved in selectedSize too
      },
      targetSize: selectedSize.name, // NEW Field
      targetColorRGB: selectedColor.styleRGB, // Strictly enforce this color style
      skuId: skuId,
      status: isAvailable ? 'processing' : 'hunting', // Processing if available, Hunting if not
      attempts: 0,
      maxAttempts: 1000 // Дефолтне значення
    });

    // Очищення стану
    userSelectionState.delete(userId);

    // Якщо сторінка була в setup, передаємо її снайперу (або закриваємо)
    if (activeSetupPages.has(userId)) {
      const oldPage = activeSetupPages.get(userId);
      // If we are processing immediately, we might want to keep it open?
      // Sniper engine creates its own pages usually.
      if (oldPage && !oldPage.isClosed()) await oldPage.close();
      activeSetupPages.delete(userId);
    }

    if (isAvailable) {
      // await ctx.answerCbQuery('🚀 Починаю покупку...'); // Already answered
      await ctx.reply(`🚀 *Товар є в наявності!* \nЗапускаю процес викупу (Stealth Mode)...`, { parse_mode: 'Markdown' });
    } else {
      // await ctx.answerCbQuery('✅ Завдання створено!'); // Already answered
      // Telegram UI: [Назва/RGB] [❌] (as requested in point 4)
      // We already showed this in Color selection.

      const successMessage = `🎯 *Розміру немає. Додано в моніторинг...*\n\n` +
        `📦 Товар: ${state.productName}\n` +
        `🔴 Колір: ${selectedColor.name}\n` +
        `📏 Розмір: ${selectedSize.name}\n` +
        `🆔 SKU: ${task.skuId}\n` +
        `🔍 Статус: ❌ SEARCHING (Check every 10-15s)`;

      try {
        await ctx.editMessageText(successMessage, { parse_mode: 'Markdown' });
      } catch (e) {
        await ctx.reply(successMessage, { parse_mode: 'Markdown' });
      }
    }

    // 2. Instant Start: Trigger sniper immediately (Async)
    startSniper(task._id, ctx.telegram).catch(err => {
      console.error(`❌ Instant start failed for task ${task._id}:`, err);
    });

  } catch (dbError) {
    console.error('Database error:', dbError);
    await ctx.reply('❌ Помилка збереження завдання в базу даних.');
  }
}

// Експорт для використання в commandHandler
export function getUserSelectionState() {
  return userSelectionState;
}
