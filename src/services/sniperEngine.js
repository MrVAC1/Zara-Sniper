import { getBrowser, createTaskPage, removeUIObstacles, closeAlerts, takeScreenshot, injectRegionalCookies } from './browser.js';
import SniperTask from '../models/SniperTask.js';
import User from '../models/User.js';
import { checkAuthSession, handleCaptcha } from './errorHandler.js';
import taskQueue from './taskQueue.js';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import { checkAvailability, STORE_IDS } from './zaraApi.js';
import { refreshSession } from './tokenManager.js';
import { triggerIpGuard, isSystemPaused } from './healthGuard.js';
import { parseProductOptions } from './zaraParser.js';

dotenv.config();

// --- GLOBAL STATE ---
let isCheckoutLocked = false;
let checkoutQueue = []; // Array of { taskId, priority, resolve }
const CHECKOUT_MAX_LOCK_TIME = 120000; // 120 seconds watchdog

// Queue Helpers
function requestCheckoutLock(taskId, priority) {
  return new Promise((resolve) => {
    if (!isCheckoutLocked && checkoutQueue.length === 0) {
      isCheckoutLocked = true;
      resolve(true); // Immediate access
    } else {
      // console.log(`[QUEUE] Task ${taskId} added to queue (Priority: ${priority})`);
      checkoutQueue.push({ taskId, priority, resolve });
      // Sort: High priority (1) first, then Normal (0)
      checkoutQueue.sort((a, b) => b.priority - a.priority);
    }
  });
}

function releaseCheckoutLock() {
  isCheckoutLocked = false;
  if (checkoutQueue.length > 0) {
    const next = checkoutQueue.shift();
    isCheckoutLocked = true;
    // console.log(`[QUEUE] Releasing lock to Task ${next.taskId}`);
    next.resolve(true);
  }
}

import { getTimeConfig, getJitteredDelay, getSniperInterval, randomDelay } from '../utils/timeUtils.js';

// --- CONSTANTS ---
const {
  SNIPER_INTERVAL,
  GOTO_TIMEOUT,
  SELECTOR_TIMEOUT,
  ACTION_PAUSE,
  CLICK_DELAY,
  MIN_DELAY,
  MAX_DELAY,
  TIMEOUT_SIZE_MENU,
  DELAY_POST_RELOAD,
  DELAY_BETWEEN_CONTINUE,
  TIMEOUT_3DS_REDIRECT,
  DELAY_POST_CVV,
  TIMEOUT_HEALTH_PAGE,
  DELAY_3DS_SUCCESS,
  TIMEOUT_CLICK_TRIAL,
  TIMEOUT_DB_RETRY,
  TIMEOUT_LOOP_RETRY,
  DELAY_WATCH_LOOP,
  TIMEOUT_FAST_SELECTOR,
  TIMEOUT_SOLD_OUT_CHECK,
  TIMEOUT_MODAL_CHECK,
  DELAY_RECOVERY_WATCHDOG,
  DELAY_FAST_RECOVERY,
  DELAY_SUB_SECOND,
  DELAY_CHECKOUT_STEP,
  DELAY_FAST_BACKTRACK,
  TIMEOUT_PAY_BUTTON,
  API_MONITORING_INTERVAL,
  AKAMAI_BAN_DELAY
} = getTimeConfig();

// --- STEALTH HELPERS ---

// Helper for Action Pause Jitter (+/- 15%)
const getActionPause = () => getJitteredDelay(ACTION_PAUSE);

// Helper for Click Delay Jitter (+/- 15%)
const getClickDelay = () => getJitteredDelay(CLICK_DELAY);

/**
 * Detects if the page has redirected to a login/identification wall
 */
async function isLoginPage(page) {
  const url = page.url().toLowerCase();
  if (url.includes('/log-on') || url.includes('/identification') || url.includes('/login')) return true;

  return await page.evaluate(() => {
    const hasLoginButton = !!(
      document.querySelector('button[data-qa-id*="login"]') ||
      document.querySelector('button[data-qa-id*="log-on"]') ||
      document.querySelector('input[type="password"]')
    );
    const urlMatches = window.location.href.includes('/log-on') || window.location.href.includes('/identification');
    return hasLoginButton || urlMatches;
  });
}

async function humanClick(page, selector) {
  try {
    const element = await page.$(selector);
    if (!element) return false;

    const box = await element.boundingBox();
    if (!box) return false;

    // Move to center with some randomness
    const x = box.x + box.width / 2 + randomDelay(-10, 10);
    const y = box.y + box.height / 2 + randomDelay(-10, 10);

    // Curve movement (simulated by steps)
    await page.mouse.move(x, y, { steps: randomDelay(5, 15) });

    // Hover (User requested usage of MIN_DELAY / MAX_DELAY)
    await new Promise(r => setTimeout(r, randomDelay(MIN_DELAY, MAX_DELAY)));

    // Click with delay
    await page.mouse.down();
    await new Promise(r => setTimeout(r, getClickDelay()));
    await page.mouse.up();

    return true;
  } catch (e) {
    console.warn(`[Stealth] Click failed for ${selector}: ${e.message}`);
    // Fallback to standard click
    try { await page.click(selector); return true; } catch (e2) { return false; }
  }
}


async function typeWithJitter(page, selector, text) {
  try {
    await page.focus(selector);
    for (const char of text) {
      await page.keyboard.type(char);
      await new Promise(r => setTimeout(r, randomDelay(50, 150)));
    }
  } catch (e) {
    console.warn(`[Stealth] Typing failed for ${selector}: ${e.message}`);
    await page.fill(selector, text);
  }
}

// --- END STEALTH HELPERS ---

/**
 * Отримати регіональне посилання на кошик з поточного URL
 */
function getRegionalCartUrl(currentUrl) {
  try {
    const url = new URL(currentUrl);
    const pathParts = url.pathname.split('/').filter(Boolean);
    // Zara URL pattern: /store/lang/product...
    if (pathParts.length >= 2) {
      const store = pathParts[0];
      const lang = pathParts[1];
      return `https://www.zara.com/${store}/${lang}/shop/cart`;
    }
  } catch (e) { }
  // Fallback to UA if failed
  return 'https://www.zara.com/ua/uk/shop/cart';
}

// Зберігання активних сторінок: taskId -> page
export const activePages = new Map();

/**
 * Отримати активну сторінку завдання
 */
export function getTaskPage(taskId) {
  return activePages.get(taskId.toString());
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Strict Color Verification
 */
export async function verifyAndSelectColor(page, targetColorRGB, logger) {
  if (!targetColorRGB) return { success: true }; // Skip if no RGB target set (legacy support)

  // 1. Normalize Target Color (HEX -> RGB & Remove Spaces)
  function hexToRgb(hex) {
    const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
    hex = hex.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b);
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? `rgb(${parseInt(result[1], 16)},${parseInt(result[2], 16)},${parseInt(result[3], 16)})` : null;
  }

  let normalizedTarget = targetColorRGB.replace(/\s+/g, '').toLowerCase(); // "rgb(1,2,3)"
  if (normalizedTarget.startsWith('#')) {
    const converted = hexToRgb(normalizedTarget);
    if (converted) normalizedTarget = converted.replace(/\s+/g, '');
  }

  // Ensure "rgb" prefix
  if (!normalizedTarget.startsWith('rgb')) {
    // Fallback or assume it is somehow valid, but likely hex conversion handled it
  }

  logger.log(`[Action] Пошук кольору. Очікуємо (normalized): ${normalizedTarget}`);

  const result = await page.evaluate(async ({ targetRGB }) => {
    const selectorTimeout = 5000;
    const start = Date.now();
    const clean = (str) => str ? str.replace(/\s+/g, '').toLowerCase() : '';

    while (Date.now() - start < selectorTimeout) {
      const buttons = Array.from(document.querySelectorAll('button[data-qa-action="select-color"]'));

      for (const btn of buttons) {
        // Try multiple child levels to find the colored element
        const styleDiv = btn.querySelector('div[style], span[style], div[class*="main-color"]');

        if (styleDiv) {
          // Use Computed Style for accuracy (handles inheritance, hex/rgb rendering diffs)
          const computed = window.getComputedStyle(styleDiv).backgroundColor; // Usually "rgb(r, g, b)"
          const foundColor = clean(computed);

          // Log for debugging (only if close match not found instantly to avoid spam, or finding logic)
          // console.log(`[ColorCheck] Found: ${foundColor} | Target: ${targetRGB}`);

          if (foundColor === targetRGB) {
            // console.log here is invisible to Node
            btn.click();
            return {
              success: true,
              rgb: foundColor,
              log: `[Action] Порівняння кольорів: Очікуємо ${targetRGB} | На сторінці ${foundColor} (MATCH)`
            };
          }
        }
      }
      await new Promise(r => setTimeout(r, 200));
    }

    // If loop finishes without match, output what we found for debugging
    const firstBtn = document.querySelector('button[data-qa-action="select-color"] div[style]');
    const debugColor = firstBtn ? window.getComputedStyle(firstBtn).backgroundColor : 'N/A';

    return {
      success: false,
      foundDebug: debugColor,
      log: `[Action] Порівняння кольорів: Очікуємо ${targetRGB} | На сторінці (перший знайдений): ${clean(debugColor)} (NO MATCH)`
    };
  }, { targetRGB: normalizedTarget });

  // Print the log returned from browser context
  if (result.log) logger.log(result.log);

  return result;
}

/**
 * Перевірка доступності SKU
 */
export async function checkSkuAvailability(page, skuId, selectedColor, selectedSize, logger) {
  try {
    await closeAlerts(page);
    await removeUIObstacles(page);

    logger.log(`[Action] Пошук та вибір розміру: ${selectedSize.name}...`);
    try {
      await page.waitForSelector('button, [class*="size"], [class*="add"]', {
        state: 'attached',
        timeout: SELECTOR_TIMEOUT
      });
    } catch (e) { }

    const sizeAvailable = await page.evaluate(async ({ skuId, sizeName, DELAY_WATCH_LOOP }) => {
      const clean = (text) => text ? text.replace(/\s+/g, ' ').trim().toLowerCase() : '';
      const targetName = clean(sizeName);

      const findByPrecise = () => {
        const res = [];
        const preciseSelectors = [
          `button[data-sku-id="${skuId}"]`,
          `button[data-product-id="${skuId}"]`,
          `button[id="${skuId}"]`,
          `li[data-sku="${skuId}"]`
        ];
        for (const sel of preciseSelectors) {
          try {
            const found = document.querySelectorAll(sel);
            if (found.length) res.push(...Array.from(found));
          } catch (e) { }
        }
        return res;
      };

      let candidateElements = findByPrecise();

      if (candidateElements.length === 0) {
        const menu = document.querySelector('[data-qa-qualifier="size-selector-sizes"], .size-selector-sizes');
        const isMenuVisible = menu && menu.offsetParent !== null;

        if (!isMenuVisible) {
          const trigger = document.querySelector('[data-qa-action="add-to-cart"], [data-qa-action="open-size-selector"], [data-qa-action="product-detail-info-size-selector-trigger"]');
          if (trigger && trigger.offsetParent !== null) {
            trigger.click();
            // Wait for menu animation
            await new Promise(resolve => setTimeout(resolve, 300));
            candidateElements = findByPrecise();
          }
        } else {
          candidateElements = findByPrecise();
        }
      }

      if (candidateElements.length === 0) {
        const potentialElements = Array.from(document.querySelectorAll('button, li[class*="size"], div[class*="size"]'));

        for (const el of potentialElements) {
          const text = clean(el.textContent);
          const label = clean(el.getAttribute('aria-label'));
          const dataName = clean(el.getAttribute('data-name'));

          const isMatch = (text === targetName) ||
            (label === targetName) ||
            (dataName === targetName) ||
            (text.split(' ').includes(targetName));

          if (isMatch) {
            candidateElements.push(el);
          }
        }
      }

      for (const el of candidateElements) {
        const isDisabled = el.classList.contains('is-disabled') ||
          el.getAttribute('data-instock') === 'false' ||
          el.getAttribute('disabled') !== null ||
          el.getAttribute('aria-disabled') === 'true';

        const isInStockAction = el.getAttribute('data-qa-action') === 'size-in-stock';
        const isLowOnStock = el.getAttribute('data-qa-qualifier') === 'size-low-on-stock';
        const isOutOfStockQualifier = el.getAttribute('data-qa-qualifier') === 'size-out-of-stock';
        const isUnavailableClass = el.classList.contains('size-selector-sizes-size--unavailable') ||
          el.classList.contains('size-selector-sizes__size--disabled') ||
          el.classList.contains('disabled');

        let available = false;

        if (isInStockAction || isLowOnStock) {
          available = true;
        } else if (isOutOfStockQualifier || isUnavailableClass) {
          available = false;
        } else {
          available = !isDisabled;
        }

        const elText = (el.textContent || '').toLowerCase();
        if (elText.includes('coming soon') || elText.includes('notify')) {
          available = false;
        }

        if (available) {
          const uniqueId = 'sniper-target-' + Math.random().toString(36).substr(2, 9);
          el.setAttribute('data-sniper-target', uniqueId);
          const uniqueSelector = `[data-sniper-target="${uniqueId}"]`;

          return {
            available: true,
            element: {
              selector: uniqueSelector,
              text: el.textContent?.trim(),
              dataSkuId: el.getAttribute('data-sku-id'),
              dataProductId: el.getAttribute('data-product-id')
            }
          };
        }
      }

      return { available: false, debugCandidates: candidateElements.length };
    }, { skuId, sizeName: selectedSize.name, DELAY_WATCH_LOOP });

    return sizeAvailable;
  } catch (error) {
    logger.error(`Помилка перевірки доступності: ${error.message}`);
    return { available: false, error: error.message };
  }
}

/**
 * Клік на розмір та додавання в кошик
 */
export async function addToCart(page, sizeElement, selectedColor, logger) {
  try {
    await closeAlerts(page);

    const similarProductsBtn = await page.$('[data-qa-action="show-similar-products"]');
    if (similarProductsBtn && await similarProductsBtn.isVisible()) {
      logger.warn('Товар розпродано (знайдено кнопку "Show similar products").');
      throw new Error('Товар розпродано (Sold Out)');
    }

    // REDUNDANT RELOAD REMOVED - Loop start already reloads

    const menuSelector = '[data-qa-qualifier="size-selector-sizes"]';
    const isMenuOpenInitially = await page.locator(menuSelector).isVisible().catch(() => false);

    const triggerSelectors = [
      '[data-qa-action="product-detail-info-size-selector-trigger"]',
      'button:has-text("ДОДАТИ")',
      '[data-qa-action="add-to-cart"]',
      '[data-qa-action="open-size-selector"]'
    ];

    const targetSizeSelector = sizeElement ? sizeElement.selector : null;
    let isSizeVisible = false;
    if (targetSizeSelector) {
      isSizeVisible = await page.locator(targetSizeSelector).isVisible().catch(() => false);
    }

    let triggerClicked = isMenuOpenInitially || isSizeVisible;
    if (!triggerClicked) {
      for (const selector of triggerSelectors) {
        try {
          // Use humanClick if possible, else standard
          if (await humanClick(page, selector)) {
            logger.log(`[Action] Відкриваю список розмірів (Click "${selector}")...`);
            triggerClicked = true;
            break;
          }
        } catch (e) { }
      }
    } else {
      if (isSizeVisible) {
        logger.log('[Action] Size button is already visible, skipping triggers.');
      } else {
        logger.log('[Action] Size selector is already open.');
      }
    }

    if (!triggerClicked) {
      logger.warn(`Кнопки відкриття розмірів не знайдені. Спробую знайти розмір напряму.`);
    }

    const sizeName = (sizeElement && (sizeElement.dataSkuId || sizeElement.text))
      ? (selectedColor.sizes?.find(s => s.skuId === sizeElement.dataSkuId || s.name === sizeElement.text)?.name || sizeElement.text)
      : (selectedColor.sizes?.find(s => s.skuId === (sizeElement ? sizeElement.dataSkuId : null))?.name || (sizeElement ? sizeElement.text : selectedColor.sizes?.[0]?.name));

    // --- PRECISE SIZE SELECTION LOGIC ---
    let cleanSize = sizeName;
    if (cleanSize && cleanSize.includes(' ')) {
      const parts = cleanSize.trim().split(' ');
      cleanSize = parts[parts.length - 1]; // Take the last word (e.g., "L" from "My size L")
    }
    // Also handle case where it might be a single character after a specific phrase
    if (cleanSize && cleanSize.length > 5) {
      const match = cleanSize.match(/([a-zA-Z0-9]+)$/);
      if (match) cleanSize = match[1];
    }

    logger.log(`[Action] Attempting to select size: "${cleanSize}" (original: "${sizeName}")...`);
    const targetSize = cleanSize;

    try {
      // Step 1: Reactive check - is menu already open?
      const menuSelector = '[data-qa-qualifier="size-selector-sizes"]';
      const isMenuOpen = await page.locator(menuSelector).isVisible().catch(() => false);

      if (!isMenuOpen) {
        logger.log('[Action] Size selector NOT open. Triggering toggle...');
        // The trigger buttons were clicked above, but if it's still not open,
        // they might have failed or it's a different UI state.
        // We already have triggerClicked logic, so we just wait for the menu now.
      }

      // Step 2: Immediate check for size button (Speed optimization)
      const sizeBtnSelector = `button[data-qa-action="size-in-stock"]`;
      const sizeButton = page.locator(sizeBtnSelector).filter({
        has: page.locator('div[data-qa-qualifier="size-selector-sizes-size-label"]', {
          hasText: new RegExp(`^${targetSize}$`, 'i')
        })
      }).first();

      const instantMatch = await sizeButton.count() > 0;

      if (!instantMatch) {
        logger.log('[Action] Size button not immediately visible. Waiting for menu...');
        // Step 3: Wait for size menu with backtrack
        const success = await page.waitForSelector(menuSelector, { state: 'visible', timeout: TIMEOUT_SIZE_MENU }).catch(() => null);

        if (!success) {
          logger.warn('[Backtrack] Size menu NOT visible. Waiting 2s and retrying toggle...');
          await delay(2000);
          // Re-click triggers
          for (const selector of triggerSelectors) {
            await humanClick(page, selector).catch(() => { });
          }
          await page.waitForSelector(menuSelector, { state: 'visible', timeout: TIMEOUT_SIZE_MENU }).catch(() => { });
        }
      }

      // Step 4: Instant Click Logic (Bypass Micro-updates)
      if (instantMatch || await sizeButton.count() > 0) {
        logger.log(`[Action] Found size "${targetSize}". Executing instant click...`);

        // Trial click for millisecond check
        await sizeButton.click({ trial: true, timeout: TIMEOUT_CLICK_TRIAL }).catch(() => { });

        // Final click with force and noWaitAfter
        await sizeButton.click({
          force: true,
          noWaitAfter: true
        });

        logger.log(`[Action] ✅ Instant click executed for "${targetSize}".`);
        return true;
      } else {
        logger.warn(`[Action] Size "${targetSize}" not found with precise locator. Trying fallback...`);
        throw new Error('Size button not found with primary method');
      }
    } catch (primaryError) {
      logger.warn(`[Action] Primary method failed: ${primaryError.message}. Trying fallback...`);

      // FALLBACK: Old evaluate-based method
      const sizeClicked = await page.evaluate(async ({ targetName }) => {
        const buttons = Array.from(document.querySelectorAll('[data-qa-action="size-selector-sizes-size-link"], [data-qa-action="size-in-stock"], [data-qa-action="size-low-on-stock"]'));
        const clean = t => t ? t.trim().toLowerCase() : '';
        const target = clean(targetName);

        for (const btn of buttons) {
          const btnText = clean(btn.innerText || btn.textContent);
          if (btnText === target || btnText.startsWith(target + ' ') || btnText.includes(' ' + target)) {
            if (btn.disabled || btn.classList.contains('is-disabled') || btn.getAttribute('aria-disabled') === 'true') {
              continue;
            }
            btn.click();
            return true;
          }
        }
        return false;
      }, { targetName: targetSize });

      if (sizeClicked) {
        logger.log(`[Action] ✅ Size "${targetSize}" clicked (fallback method).`);
        return true;
      } else {
        // Final fallback - old class-based selector
        logger.warn(`[Action] Second fallback attempt...`);
        const sizeClickedFallback = await page.evaluate(({ targetName }) => {
          const buttons = Array.from(document.querySelectorAll('.size-selector-sizes-size__button'));
          const clean = t => t ? t.trim().toLowerCase() : '';
          const target = clean(targetName);
          for (const btn of buttons) {
            const btnText = clean(btn.textContent);
            if (btnText === target || btnText.startsWith(target + ' ') || btnText.includes(' ' + target)) {
              if (!btn.disabled && !btn.classList.contains('is-disabled')) {
                btn.click();
                return true;
              }
            }
          }
          return false;
        }, { targetName: targetSize });

        if (sizeClickedFallback) {
          logger.log(`[Action] ✅ Size "${targetSize}" clicked (old class fallback).`);
          return true;
        } else {
          // Error: No method worked
          logger.error(`❌ [Cart] Не вдалося знайти розмір "${targetSize}" на сторінці.`);

          // Take screenshot for debugging
          const screenshotPath = `screenshots/size-not-found-${Date.now()}.png`;
          await takeScreenshot(page, screenshotPath);

          throw new Error(`Size "${sizeName}" not found or not clickable`);
        }
      }
    }
    // ----------------------------------------

    return true;
  } catch (error) {
    logger.error(`Помилка додавання в кошик: ${error.message}`);
    throw error;
  }
}

/**
 * Верифікація додавання в кошик
 */
export async function verifyCartAddition(page, logger) {
  try {
    // 1. Instant check for cart count (Fastest method)
    const countSelector = 'span[data-qa-id="layout-header-go-to-cart-items-count"]';
    const cartCount = await page.$eval(countSelector, el => parseInt(el.textContent) || 0).catch(() => 0);

    if (cartCount > 0) {
      logger.success(`Товар у кошику (кількість: ${cartCount}). Переходжу до оформлення...`);
      return true;
    }

    // 2. Reactive wait for cart button as fallback
    await page.waitForSelector('[data-qa-id="layout-header-go-to-cart"]', { timeout: TIMEOUT_FAST_SELECTOR }).catch(() => null);

    const cartBtn = await page.$('[data-qa-id="layout-header-go-to-cart"]');
    if (cartBtn) return true;

    // 3. Last fallback: check for success messages
    let successMessage = await page.evaluate(() => {
      const messages = Array.from(document.querySelectorAll('[class*="success"], [class*="added"], [class*="notification"]'));
      for (const msg of messages) {
        const text = msg.textContent?.toLowerCase() || '';
        if (text.includes('додано') || text.includes('added') || text.includes('кошик') || text.includes('cart')) {
          return true;
        }
      }
      return false;
    }).catch(() => false);

    if (successMessage) {
      logger.success('Товар успішно додано в кошик');
      return true;
    }
    return false;
  } catch (error) {
    logger.error(`Помилка верифікації кошика: ${error.message}`);
    return false;
  }
}

/**
 * Швидке оформлення замовлення (Fast Checkout)
 */
export async function fastCheckout(page, user, logger) {
  try {
    await closeAlerts(page);
    let navigatedToCart = false;

    const headerCartSelector = '[data-qa-id="layout-header-go-to-cart"]';
    try {
      if (await humanClick(page, headerCartSelector)) {
        logger.log(`[Cart] Натискаю на кошик в хедері (${headerCartSelector})`);
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: GOTO_TIMEOUT });
        navigatedToCart = true;
      }
    } catch (e) {
      logger.warn(`[Checkout] Header button attempt failed: ${e.message}`);
    }

    if (!navigatedToCart) {
      const resumeUrl = getRegionalCartUrl(page.url());
      logger.log(`[Checkout] Перехід за прямим посиланням: ${resumeUrl}`);
      await page.goto(resumeUrl, { timeout: GOTO_TIMEOUT });
    }

    if (await isLoginPage(page)) {
      logger.error('🛑 [FastCheckout] Виявлено перенаправлення на сторінку входу.');
      return false;
    }

    await delay(getActionPause());
    await closeAlerts(page);

    const checkoutSelectors = [
      'button[class*="checkout"]',
      'button[class*="pay"]',
      'button:has-text("Оплатити")',
      'button:has-text("Checkout")',
      'button:has-text("Process order")',
      'button[data-testid*="checkout"]'
    ];

    let checkoutFound = false;
    for (const selector of checkoutSelectors) {
      if (await humanClick(page, selector)) {
        logger.success('[Action] Клік на Checkout. Перехід до оплати.');
        checkoutFound = true;
        return true;
      }
    }

    if (!checkoutFound) {
      logger.error('[FastCheckout] Critical Error: No checkout buttons found.');
      const errorPath = `screenshots/fast-checkout-error-${Date.now()}.png`;
      await page.screenshot({ path: errorPath }).catch(() => { });
      // Note: userId/telegramBot might be missing in fastCheckout simplified context if called from certain places
      throw new Error('Checkout Button Missing in FastCheckout');
    }

    logger.warn('[Checkout] Кнопку Checkout не знайдено, але ми в кошику.');
    return true;
  } catch (error) {
    logger.error(`Помилка оформлення: ${error.message}`);
    throw error;
  }
}

/**
 * Proceed to Checkout Flow
 */
export async function proceedToCheckout(page, telegramBot, taskId, userId, productName, selectedSize, selectedColor, logger, purchaseStartTime = 0) {
  // Determine main recipient
  const ownerIdEnv = process.env.OWNER_ID;
  const firstOwner = ownerIdEnv ? ownerIdEnv.split(',')[0].trim() : null;
  const finalChatId = firstOwner || userId;
  const screenshots = [];

  // --- 30s CHECKOUT WATCHDOG --- (Protect against stuck process)
  const CHECKOUT_HARD_TIMEOUT = 45000;
  let checkoutTimeout = null;

  if (telegramBot && finalChatId) {
    checkoutTimeout = setTimeout(async () => {
      logger.error('[Checkout] ⏳ Timeout: Checkout took > 45s!');
      const errorPath = `screenshots/timeout-${taskId}-${Date.now()}.png`;
      try {
        if (page && !page.isClosed()) await page.screenshot({ path: errorPath, fullPage: true });
        const botApi = telegramBot.telegram || telegramBot;
        await botApi.sendPhoto(finalChatId, { source: errorPath }, {
          caption: '⏰ *Помилка тайм-ауту (45с)!*\nПроцес покупки затягнувся занадто довго.',
          parse_mode: 'Markdown'
        });
      } catch (e) { logger.error(`Timeout Handler Error: ${e.message}`); }
    }, CHECKOUT_HARD_TIMEOUT);
  }

  try {
    logger.log(`🚀 [Checkout] Starting automated checkout flow for ChatID: ${finalChatId}`);

    // Step 1: Go to Cart (Direct Navigation)
    logger.log('[Checkout] Direct navigation to Cart...');
    let cartNavigated = false;

    try {
      const cartUrl = getRegionalCartUrl(page.url());
      logger.log(`[Checkout] Navigating to: ${cartUrl}`);

      await page.goto(cartUrl, { waitUntil: 'domcontentloaded', timeout: GOTO_TIMEOUT });
      cartNavigated = true;

      // --- LOGIN GUARD ---
      if (await isLoginPage(page)) {
        logger.error('🛑 [Checkout] Виявлено перенаправлення на сторінку входу. Зупиняю.');
        if (telegramBot && finalChatId) {
          await telegramBot.telegram.sendMessage(finalChatId, '⚠️ *Увага!* Бот викинуло на сторінку входу. Потрібна повторна авторизація.', { parse_mode: 'Markdown' });
        }
        await SniperTask.findByIdAndUpdate(taskId, { status: 'hunting' });
        if (page) await page.close().catch(() => { });
        activePages.delete(taskId.toString());
        throw new Error('Login Redirect Detected');
      }
    } catch (e) {
      logger.warn(`[Checkout] Direct navigation failed: ${e.message}. Trying fallback...`);
      await fastCheckout(page, null, logger);
    }

    // --- MODAL INTERCEPTOR: "Delete and Continue" Handler ---
    logger.log('[Checkout] Checking for out-of-stock modal...');
    try {
      const modalCloseBtn = await page.waitForSelector('[data-qa-id="close-modal"]', { timeout: TIMEOUT_MODAL_CHECK }).catch(() => null);

      if (modalCloseBtn) {
        logger.warn('[Checkout] Виявлено модальне вікно залишків. Видаляю недоступні товари...');

        // Click modal close button to remove unavailable items
        await humanClick(page, '[data-qa-id="close-modal"]');
        await delay(getActionPause()); // Wait for cart to refresh

        // Send Telegram notification
        if (telegramBot) {
          await telegramBot.telegram.sendMessage(userId, '⚠️ Деякі товари в кошику закінчилися. Видалив їх автоматично і продовжую покупку.');
        }

        // Re-check cart count after deletion
        const countSelector = 'span[data-qa-id="layout-header-go-to-cart-items-count"]';
        let cartCountAfterDelete = 0;
        try {
          const countText = await page.$eval(countSelector, el => el.textContent).catch(() => '0');
          cartCountAfterDelete = parseInt(countText) || 0;
        } catch (e) {
          logger.warn(`[Modal Guard] Could not read cart count: ${e.message}`);
        }

        if (cartCountAfterDelete === 0) {
          logger.warn('[Modal Guard] Кошик порожній після видалення. Повертаюсь до полювання.');

          if (telegramBot) {
            await telegramBot.telegram.sendMessage(userId, '💔 Кошик став порожнім. Повертаюсь до полювання.');
          }

          // Revert to hunting
          await SniperTask.findByIdAndUpdate(taskId, { status: 'hunting' });

          // Close page
          if (page) await page.close().catch(() => { });
          activePages.delete(taskId.toString());

          throw new Error('Cart Empty After Modal Deletion');
        }

        logger.log(`[Modal Guard] Cart has ${cartCountAfterDelete} item(s). Continuing checkout.`);
      }
    } catch (e) {
      if (e.message === 'Cart Empty After Modal Deletion') throw e;
      logger.log('[Checkout] No modal detected or error during modal check.');
    }
    // -------------------------------------------------------

    // --- SOLD OUT HANDLER ---
    logger.log('[Checkout] Checking for Sold Out status...');
    try {
      // Check 1: Wait for "Continue" button (or similar positive signal)
      const continueBtn = await page.waitForSelector('[data-qa-id="shop-continue"], button[class*="continue"], button[class*="order"]', { timeout: TIMEOUT_SOLD_OUT_CHECK }).catch(() => null);

      // Check 2: Scan for "Sold Out" text markers
      const isSoldOut = await page.evaluate(() => {
        const textContent = document.body.innerText.toLowerCase();
        const markers = ['немає в наявності', 'out of stock', 'sold out', 'exhausted', 'unavailable'];
        return markers.some(m => textContent.includes(m));
      });

      if (!continueBtn && isSoldOut) {
        logger.warn(`[Checkout] Item sold out in cart for task ${taskId}. Reverting to hunting mode.`);

        if (telegramBot && finalChatId) {
          await telegramBot.telegram.sendMessage(finalChatId, '💔 Товар закінчився в кошику. Повертаюсь до полювання.');
        }

        // Revert status to hunting
        await SniperTask.findByIdAndUpdate(taskId, { status: 'hunting' });

        // Close page to free resources
        if (page) await page.close().catch(() => { });
        activePages.delete(taskId.toString());

        throw new Error('Item Sold Out in Cart');
      }
    } catch (e) {
      if (e.message === 'Item Sold Out in Cart') throw e;
      logger.warn(`[Checkout] Sold out check warning: ${e.message}`);
    }
    // ------------------------

    // Step 2: Shipping / Payment Flow
    // Try to click "Continue" buttons to reach payment
    const continueSelectors = [
      'button[data-qa-action="continue"]',
      'button:has-text("Continue")',
      'button:has-text("Продовжити")',
      'button:has-text("Далі")'
    ];

    const combinedContinue = continueSelectors.join(', ');

    for (let i = 0; i < 5; i++) {
      let clickedInTerm = false;

      try {
        // 1. Login check once per step
        // Wrap checking in try-catch for destroyed context
        try {
          if (!page || page.isClosed()) throw new Error('Page closed');
          if (await isLoginPage(page)) throw new Error('Login Redirect during flow');
        } catch (e) {
          if (e.message.includes('context was destroyed') || e.message.includes('Target closed')) {
            logger.warn(`[Checkout] Context lost check. Waiting 1s...`);
            await delay(1000);
            if (page && !page.isClosed()) continue; // Restart loop iteration
          }
        }

        // 1.5 Special Check for Google Login Re-auth
        const googleLoginBtn = await page.$('a[data-qa-id="logon-google"]');
        if (googleLoginBtn) {
          logger.warn('[Checkout] ⚠️ Google Login prompt detected!');

          const loginPath = `screenshots/google-login-${taskId}-${Date.now()}.png`;
          await page.screenshot({ path: loginPath, fullPage: true }).catch(() => { });

          if (telegramBot && finalChatId) {
            telegramBot.telegram.sendPhoto(finalChatId, { source: loginPath }, {
              caption: '⚠️ <b>Google Login Detected!</b>\nБот намагається увійти автоматично...',
              parse_mode: 'HTML'
            }).catch(() => { });
          }

          await googleLoginBtn.click({ force: true });
          logger.log('[Checkout] Clicked Google Login. Waiting for redirect...');
          await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { });
          continue; // Restart loop to check for next buttons
        }

        // 2. Wait for ANY of the "Continue" buttons to appear
        const btn = await page.waitForSelector(combinedContinue, {
          visible: true,
          timeout: 2000
        }).catch(() => null);

        if (btn) {
          try {
            await btn.click({ force: true });

            // FIX: Wait for navigation to stabilize!
            await page.waitForLoadState('domcontentloaded', { timeout: 2000 }).catch(() => { });

            logger.log(`[Checkout] Clicked Continue (Step ${i + 1})`);
            clickedInTerm = true;

            // 3. Handle Out-of-Stock Modal (specifically on first step)
            if (i === 0) {
              const closeModalBtn = await page.waitForSelector('[data-qa-id="close-modal"]', { timeout: TIMEOUT_MODAL_CHECK }).catch(() => null);
              if (closeModalBtn) {
                logger.warn('[Checkout] Виявлено модальне вікно (продано). Закриваю та повторюю...');
                await closeModalBtn.click({ force: true });
                await delay(DELAY_FAST_BACKTRACK);
                // Retry the click on the same page
                const retryBtn = await page.$(combinedContinue);
                if (retryBtn) await retryBtn.click({ force: true }).catch(() => { });
                // Wait again after interaction
                await page.waitForLoadState('domcontentloaded', { timeout: 2000 }).catch(() => { });
              }
            }
          } catch (clickError) {
            if (clickError.message.includes('context was destroyed')) {
              logger.warn(`[Checkout] Context destroyed during click (Step ${i + 1}). Waiting 1s...`);
              await delay(1000);
              // If clicked but context died, it usually means navigation happened. 
              // We consider this 'clickedInTerm = true' effectively or let next loop handle it?
              // Safer to process next loop iteration naturally.
              clickedInTerm = true;
            } else {
              throw clickError;
            }
          }

          await delay(DELAY_CHECKOUT_STEP);
        }
      } catch (e) {
        if (e.message.includes('context was destroyed')) {
          logger.warn(`[Checkout] Global Step ${i + 1} Context Error. Retrying step via loop...`);
          await delay(1000);
          i--; // Retry this step index!
          continue;
        }
        logger.warn(`[Checkout] Step ${i + 1} warning: ${e.message}`);
      }

      if (!clickedInTerm) {
        if (i < 2) {
          logger.warn(`[Checkout] Loop ${i + 1}: Кнопку не знайдено. Пробую натиснути попередню через ${DELAY_FAST_BACKTRACK}мс...`);
          await delay(DELAY_FAST_BACKTRACK);
        }

        if (i === 1) { // Critical failure on 2nd step
          const errorPath = `screenshots/checkout-error-${taskId}-${Date.now()}.png`;
          await page.screenshot({ path: errorPath, fullPage: true }).catch(() => { });

          if (telegramBot && finalChatId) {
            const botApi = telegramBot.telegram || telegramBot;
            await botApi.sendPhoto(finalChatId, { source: errorPath }, {
              caption: '❌ *Оформлення перервано!*\nКнопки пропущено або зникли. Перевірте акаунт.',
              parse_mode: 'Markdown'
            }).catch(() => { });
          }

          await SniperTask.findByIdAndUpdate(taskId, { status: 'hunting' });
          if (page) await page.close().catch(() => { });
          activePages.delete(taskId.toString());
          throw new Error('Checkout Flow Interrupted: Buttons Missing');
        }
      }
    }

    // ----------------------------

    // --- SEQUENTIAL PAYMENT FLOW ---
    const authBtnSelector = '[data-qa-action="pay-order"], .payment-footer__pay-button-content, button:has-text("Authorize Payment"), button:has-text("Оплатити")';
    const formBtnSelector = 'button[form="payment-form"]';

    // --- SMART STEP A: Final Authorization / Smart Button Loop ---
    // We combine selectors to act instantly on whatever appears (Continue OR Pay OR CVV)
    const authSelector = '[data-qa-action="pay-order"], .payment-footer__pay-button-content, button:has-text("Authorize Payment"), button:has-text("Оплатити")';
    const anyContinueSelector = 'button[data-qa-action="continue"], button:has-text("Continue"), button:has-text("Продовжити"), button:has-text("Далі")';
    const cvvSelector = '[data-qa-id="payment-data.CARD_CVV"], input[name="payment-data.CARD_CVV"], #cvv'; // Added common CVV selectors

    // Combined selector for race
    const smartSelector = `${authSelector}, ${anyContinueSelector}, ${cvvSelector}`;

    logger.log('[Checkout] Entering Smart Button Loop (Pay, Continue, or CVV)...');
    let authorized = false;
    let smartCvvFilled = false;

    // We give it a few attempts to navigate any final intermediate steps
    for (let attempt = 0; attempt < 8; attempt++) { // Increased attempts for complex flows
      try {
        // Wait for EITHER button or CVV
        const foundEl = await page.waitForSelector(smartSelector, {
          visible: true,
          timeout: TIMEOUT_PAY_BUTTON + 2500 // 5.5s wait
        });

        if (!foundEl) throw new Error('No checkout elements found');

        // Determine which one it is
        const elType = await foundEl.evaluate((el) => {
          const text = (el.innerText || '').toLowerCase();
          const action = el.getAttribute('data-qa-action');
          const tagName = el.tagName.toLowerCase();
          const qaId = el.getAttribute('data-qa-id');

          if (tagName === 'input' || (qaId && qaId.includes('CVV'))) return 'cvv';
          if (text.includes('pay') || text.includes('оплатити') || text.includes('authorize') || action === 'pay-order') return 'pay';
          return 'continue';
        });

        if (elType === 'cvv') {
          if (smartCvvFilled) {
            // Already filled, maybe just wait a bit or looking for button
            await delay(500);
            continue;
          }
          logger.log(`[Checkout] Smart Action: Found Inline CVV. Filling...`);
          const cardCvv = process.env.CARD_CVV;
          if (cardCvv) {
            await foundEl.click();
            await delay(200);
            await foundEl.type(cardCvv);
            await delay(500);
            smartCvvFilled = true;
            logger.success(`[Checkout] ✅ Inline CVV Filled.`);
            // Loop continues to find the Pay button now
          } else {
            logger.warn(`[Checkout] CVV found but CARD_CVV is missing in env!`);
          }
          continue;

        } else if (elType === 'pay') {
          // Found Pay Button!
          await foundEl.click({ force: true });
          logger.success('[Checkout] ✅ Clicked Authorize Payment (Smart Action).');
          await delay(DELAY_WATCH_LOOP);
          authorized = true;
          break; // EXIT LOOP, WE ARE DONE

        } else { // elType === 'continue'
          // Found Continue Button
          logger.log(`[Checkout] Smart Action: Clicked 'Continue' (Attempt ${attempt + 1})`);
          await foundEl.click({ force: true });

          // Short pause to allow UI transition before looking again
          await delay(DELAY_CHECKOUT_STEP);
          continue;
        }

      } catch (e) {
        logger.warn(`[Checkout] Smart Loop attempt ${attempt + 1} warning: ${e.message}`);
        await delay(DELAY_FAST_BACKTRACK);
      }
    }

    if (!authorized) {
      // If we finished loop without clicking Pay
      logger.error('[Checkout] Critical: Authorize button never reached or clicked.');
      // Removed Telegram notification here as requested ("Smart Loop failed")
    }

    // Step B: Form Modal Trigger (if needed)
    try {
      const formBtn = await page.$(formBtnSelector);
      if (formBtn && await formBtn.isVisible()) {
        logger.log('[Checkout] Clicking [form="payment-form"] button...');
        await formBtn.click({ force: true });
        await delay(DELAY_WATCH_LOOP);
      }
    } catch (e) { }

    // Step C: Sequential CVV Monitoring (Wait 5s)
    logger.log('[Checkout] Monitoring for CVV field (Post-click, 5s)...');
    const cardCvv = process.env.CARD_CVV;
    let cvvInjected = false;

    if (cardCvv) {
      const startTime = Date.now();
      while (Date.now() - startTime < 5000) {
        try {
          let cvvField = null;
          let targetFrame = page;

          // Check main page
          cvvField = await page.$('[data-qa-id="payment-data.CARD_CVV"]');
          if (!cvvField) {
            // Check frames
            for (const frame of page.frames()) {
              try {
                cvvField = await frame.$('[data-qa-id="payment-data.CARD_CVV"]');
                if (cvvField) {
                  targetFrame = frame;
                  break;
                }
              } catch (e) { }
            }
          }

          if (cvvField && await cvvField.isVisible()) {
            logger.log('[Checkout] CVV field detected. Injecting...');
            await cvvField.click();
            await delay(TIMEOUT_CLICK_TRIAL / 2); // Small tap delay

            for (const digit of cardCvv) {
              await targetFrame.type('[data-qa-id="payment-data.CARD_CVV"]', digit);
              await delay(randomDelay(50, 150));
            }

            const submitBtn = await targetFrame.$('[data-qa-id="modal-alert-submit-button"]');
            if (submitBtn) {
              await delay(TIMEOUT_CLICK_TRIAL / 2 + 50);
              await submitBtn.click();
              logger.success('[Checkout] ✅ CVV Submitted.');

              // NEW: Explicit wait for modal transition
              await delay(DELAY_POST_CVV);
            }
            cvvInjected = true;
            break;
          }
        } catch (e) { }
        await delay(DELAY_WATCH_LOOP / 2);
      }
    }

    if (!cvvInjected) {
      logger.log('[Checkout] No CVV field appeared or injected. Continuing to result check...');
    }
    // ----------------------------

    // --- CART QUANTITY GUARD ---
    const countSelector = 'span[data-qa-id="layout-header-go-to-cart-items-count"]';
    let cartCount = 0;
    try {
      const countText = await page.$eval(countSelector, el => el.textContent).catch(() => '0');
      cartCount = parseInt(countText) || 0;
    } catch (e) { logger.warn(`[Guard] Could not read cart count: ${e.message}`); }

    if (cartCount > 1) {
      logger.warn(`⚠️ [Guard] У кошику виявлено ${cartCount} товарів! Оплату скасовано.`);

      const screenshotPath = `screenshots/cart-guard-${taskId}-${Date.now()}.png`;
      await takeScreenshot(page, screenshotPath);

      if (telegramBot && finalChatId) {
        const client = telegramBot.telegram || telegramBot;
        await client.sendPhoto(finalChatId, { source: screenshotPath }, {
          caption: `⚠️ <b>УВАГА:</b> У кошику виявлено <b>${cartCount}</b> товарів!\n⛔ Автоматичну оплату скасовано для безпеки.\n👉 Перевірте кошик вручну.`,
          parse_mode: 'HTML'
        }).catch(e => logger.error(`Telegram notify error: ${e.message}`));
      }

      await SniperTask.findByIdAndUpdate(taskId, { status: 'paused' });
      return;
    }
    // ---------------------------

    // Step 4: Final Result Monitoring
    if (cartCount <= 1) {
      logger.success('[Checkout] Monitoring for payment outcome...');

      // --- 3D SECURE CAPTURE ---
      logger.log('[Checkout] Waiting for 3D Secure redirect...');
      try {
        // Wait for redirect to bank page
        const is3DSecure = await Promise.race([
          page.waitForURL(urlObj => {
            const urlStr = (typeof urlObj === 'string') ? urlObj : urlObj.href;
            return urlStr.includes('cardinaltrusted.com') || urlStr.includes('centinelapi');
          }, { timeout: TIMEOUT_3DS_REDIRECT }).then(() => true),
          page.waitForFunction(() => {
            const loc = window.location.href;
            return loc.includes('cardinaltrusted.com') ||
              loc.includes('centinelapi') ||
              loc.includes('secure');
          }, { timeout: TIMEOUT_3DS_REDIRECT }).then(() => true),
          delay(TIMEOUT_3DS_REDIRECT).then(() => false)
        ]);

        if (is3DSecure) {
          if (checkoutTimeout) clearTimeout(checkoutTimeout); // FIX: Stop watchdog IMMEDIATELY!
          logger.log('[Checkout] ✅ 3D Secure page detected!');
          await delay(DELAY_3DS_SUCCESS);

          const finalPath = `screenshots/final-${taskId}-${Date.now()}.png`;
          await takeScreenshot(page, finalPath);
          screenshots.push(finalPath);

          // Final Grouped Notification
          if (telegramBot && finalChatId) {
            const client = telegramBot.telegram || telegramBot;
            console.log('Sending grouped photos to ChatID:', finalChatId);

            for (const path of screenshots) {
              await client.sendPhoto(finalChatId, { source: path }).catch(() => { });
            }

            await client.sendMessage(finalChatId, `🛍 Товар: <b>${productName}</b>\n🎨 Колір: <b>${selectedColor || '—'}</b> | 📏 Розмір: <b>${selectedSize || '—'}</b>\n\n✅ **ОЧІКУЄ ОПЛАТУ!** Підтвердіть у додатку банку.`, {
              parse_mode: 'HTML'
            }).catch(e => logger.error(`Telegram final notify error: ${e.message}`));
          }

          // Cleanup: Delete screenshots after success
          if (screenshots.length > 0) {
            console.log(`[Cleanup] Deleting ${screenshots.length} screenshot(s)...`);
            for (const path of screenshots) {
              await fs.unlink(path).catch(e => logger.warn(`[Cleanup] Failed to delete ${path}: ${e.message}`));
            }
          }

          // Mark task as completed
          // Calculate duration
          const duration = purchaseStartTime ? ((Date.now() - purchaseStartTime) / 1000).toFixed(2) : 'N/A';
          const durationMsg = purchaseStartTime ? `⏱ Час виконання: ${duration} сек` : '';

          await SniperTask.findByIdAndUpdate(taskId, { status: 'completed' });
          logger.success(`[Checkout] ✅ Task marked as COMPLETED. Awaiting bank confirmation. ${durationMsg}`);
          console.log(`[Success] Всі скріншоти надіслано, викуп ініційовано для завдання ${taskId}. ${durationMsg}`);

          return;
        } else {
          logger.warn('[Checkout] 3D Secure redirect not detected.');
        }
      } catch (e3d) {
        logger.warn(`[Checkout] 3D Secure detection error: ${e3d.message}`);
      }
      // ----------------------
    }

    // Fallback Final Notify (if 3D Secure not detected or flow ended prematurely)
    if (telegramBot && finalChatId && screenshots.length > 0) {
      try {
        const client = telegramBot.telegram || telegramBot;
        console.log('Sending grouped photos to ChatID:', finalChatId);
        for (const path of screenshots) {
          await client.sendPhoto(finalChatId, { source: path }).catch(() => { });
        }
        await client.sendMessage(finalChatId, `✅ <b>${productName}</b> (Колір: ${selectedColor || '—'}, Розмір: ${selectedSize || '—'}) додано в кошик!\nПереходжу до оплати... Підтвердіть у банку, якщо потрібно.`, {
          parse_mode: 'HTML'
        });
      } catch (e) { logger.error(`Telegram notify error: ${e.message}`); }
    }
  } catch (error) {
    logger.error(`Checkout Flow Error: ${error.message}`);
    throw error;
  }
}

/**
 * Основна логіка полювання (Hybrid Mode)
 */
async function sniperLoop(task, telegramBot, logger) {
  const browserContext = await getBrowser();
  if (!browserContext) throw new Error('Браузер не ініціалізовано');

  // Start of Sniper Loop
  let page = activePages.get(task._id.toString());
  let apiFound = false;
  let attempts = 0;

  // New: Track availability status for priority
  let detectedAvailability = 'in_stock';

  // New: Flag to track if SKU ID is confirmed valid via API
  // If mismatch occurs, we set this to false until repaired
  let isSkuValidated = false;

  // NEW: State for "Waiting for Catalog" (when color is missing in region)
  let isWaitingForCatalog = false;
  let lastCatalogSkuCount = 0;

  // Extract Product ID and Store ID
  let productId = task.productId; // Primary source: DB (from viewPayload)

  // The previous failed because I provided a snippet that didn't match exactly.
  // I will try to target specific blocks separately if possible, or a larger block if confident.

  // I will perform this in TWO steps to avoid context mismatch issues.
  // Step 1: Add detectedAvailability variable.
  // Step 2: Update Phase 2 logic (Priority Queue).

  // Wait, I cannot do two replace_calls in one turn for the SAME file if they are not using multi_replace.
  // I should use multi_replace interaction.

  // I will use multi_replace for this.
  // Chunk 1: Add variable at top of loop.
  // Chunk 2: Update API success block to save availability.
  // Chunk 3: Replace Phase 2 logic.

  // Wait, let's use `multi_replace_file_content`.

  if (!productId) {
    try {
      const u = new URL(task.url);
      if (u.searchParams.has('v1')) {
        productId = u.searchParams.get('v1');
      } else {
        const match = task.url.match(/-p(\d+)\.html/);
        if (match) productId = match[1];
      }
    } catch (e) {
      const match = task.url.match(/-p(\d+)\.html/);
      if (match) productId = match[1];
    }
    if (productId) {
      // logger.warn(`[Sniper] Warning: task.productId was missing. Extracted from URL: ${productId}`);
      // Initial extraction is just a guess, we rely on DB or Correction
    }
  }

  let storeId = STORE_IDS.UA;
  if (task.url.includes('/es/')) storeId = STORE_IDS.ES;
  else if (task.url.includes('/pl/')) storeId = STORE_IDS.PL;
  else if (task.url.includes('/de/')) storeId = STORE_IDS.DE;

  const initPage = async () => {
    try {
      if (page) {
        if (!page.isClosed()) return;
        await page.close().catch(() => { });
      }

      const existingPage = activePages.get(task._id.toString());
      if (existingPage && !existingPage.isClosed()) {
        page = existingPage;
        logger.log('Підключено до попередньо відкритої сторінки');
        return;
      }

      page = await createTaskPage(task._id);
      activePages.set(task._id.toString(), page);
      logger.log('Створено нову вкладку (waiting for trigger)');
    } catch (e) {
      logger.error(`Не вдалося ініціалізувати сторінку: ${e.message}`);
      throw e;
    }
  };

  try {
    await initPage();
    logger.log(`[Hybrid Sniper] Started for ${task.productName} [${task.selectedSize?.name}]`);

    while ((task.status === 'hunting' || task.status === 'processing') && attempts < task.maxAttempts) {

      // --- PHASE 1: API MONITORING (The Hunter) ---
      let apiFound = false;

      if (task.status === 'processing') {
        logger.log(`[Status] ⚡ Processing Mode: Skipping API Monitor -> Immediate Execution.`);
        apiFound = true;
      } else {
        logger.log(`[Status] 📡 Entering API Monitoring Phase...`);

        while (task.status === 'hunting') {
          if (isSystemPaused()) {
            await delay(TIMEOUT_HEALTH_PAGE);
            continue;
          }

          try {
            // 1. Check Task Status from DB (Heartbeat)
            const freshTask = await SniperTask.findById(task._id);
            if (!freshTask || freshTask.status !== 'hunting') {
              task.status = freshTask ? freshTask.status : 'stopped';
              break;
            }

            // 2. API Check
            // logger.log(`[API] Checking availability...`);
            const data = await checkAvailability(storeId, productId, task.skuId);

            // --- WAITING FOR CATALOG LOGIC ---
            if (isWaitingForCatalog) {
              if (data && data.skusAvailability) {
                const currentCount = data.skusAvailability.length;

                // If catalog changed (count different or non-zero if it was zero)
                // We optimistically try to re-scan
                if (currentCount !== lastCatalogSkuCount && currentCount > 0) {
                  logger.success(`[Catalog Monitor] 🔄 Catalog update detected (SKUs: ${currentCount}). Retrying Auto-Correction...`);
                  isWaitingForCatalog = false;
                  lastCatalogSkuCount = 0; // Reset
                  // Fall through to normal repair logic below
                } else {
                  // Still waiting - skip repair, just sleep
                  if (attempts % 20 === 0) logger.log(`[Catalog Monitor] 💤 Still waiting for color "${task.selectedColor.name}" to appear in catalog...`);
                  await delay(API_MONITORING_INTERVAL * 2); // Slow down polling
                  continue;
                }
              }
            }
            // --------------------------------

            if (data && data.skusAvailability) {
              // Loose equality check for safety (string vs number)
              const targetSku = data.skusAvailability.find(s => s.sku == task.skuId);

              if (targetSku) {
                // Happy Path: SKU ID matches API
                isSkuValidated = true;

                if (targetSku.availability === 'in_stock' || targetSku.availability === 'low_stock') {
                  logger.success(`[API Hunter] 🎯 TARGET DETECTED! SKU: ${task.skuId} is ${targetSku.availability}`);
                  detectedAvailability = targetSku.availability; // Capture status for priority
                  apiFound = true;
                  break; // EXIT API LOOP -> GO TO BROWSER
                }
              } else {
                // Sad Path: SKU NOT FOUND in 200 OK response
                if (!isSkuValidated) {
                  logger.warn(`[Auto-Correction] ⚠️ SKU ${task.skuId} not found in API response. Initiating repair...`);

                  // --- REPAIR LOGIC START ---
                  try {
                    // 1. Ensure Browser Page is Ready
                    if (!page || page.isClosed()) {
                      await initPage();
                    }

                    // 2. Navigate/Refresh to get fresh ViewPayload
                    logger.log(`[Auto-Correction] Reading viewPayload from page: ${task.url}`);
                    await injectRegionalCookies(browserContext, task.url);
                    await page.goto(task.url, { waitUntil: 'domcontentloaded', timeout: GOTO_TIMEOUT });

                    // 3. Extract Correct SKU ID from Payload with SMART MATCHING
                    const repairResult = await page.evaluate(({ targetColorName, targetSizeName }) => {
                      try {
                        if (!window.zara || !window.zara.viewPayload) return null;
                        const p = window.zara.viewPayload.product;
                        if (!p || !p.detail || !p.detail.colors) return null;

                        const targetNameNorm = targetColorName.toLowerCase().trim();

                        // Smart Color Matching Strategy
                        let color = p.detail.colors.find(c =>
                          (c.name && c.name.toLowerCase().trim() === targetNameNorm) ||
                          (c.id && c.id.toString() === targetNameNorm) // Check if user passed ID
                        );

                        // Fallback 1: Try finding match by partial name if exact fails
                        if (!color) {
                          color = p.detail.colors.find(c => c.name && c.name.toLowerCase().includes(targetNameNorm));
                        }

                        // Fallback 2: If product has ONLY ONE color, assume it's the one (common for simple products)
                        if (!color && p.detail.colors.length === 1) {
                          color = p.detail.colors[0];
                        }

                        if (!color) return { error: `Color "${targetColorName}" not found (Smart Match failed). Available: ${p.detail.colors.map(c => c.name).join(', ')}` };

                        const targetSizeNorm = targetSizeName.toLowerCase().trim();
                        const size = color.sizes.find(s => s.name.toLowerCase().trim() === targetSizeNorm);

                        if (!size) return { error: `Size "${targetSizeName}" not found in color ${color.name}` };

                        return {
                          newSkuId: size.sku || size.id, // FIX: Prioritize 'sku'
                          productId: p.id,
                          availability: size.availability
                        };
                      } catch (e) { return { error: e.message }; }
                    }, { targetColorName: task.selectedColor.name, targetSizeName: task.selectedSize.name });

                    if (repairResult && repairResult.newSkuId) {
                      const oldSku = task.skuId;
                      const newSku = repairResult.newSkuId;

                      logger.success(`[Auto-Correction] ✅ FIXED? Old SKU: ${oldSku} -> New SKU: ${newSku}`);

                      // Update Local Task State
                      task.skuId = newSku;
                      if (repairResult.productId) {
                        productId = repairResult.productId; // Update local productId variable
                        task.productId = repairResult.productId;
                      }

                      // Save to DB
                      await SniperTask.findByIdAndUpdate(task._id, {
                        skuId: newSku,
                        productId: task.productId
                      });

                      // Mark as validated (optimistic) or retry immediately?
                      // Let's retry API immediately in next loop iteration
                      isSkuValidated = true;

                      // Optional: Check availability immediately from payload
                      if (repairResult.availability === 'in_stock' || repairResult.availability === 'low_stock') {
                        logger.success(`[Auto-Correction] Payload says IN STOCK! Switching to execution.`);
                        apiFound = true;
                        break;
                      }

                    } else {
                      const errorMsg = repairResult?.error || 'Unknown';
                      logger.error(`[Auto-Correction] Failed to resolve SKU. Payload mismatch. Error: ${errorMsg}`);

                      // NEW: Check if error is "Color not found"
                      if (errorMsg.includes('Color') && errorMsg.includes('not found')) {
                        logger.warn(`[Catalog Monitor] 🔍 Color "${task.selectedColor.name}" missing in this region. Entering WAITING MODE.`);
                        isWaitingForCatalog = true;
                        if (data && data.skusAvailability) lastCatalogSkuCount = data.skusAvailability.length;

                        if (telegramBot && task.userId) {
                          telegramBot.telegram.sendMessage(task.userId, `🔍 <b>Статус: Очікування Каталогу</b>\nКолір "<b>${task.selectedColor.name}</b>" зараз відсутній у каталозі магазину.\nБот перейшов у режим моніторингу і спробує знову, коли каталог оновиться.`, { parse_mode: 'HTML' }).catch(() => { });
                        }
                        // Close page to save resources while waiting
                        if (page) await page.close().catch(() => { });
                        activePages.delete(task._id.toString());
                      }
                    }
                  } catch (repairError) {
                    logger.error(`[Auto-Correction] Repair failed: ${repairError.message}`);
                  }
                  // --- REPAIR LOGIC END ---
                }
              }
            }

            // 3. Wait
            await delay(API_MONITORING_INTERVAL);
            attempts++; // Count API attempts as "activity"

            if (attempts % 10 === 0) {
              task.lastChecked = new Date();
              await task.save();
            }

          } catch (err) {
            if (err.message === 'AKAMAI_BLOCK') {
              logger.warn(`[Akamai Defense] 🛡️ 401/403 Detected. Pausing for ${AKAMAI_BAN_DELAY / 1000}s...`);
              await delay(AKAMAI_BAN_DELAY);
              await refreshSession();
            } else {
              logger.warn(`[API] Error: ${err.message}. Retrying...`);
              await delay(API_MONITORING_INTERVAL);
            }
          }
        }
      }

      if (task.status !== 'hunting' && task.status !== 'processing') break;
      if (!apiFound) continue; // Should not happen unless status changed

      // --- PHASE 2: BROWSER EXECUTION (The Killer) ---
      // Removed old simple wait loop

      logger.log(`[Execution] ⚔️ API confirmed stock. Launching Browser Attack!`);
      const purchaseStartTime = Date.now();

      try {
        if (!page || page.isClosed()) await initPage();

        // 1. Navigate to Product Page
        await injectRegionalCookies(browserContext, task.url); // Ensure cookies
        await page.goto(task.url, { waitUntil: 'domcontentloaded', timeout: GOTO_TIMEOUT });

        await removeUIObstacles(page);
        await closeAlerts(page);

        // 1.5 Strict Color Verification
        const colorCheck = await verifyAndSelectColor(page, task.targetColorRGB, logger);
        if (!colorCheck.success && task.targetColorRGB) { // Strict fail only if RGB was requested
          logger.error(`❌ [Error] Колір не знайдено на сторінці (Expected: ${task.targetColorRGB}). Перевірка регіону або наявності.`);

          // Stop the task as per requirement
          await SniperTask.findByIdAndUpdate(task._id, { status: 'failed' });
          // Close page
          if (page) await page.close().catch(() => { });
          activePages.delete(task._id.toString());

          // Notify user? Maybe later. For now just stop.
          break; // Exit loop
        } else if (colorCheck.success && task.targetColorRGB) {
          logger.success(`✅ [Success] Колір вибрано візуально: ${task.targetColorRGB}.`);

          // Optional: Save status note to DB (as requested)
          // But avoid heavy DB writes inside loop. We can update when marking as 'at_checkout' later.
        }

        // 2. Perform DOM Check & Interaction (Color/Size)
        // Reuse existing logic
        let uiAvailability = await checkSkuAvailability(page, task.skuId, task.selectedColor, task.selectedSize, logger);

        if (uiAvailability.available) {
          logger.success(`[Execution] DOM Confirmed Stock! Entering Checkout Queue...`);

          // 3. PRIORITY QUEUE & LOCKING
          // Determine priority: 1 if low_stock, 0 otherwise
          const priority = detectedAvailability === 'low_stock' ? 1 : 0;

          logger.log(`[QUEUE] Requesting Checkout Lock (Priority: ${priority})...`);
          await requestCheckoutLock(task._id, priority);
          logger.log(`[LOCK] 🔒 Checkout Lock Acquired!`);

          try {
            // 4. API RE-VERIFICATION (As requested)
            logger.log(`[Verification] Re-checking API before purchase...`);

            // Only strictly enforce API check if we have CONFIDENCE in our SKU (isSkuValidated = true)
            // If we are running on "Blind Faith" (DOM said yes, but API mismatch), we skip this check to avoid false negative.
            if (isSkuValidated) {
              const reCheck = await checkAvailability(storeId, productId, task.skuId);
              const reTarget = reCheck?.skusAvailability?.find(s => s.sku == task.skuId);
              const isStillAvailable = reTarget && (reTarget.availability === 'in_stock' || reTarget.availability === 'low_stock');

              if (!isStillAvailable) {
                logger.warn(`[Execution] ❌ Re-verification FAILED (SKU Validated). Item gone or API lag. Releasing lock.`);
                throw new Error('API Re-verification Failed');
              }
              logger.success(`[Verification] ✅ API Confirms Availability: ${reTarget.availability}`);
            } else {
              logger.warn(`[Verification] ⚠️ SKU not validated via API yet. Skipping strict Re-verification and trusting DOM availability.`);
            }

            // 5. Add to Cart & Checkout
            await addToCart(page, uiAvailability.element, task.selectedColor, logger);
            const verified = await verifyCartAddition(page, logger);

            if (verified) {
              await SniperTask.findByIdAndUpdate(task._id, { status: 'at_checkout' });

              // Watchdog definition inside lock scope
              const lockWatchdog = setTimeout(() => {
                if (isCheckoutLocked) {
                  console.error(`[WATCHDOG] ⚠️ Force releasing checkout lock after ${CHECKOUT_MAX_LOCK_TIME}ms`);
                  releaseCheckoutLock();
                }
              }, CHECKOUT_MAX_LOCK_TIME);

              try {
                await proceedToCheckout(page, telegramBot, task._id, task.userId, task.productName, task.selectedSize?.name, task.selectedColor?.name, logger, purchaseStartTime);
                clearTimeout(lockWatchdog);
                return; // Exit loop
              } catch (chkErr) {
                clearTimeout(lockWatchdog);
                throw chkErr;
              }
            } else {
              throw new Error('Failed to verify cart addition');
            }
          } finally {
            // ALWAYS RELEASE LOCK
            if (isCheckoutLocked) {
              releaseCheckoutLock();
              logger.log(`[LOCK] 🔓 Checkout Lock Released.`);
            }
          }

        } else {
          logger.warn(`[Execution] ❌ DOM Reporting Sold Out (Phantom Stock?). Returning to API Monitor.`);
          // IMPORTANT: If we came here from 'processing', we MUST switch to 'hunting' now to prevent infinite loop
          await SniperTask.findByIdAndUpdate(task._id, { status: 'hunting' });
          task.status = 'hunting';
        }

      } catch (browserError) {
        logger.error(`[Execution] Browser Error: ${browserError.message}`);
        await takeScreenshot(page, `screenshots/execution-error-${Date.now()}.png`);

        // Revert to hunting on error
        await SniperTask.findByIdAndUpdate(task._id, { status: 'hunting' });
        task.status = 'hunting';
      }
    }

    // Cleanup if loop ends
    if (page) {
      const isUserStopped = ['stopped', 'paused', 'completed'].includes(task.status);

      // "Виправлення закриття вкладки: Заборони закривати вкладку, якщо targetSkuId ще не був успішно провалідований"
      // We only close if:
      // 1. SKU was validated (normal behavior)
      // 2. OR User explicitly stopped/paused the task
      // 3. OR Task completed

      if (isSkuValidated || isUserStopped) {
        if (!page.isClosed()) await page.close().catch(() => { });
        activePages.delete(task._id.toString());
      } else {
        console.warn(`[Sniper] Loop ended but SKU not validated. Keeping page open for recovery (Task: ${task._id})`);
        // We DO NOT delete from activePages, allowing re-use
      }
    } else {
      activePages.delete(task._id.toString());
    }

  } catch (error) {
    logger.error(`Critical Error: ${error.message}`);
    if (page) await page.close().catch(() => { });
    activePages.delete(task._id.toString());
    throw error;
  }
}

export async function startSniper(taskId, telegramBot, existingPage = null) {
  const task = await SniperTask.findById(taskId);
  if (!task) throw new Error('Task not found');

  // Allow 'processing' to restart without resetting to 'hunting'
  if (task.status !== 'hunting' && task.status !== 'processing') {
    task.status = 'hunting';
    await task.save();
  }

  await taskQueue.enqueue(taskId, async (logger) => {
    // In Hybrid Mode, we don't necessarily need to open the specific product page yet,
    // but we need a browser context for TokenManager. 
    // sniperLoop handles the page creation/usage.

    console.log(`✅ [Sniper] Task Queued: "${task.productName}". Starting Hybrid Monitor...`);
    await sniperLoop(task, telegramBot, logger);
  });
}

export async function stopAndCloseTask(taskId) {
  await stopSniper(taskId);
  const page = activePages.get(taskId.toString());
  if (page) {
    try {
      await page.close();
      console.log(`[Task ${taskId}] Page closed.`);
    } catch (e) { }
    activePages.delete(taskId.toString());
  }
}

export async function stopSniper(taskId) {
  const task = await SniperTask.findById(taskId);
  if (task) {
    task.status = 'paused';
    await task.save();
  }
}
