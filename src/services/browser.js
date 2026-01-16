import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { FingerprintGenerator } from 'fingerprint-generator';
import { FingerprintInjector } from 'fingerprint-injector';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config();

// Налаштування Stealth плагіна
const stealth = StealthPlugin();
chromium.use(stealth);

let globalContext = null;
let isInitializing = false;

const fingerprintGenerator = new FingerprintGenerator();
const fingerprintInjector = new FingerprintInjector();

const IS_MAC = process.platform === 'darwin';

export const USER_AGENT = IS_MAC
  ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-blink-features=AutomationControlled',
  '--disable-infobars',
  '--start-maximized',
  '--disable-web-security',
  '--disable-features=IsolateOrigins,site-per-process',
  '--disable-site-isolation-trials',
  '--use-fake-ui-for-media-stream' // NEW: Stealth arg
];

/**
 * Ініціалізація браузера з постійним контекстом (Singleton)
 */
export async function initBrowser() {
  // Якщо контекст вже існує і активний - повертаємо його
  if (globalContext && isContextHealthy()) {
    return globalContext;
  }

  // Запобігання подвійній ініціалізації
  if (isInitializing) {
    console.log('🔄 Браузер вже ініціалізується, очікування...');
    while (isInitializing) {
      await new Promise(r => setTimeout(r, 500));
      if (globalContext && isContextHealthy()) return globalContext;
    }
  }

  isInitializing = true;

  try {
    // Якщо контекст був, але "мертвий" - закриваємо
    if (globalContext) {
      try { await globalContext.close(); } catch (e) { }
      globalContext = null;
    }

    const userDataDir = path.join(process.cwd(), 'zara_user_profile');

    // Очищення Singleton Lock (для Windows/Chromium глюків)
    const lockFile = path.join(userDataDir, 'SingletonLock');
    if (fs.existsSync(lockFile)) {
      try {
        // Чекаємо трохи, можливо процес ще завершується
        await new Promise(r => setTimeout(r, 1000));
        if (fs.existsSync(lockFile)) {
          fs.unlinkSync(lockFile);
          console.log('🧹 SingletonLock видалено примусово.');
        }
      } catch (e) {
        console.warn('⚠️ Не вдалося видалити SingletonLock (можливо браузер запущено):', e.message);
      }
    }

    console.log(`[Init] Запуск браузера (Chromium)...`);
    console.log(`[Profile] ${userDataDir}`);

    globalContext = await chromium.launchPersistentContext(userDataDir, {
      headless: process.env.HEADLESS === 'true',
      viewport: null,
      ignoreDefaultArgs: ['--enable-automation'],
      args: LAUNCH_ARGS,
      userAgent: USER_AGENT,
      locale: 'uk-UA',
      timezoneId: 'Europe/Kyiv',
      // slowMo: 50, // Можна розкоментувати для дебагу
    });

    // Налаштування таймаутів за замовчуванням
    globalContext.setDefaultTimeout(30000);
    globalContext.setDefaultNavigationTimeout(60000);

    // Generate Fingerprint matching the OS
    const fingerprint = fingerprintGenerator.getFingerprint({
      devices: ['desktop'],
      operatingSystems: [IS_MAC ? 'macos' : 'windows'],
      browsers: [{ name: 'chrome', minVersion: 110 }]
    });

    // Inject Fingerprint
    await fingerprintInjector.attachFingerprintToPlaywright(globalContext, fingerprint);
    console.log(`[Stealth] Fingerprint injected: ${fingerprint.fingerprint.navigator.userAgent}`);

    // Critical Fix: JS-маскування (Additional custom scripts)
    await applyStealthScripts(globalContext);

    // --- GHOST PAGE CLEANER ---
    globalContext.on('page', async (page) => {
      try {
        // Wait 3s to allow for initial redirect
        await new Promise(r => setTimeout(r, 3000));
        if (page.isClosed()) return;

        const url = page.url();
        if (url === 'about:blank' || url === 'data:,') {
          console.log('[Cleaner] Закрито порожню вкладку (about:blank) для економії ресурсів.');
          await page.close().catch(() => { });
        }
      } catch (e) { }
    });
    // ---------------------------

    // Обробка події відключення
    globalContext.on('close', () => {
      console.log('⚠️ Браузерний контекст було закрито!');
    });

    // Також слухаємо disconnected, про всяк випадок
    if (globalContext.browser()) {
      globalContext.browser().on('disconnected', () => {
        console.log('⚠️ Браузер відʼєднано! Завершення роботи...');
        process.exit(0);
      });
    }

    console.log('[Session] ✅ Браузер ініціалізовано.');
    return globalContext;
  } catch (error) {
    console.error('❌ Помилка ініціалізації браузера:', error);
    globalContext = null; // Скидаємо, щоб можна було спробувати знову
    throw error;
  } finally {
    isInitializing = false;
  }
}

/**
 * Перевірка "здоров'я" контексту
 */
function isContextHealthy() {
  if (!globalContext) return false;
  try {
    // Перевіряємо, чи не закритий браузер
    if (globalContext.browser && !globalContext.browser().isConnected()) return false;
    // Для launchPersistentContext немає методу isConnected прямо на контексті в деяких версіях, 
    // але pages() має працювати
    globalContext.pages();
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Отримати поточний інстанс (або ініціалізувати новий)
 */
export async function getBrowser() {
  if (!globalContext || !isContextHealthy()) {
    return await initBrowser();
  }
  return globalContext;
}

export async function closeBrowser() {
  if (globalContext) {
    await globalContext.close();
    globalContext = null;
    console.log('🔌 Браузер закрито');
  }
}

/**
 * Періодична чистка вкладок (Garbage Collection)
 */
export function startAutoCleanup(context, activePages) {
  console.log('[Cleaner] Авто-чистка вкладок активована (кожні 10 хв)');

  setInterval(async () => {
    try {
      console.log('[Cleaner] Запуск періодичної чистки вкладок...');
      const pages = context.pages();

      for (const page of pages) {
        try {
          if (page.isClosed()) continue;

          const url = page.url();
          const isBlank = url === 'about:blank' || url === 'data:,' || url === '';

          // Перевіряємо чи сторінка прив'язана до активного завдання
          let isAssociated = false;
          if (activePages) {
            for (const [taskId, activePage] of activePages.entries()) {
              if (activePage === page) {
                isAssociated = true;
                break;
              }
            }
          }

          // Закриваємо якщо порожня і не прив'язана
          if (!isAssociated && isBlank) {
            console.log(`[Cleaner] Закриття неактивної вкладки: ${url || 'empty'}`);
            await page.close().catch(() => { });
          }
        } catch (e) { }
      }
    } catch (e) {
      console.error('[Cleaner] Помилка чистки:', e.message);
    }
  }, 10 * 60 * 1000); // 10 хвилин
}

/**
 * Створення нової сторінки в існуючому контексті
 */
export async function createTaskPage(taskId) {
  const context = await getBrowser();
  const page = await context.newPage();

  // Базові заголовки
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'uk-UA,uk;q=0.9,en-US;q=0.8,en;q=0.7'
  });

  return page;
}

/**
 * Ін'єкція кук для обходу регіональних обмежень (Phase 0)
 */
export async function injectRegionalCookies(context, url) {
  if (!url) return;

  try {
    const domain = new URL(url).hostname;
    const cleanDomain = domain.replace('www.', '');

    // Визначаємо Store ID за доменом (спрощено)
    let storeId = '11767'; // Default UA
    if (domain.includes('zara.com/es')) storeId = '10701';
    if (domain.includes('zara.com/pl')) storeId = '10659';
    if (domain.includes('zara.com/de')) storeId = '10500';

    const cookies = [
      {
        name: 'CookiesConsent',
        value: 'C0001%3BC0002%3BC0003%3BC0004', // Pre-accepted all groups
        domain: `.${cleanDomain}`,
        path: '/'
      },
      {
        name: 'OptanonAlertBoxClosed',
        value: new Date().toISOString(),
        domain: `.${cleanDomain}`,
        path: '/'
      },
      {
        name: 'storeId',
        value: storeId,
        domain: `.${cleanDomain}`,
        path: '/'
      }
    ];

    await context.addCookies(cookies);
    console.log(`[Cookies] Ін'єктовано регіональні куки для ${cleanDomain}`);
  } catch (e) {
    console.warn(`[Cookies] Помилка ін'єкції: ${e.message}`);
  }
}

/**
 * Окремий режим для входу (Login Mode)
 */
export async function startLoginSession() {
  // Закриваємо поточну сесію, якщо є, щоб звільнити профіль
  await closeBrowser();

  try {
    const userDataDir = path.join(process.cwd(), 'zara_user_profile');
    console.log('\n🔑 [Login Mode] Запуск сесії для авторизації...');
    console.log('--------------------------------------------------');
    console.log('📝 ІНСТРУКЦІЯ:');
    console.log('1. У вікні браузера, що відкриється, увійдіть у свій акаунт Zara.');
    console.log('2. Пройдіть капчу або підтвердження через Email/SMS, якщо потрібно.');
    console.log('3. ПІСЛЯ успішного входу — просто ЗАКРИЙТЕ вікно браузера.');
    console.log('--------------------------------------------------\n');

    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      viewport: null,
      ignoreDefaultArgs: ['--enable-automation'],
      args: LAUNCH_ARGS,
      userAgent: USER_AGENT,
      locale: 'uk-UA',
      timezoneId: 'Europe/Kyiv',
    });

    await applyStealthScripts(context);

    const page = await context.newPage();
    page.setDefaultNavigationTimeout(0); // No timeout for manual login
    page.setDefaultTimeout(0);

    // Navigate directly to identification page
    console.log('🌐 Перехід на сторінку входу Zara UA...');
    await page.goto('https://www.zara.com/ua/uk/identification', { waitUntil: 'domcontentloaded' })
      .catch(() => page.goto('https://www.zara.com/ua/uk/', { waitUntil: 'domcontentloaded' }));

    // Wait for the window to close
    await new Promise((resolve) => {
      context.on('close', resolve);
      // Also resolve if all pages are closed manually
      context.on('page', (p) => {
        p.on('close', () => {
          if (context.pages().length === 0) resolve();
        });
      });
    });

    // Before fully exiting, try to log status
    try {
      const cookies = await context.cookies();
      const sessionCookie = cookies.find(c => c.name === 'Z_SESSION_ID' || c.name === 'itx-v-ev');
      console.log(`\n✅ Сесію завершено. Отримано кук: ${cookies.length}`);
      if (sessionCookie) {
        console.log(`📡 Виявлено активну сесію: ${sessionCookie.name} (Захищено)`);
      } else {
        console.warn('⚠️ Попередження: Основну сесію не знайдено. Переконайтеся, що ви натиснули "Увійти".');
      }
    } catch (e) { }

    await context.close().catch(() => { });
    console.log('🚪 Браузер закрито. Профіль оновлено.');
  } catch (error) {
    console.error('❌ Помилка режиму входу:', error);
  }
}

export async function takeScreenshot(page, path = null) {
  try {
    if (page.isClosed()) return null;
    const screenshot = await page.screenshot({
      fullPage: true,
      path: path || `screenshots/screenshot-${Date.now()}.png`
    });
    return screenshot;
  } catch (error) {
    console.error('❌ Помилка скріншота:', error.message);
    return null;
  }
}

export async function closeAlerts(page) {
  try {
    if (page.isClosed()) return;

    // Селектори для закриття діалогових вікон
    const selectors = [
      '[data-qa-id="zds-alert-dialog-cancel-button"]', // Основний селектор з ТЗ
      '[data-testid="dialog-close-button"]',
      'button[aria-label="Close"]',
      '#onetrust-accept-btn-handler', // Cookies Accept
      '#onetrust-reject-all-handler', // Cookies Reject
      '.cookie-settings-banner button',

      // NEW: Language/Region Switcher Modal (Ignore/Close)
      // "При переході на сайт іншої країни вибиває сповіщення... ігнорувати це повідомлення"
      // Usually "Go to [Country]" or "Stay on this site"
      'button:has-text("Stay on this site")',
      'button:has-text("Залишитися на цьому сайті")',
      'button:has-text("Kontynuuj na tej stronie")', // PL
      'button:has-text("Auf dieser Website bleiben")', // DE
      'button:has-text("Continuar en España")', // ES
      '[class*="market-selector"] button', // Generic market selector closer
      '[data-qa-action="market-selector-close"]',
      '[class*="layout-header-links-modal"] button:first-child'
    ];

    for (const selector of selectors) {
      try {
        const element = await page.$(selector);
        if (element && await element.isVisible()) {
          console.log(`[Alert] Знайдено спливаюче вікно (${selector}), закриваю...`);
          await element.click();
          // Коротка пауза для анімації закриття
          await new Promise(r => setTimeout(r, 500));
        }
      } catch (e) {
        // Ігноруємо помилки кліку
      }
    }
  } catch (error) {
    // Ігноруємо глобальні помилки (наприклад, context destroyed)
  }
}

export async function removeUIObstacles(page) {
  try {
    if (page.isClosed()) return;

    // Спочатку спробуємо закрити легально
    await closeAlerts(page);

    // Phase 2: Handle Region/Language Selector Fallback
    try {
      const stayOnSiteSelectors = [
        'button:has-text("Stay on this site")',
        'button:has-text("Залишитися на цьому сайті")',
        '[class*="layout-header-links-modal"] button:first-child', // Heuristic for primary action
        '[data-qa-action="stay-on-site"]'
      ];

      // Short check without waiting too long
      for (const selector of stayOnSiteSelectors) {
        const btn = await page.$(selector);
        if (btn && await btn.isVisible()) {
          console.log('[UI] Found "Stay on this site" modal, clicking...');
          await btn.click();
          await new Promise(r => setTimeout(r, 500));
          break;
        }
      }
    } catch (e) { }

    await page.evaluate(() => {
      const selectors = [
        '[class*="ai-fit"]',
        '[class*="recommendation"]',
        '[class*="similar"]',
        '[id*="popup"]',
        '[class*="modal"]',
        '[class*="overlay"]',
        '[id="onetrust-banner-sdk"]',
        '.cookie-settings-banner'
      ];

      selectors.forEach(selector => {
        try {
          document.querySelectorAll(selector).forEach(el => el.remove());
        } catch (e) { }
      });
    });
  } catch (error) {
    // Ігнор помилок
  }
}

async function applyStealthScripts(context) {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['uk-UA', 'uk', 'en-US', 'en'] });
    window.chrome = {
      runtime: {},
      loadTimes: function () { },
      csi: function () { },
      app: {}
    };
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) => (
      parameters.name === 'notifications' ?
        Promise.resolve({ state: Notification.permission }) :
        originalQuery(parameters)
    );
  });
}
