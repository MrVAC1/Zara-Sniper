import { createTaskPage, removeUIObstacles, injectRegionalCookies } from './browser.js';
import { getTimeConfig } from '../utils/timeUtils.js';

const { GOTO_TIMEOUT } = getTimeConfig();

/**
 * Парсинг доступних кольорів та розмірів товару
 */
export async function parseProductOptions(url) {
  // Використовуємо createTaskPage, який сам перевіряє/створює браузер
  let page = null;

  try {
    // Phase 0: Inject Cookies BEFORE navigating
    const browser = await import('./browser.js').then(m => m.getBrowser());
    if (browser) {
      await injectRegionalCookies(browser, url);
    }

    page = await createTaskPage('parse-product');
    console.log(`🔍 [Parser] Відкриваю сторінку: ${url}`);

    // Динамічне очікування завантаження
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: GOTO_TIMEOUT });

      // Fast check for payload immediately after domcontentloaded
      // We don't necessarily need to wait for full body render if payload is in head/script
    } catch (error) {
      if (error.name === 'TimeoutError') {
        console.log('⚠️ [Parser] Тайм-аут завантаження, спроба продовжити...');
      } else {
        throw error;
      }
    }

    // Optimization: Don't wait for selectors if we just need the payload
    // Only wait for body as sanity check
    // await page.waitForSelector('body', { timeout: SELECTOR_TIMEOUT });

    // Крок 1: Обробка Cookie Banner (швидка перевірка)
    // REMOVED WAIT: We inject cookies so banner shouldn't appear or we ignore it
    /*
    try {
      const cookieSelectors = '#onetrust-accept-btn-handler, .cookie-settings-banner__accept-button';
      const acceptBtn = await page.$(cookieSelectors);
      if (acceptBtn) {
        await acceptBtn.click();
        // await page.waitForTimeout(500); // Removed wait
      }
    } catch (e) {}
    */

    // Видалення UI перешкод - теж можна пропустити якщо ми тільки парсимо payload
    // await removeUIObstacles(page); // Optional for parsing

    // Крок 3: Парсинг даних
    // Використовуємо evaluate для отримання даних ВИКЛЮЧНО з viewPayload
    const productData = await page.evaluate(() => {
      // Допоміжна функція для отримання viewPayload
      const getViewPayload = () => {
        if (window.zara && window.zara.viewPayload) {
          return window.zara.viewPayload;
        }
        // Спроба знайти скрипт, якщо window.zara ще не заповнено (хоча на loaded має бути)
        // Ми шукаємо скрипт, що встановлює window.zara.viewPayload
        // Але найчастіше він вже виконався. Якщо ні - спробуємо розпарсити текст скрипта.
        return null;
      };

      const viewPayload = getViewPayload();

      if (!viewPayload || !viewPayload.product) {
        // Fallback: спроба знайти скрипт з viewPayload вручну
        const scripts = Array.from(document.querySelectorAll('script'));
        for (const s of scripts) {
          if (s.textContent.includes('window.zara.viewPayload =')) {
            try {
              // Це небезпечно (eval), але в контексті сторінки ок.
              // Або просто повертаємо null і кидаємо помилку
              // Краще покластися на те, що app loaded.
            } catch (e) { }
          }
        }
        return { error: 'No viewPayload found' };
      }

      const product = viewPayload.product;

      // --- Extract Colors & Sizes from Payload ---
      // product.detail.colors - це масив кольорів

      // 1. Product Basic Info
      const productName = product.name;
      const productId = product.id; // Це Group ID (bundleId) або Product ID? Зазвичай ID.

      // 2. Colors processing
      const colors = [];

      if (product.detail && product.detail.colors) {
        product.detail.colors.forEach(c => {
          // c = { id: '...', name: '...', stylingId: '...', sizes: [...] }

          // Extract Styling (RGB/Image)
          // Usually viewPayload has styling info or we construct URL for image.
          // We need RGB or Hex.
          // c.hexCode exists often.

          const hex = c.hexCode || '';

          // Sizes processing
          const sizes = [];
          if (c.sizes) {
            c.sizes.forEach(s => {
              // s = { id: '...', name: 'M', availability: 'in_stock', price: ... }
              // availability values: 'in_stock', 'low_stock', 'out_of_stock', 'coming_soon', 'back_soon'

              // Determine clean availability boolean
              let isAvailable = (s.availability === 'in_stock' || s.availability === 'low_stock');

              console.log(`[Parser DEBUG] Found Size: ${s.name} | Raw ID: ${s.id}`);
              sizes.push({
                name: s.name,
                value: s.name,
                skuId: s.sku || s.id, // FIX: Use 'sku' property first (e.g. 485...), fallback to 'id'
                searchId: s.reference, // Sometimes useful
                available: isAvailable,
                availabilityStatus: s.availability // Keep original status string
              });
            });
          }

          colors.push({
            name: c.name,
            value: c.id, // Use ID as value
            hex: hex,
            sizes: sizes,
            isAvailable: sizes.some(s => s.available) // Color is available if any size is
          });
        });

        // --- DOM STYLE EXTRACTION ---
        // Match payload colors with DOM elements to get the exact RGB style
        const domButtons = Array.from(document.querySelectorAll('button[data-qa-action="select-color"]'));
        colors.forEach(color => {
          // Normalize color name
          const colorName = color.name.toLowerCase().trim();

          const matchingBtn = domButtons.find(btn => {
            const btnName = (btn.getAttribute('aria-label') || btn.innerText || '').toLowerCase().trim();
            // Try match by name
            if (btnName === colorName || btnName.includes(colorName)) return true;
            // Try match by ID if available in dataset
            if (btn.dataset.id && btn.dataset.id === color.value.toString()) return true;
            return false;
          });

          if (matchingBtn) {
            const styleDiv = matchingBtn.querySelector('div[style], span[style]');
            if (styleDiv) {
              const style = styleDiv.getAttribute('style');
              // Extract background-color value
              const bgMatch = style.match(/background-color:\s*([^;]+)/i);
              if (bgMatch) {
                color.styleRGB = bgMatch[1].trim(); // Save "rgb(36, 37, 36)"
              }
            }
          }
        });
      }

      // Якщо кольорів немає в detail.colors, можливо це simple product
      if (colors.length === 0) {
        // Fallback logic if structure differs
        colors.push({
          name: 'Default',
          value: productId,
          hex: '',
          sizes: [] // Empty sizes if parse failed
        });
      }

      return {
        productName,
        productId,
        colors
      };
    });

    if (productData.error) {
      throw new Error('Failed to extract viewPayload from page.');
    }

    console.log(`[Parser] Extracted ${productData.colors.length} colors via viewPayload.`);

    // ВАЖЛИВО: Ми більше НЕ закриваємо сторінку тут.
    // Вона повертається разом з даними.
    return { ...productData, page };

  } catch (error) {
    console.error('❌ [Parser] Помилка:', error.message);
    if (page && !page.isClosed()) {
      try { await page.close(); } catch (e) { }
    }
    throw error;
  }
}
