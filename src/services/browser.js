import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';

dotenv.config();

// Initialize require for JSON import compatibility
const require = createRequire(import.meta.url);

// Configure Stealth Plugin
const stealth = StealthPlugin();
chromium.use(stealth);

let globalContext = null;
let isInitializing = false;

const IS_MAC = process.platform === 'darwin';

// User Agent based on OS
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
  '--use-fake-ui-for-media-stream'
];

/**
 * Validates Environment for Legacy macOS
 */
function validateEnvironment() {
  if (process.platform !== 'darwin') return;

  const release = os.release();
  const majorVersion = parseInt(release.split('.')[0], 10);

  // macOS 12 (Monterey) corresponds to Darwin 21.0.0
  // macOS 11 (Big Sur) is Darwin 20.0.0
  // Anything < 21 is considered "Legacy" in this context
  const isLegacyMacOS = majorVersion < 21;

  if (isLegacyMacOS) {
    console.log(`[System] Detected Legacy macOS (Darwin ${majorVersion}). Verifying Playwright compatibility...`);

    try {
      // Check installed Playwright version
      const pwPackage = require('playwright/package.json');
      const version = pwPackage.version;

      // Allow 1.35.x as the last safe version
      // 1.35.0 is the main target, but 1.35.1 might exist.
      // We check if it starts with '1.35.' or is lower than 1.36
      // Simple check: strict equality or semantic comparison

      const [major, minor] = version.split('.').map(Number);

      // If version is newer than 1.35.x (e.g. 1.36+ or 2.x)
      if (major > 1 || (major === 1 && minor > 35)) {
        console.error(`\n❌ [CRITICAL ERROR] Incompatible Playwright version for macOS 11 (Big Sur)`);
        console.error(`   Current version: ${version}`);
        console.error(`   Required version: 1.35.0`);
        console.error(`\n👉 Please run the following commands to fix:`);
        console.error(`   npm install playwright@1.35.0`);
        console.error(`   npx playwright install chromium`);
        console.error(`\n   Newer Chromium versions rely on system libraries missing in your OS.\n`);
        throw new Error('Playwright version incompatible with Legacy macOS');
      }

      console.log(`[System] ✅ Environment passed: macOS (Legacy) + Playwright ${version}`);
    } catch (e) {
      if (e.message.includes('Incompatible')) throw e;
      console.warn(`[System] ⚠️ Could not verify Playwright version: ${e.message}`);
    }
  }
}

let lastUserDataDir = null;

/**
 * Initialize Browser with Persistent Context (Singleton)
 * @param {string} userDataDir - Path to the user data directory (REQUIRED)
 */
export async function initBrowser(userDataDir) {
  // Validate Environment first
  validateEnvironment();

  // FIX: Support re-init using last known path
  if (!userDataDir && lastUserDataDir) {
    console.log(`[Init] Resuming with last known profile: ${lastUserDataDir}`);
    userDataDir = lastUserDataDir;
  } else if (userDataDir) {
    lastUserDataDir = userDataDir;
  }

  if (!userDataDir) {
    throw new Error('initBrowser requires userDataDir argument (or previous init)');
  }

  // If context exists and healthy, return it
  if (globalContext && isContextHealthy()) {
    return globalContext;
  }

  // Prevent double initialization
  if (isInitializing) {
    console.log('🔄 Browser is already initializing, waiting...');
    while (isInitializing) {
      await new Promise(r => setTimeout(r, 500));
      if (globalContext && isContextHealthy()) return globalContext;
    }
  }

  isInitializing = true;

  try {
    // Determine Executable Path
    // Pure Playwright Chromium (no system chrome)
    // By default, playwright-extra uses the bundled chromium if 'channel' is not specified
    // and executablePath is not set.

    // Close existing dead context
    if (globalContext) {
      try { await globalContext.close(); } catch (e) { }
      globalContext = null;
    }

    // Handle Singleton Lock (Windows/Chromium glitches)
    const lockFile = path.join(userDataDir, 'SingletonLock');
    if (fs.existsSync(lockFile)) {
      try {
        // Wait a bit
        await new Promise(r => setTimeout(r, 1000));
        if (fs.existsSync(lockFile)) {
          fs.unlinkSync(lockFile);
          console.log('🧹 SingletonLock removed forcibly.');
        }
      } catch (e) {
        console.warn('⚠️ Could not remove SingletonLock:', e.message);
      }
    }

    console.log(`[Init] Launching Browser (Chromium Bundled)...`);
    console.log(`[Profile] ${userDataDir}`);

    globalContext = await chromium.launchPersistentContext(userDataDir, {
      headless: process.env.HEADLESS === 'true',
      viewport: null,
      ignoreDefaultArgs: ['--enable-automation'],
      args: LAUNCH_ARGS,
      userAgent: USER_AGENT,
      locale: 'uk-UA',
      timezoneId: 'Europe/Kyiv',
      // Strict isolation: Do not use system Chrome
      channel: undefined,
      executablePath: undefined
    });

    // Default Timeouts
    globalContext.setDefaultTimeout(30000);
    globalContext.setDefaultNavigationTimeout(60000);

    console.log(`[Stealth] Using native device characteristics (Fingerprint injection disabled)`);

    // Apply Stealth Scripts
    await applyStealthScripts(globalContext);

    // --- GHOST PAGE CLEANER ---
    globalContext.on('page', async (page) => {
      try {
        await new Promise(r => setTimeout(r, 3000));
        if (page.isClosed()) return;

        const url = page.url();
        if (url === 'about:blank' || url === 'data:,') {
          console.log('[Cleaner] Closed empty tab (about:blank) to save resources.');
          await page.close().catch(() => { });
        }
      } catch (e) { }
    });
    // ---------------------------

    globalContext.on('close', () => {
      console.log('⚠️ Browser context closed!');
    });

    if (globalContext.browser()) {
      globalContext.browser().on('disconnected', () => {
        console.log('⚠️ Browser disconnected! Exiting...');
        process.exit(0);
      });
    }

    console.log('[Session] ✅ Browser initialized.');
    return globalContext;
  } catch (error) {
    console.error('❌ Browser Initialization Error:', error);
    globalContext = null;
    throw error;
  } finally {
    isInitializing = false;
  }
}

/**
 * Check Context Health
 */
function isContextHealthy() {
  if (!globalContext) return false;
  try {
    if (globalContext.browser && !globalContext.browser().isConnected()) return false;
    globalContext.pages();
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Get Current Instance (or init new)
 * Note: If init is needed, index.js relies on passing userDataDir.
 * If called without args when no context exists, it will fail safely in initBrowser.
 */
export async function getBrowser() {
  if (globalContext && isContextHealthy()) {
    return globalContext;
  }

  // FIX: Wait a bit if browser is initializing or just slightly delayed
  // Try 6 times x 500ms = 3 seconds
  console.log('[getBrowser] Context missing. Waiting for initialization...');
  for (let i = 0; i < 6; i++) {
    if (globalContext && isContextHealthy()) {
      return globalContext;
    }
    await new Promise(r => setTimeout(r, 500));
  }

  // If we don't have a context after waiting
  console.warn('⚠️ getBrowser called but context is missing. Returning null.');
  return null;
}

export async function closeBrowser() {
  if (globalContext) {
    await globalContext.close();
    globalContext = null;
    console.log('🔌 Browser closed');
  }
}

/**
 * Auto-Cleanup Tabs
 */
export function startAutoCleanup(context, activePages) {
  console.log('[Cleaner] Auto-cleanup activated (every 10 min)');

  setInterval(async () => {
    try {
      console.log('[Cleaner] Running periodic tab cleanup...');
      const pages = context.pages();

      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        try {
          if (page.isClosed()) continue;

          // PROTECT STARTUP TAB (Main Page)
          // Usually the first tab (index 0) is the persistent home page.
          if (i === 0) continue;

          // SAFEGUARD: Don't close if it's the LAST tab
          if (context.pages().length <= 1) {
            console.warn('[Cleaner] Skip closing last tab to preserve context.');
            continue;
          }

          const url = page.url();
          const isBlank = url === 'about:blank' || url === 'data:,' || url === '';

          let isAssociated = false;
          if (activePages) {
            for (const [taskId, activePage] of activePages.entries()) {
              if (activePage === page) {
                isAssociated = true;
                break;
              }
            }
          }

          if (!isAssociated && isBlank) {
            console.log(`[Cleaner] Closing inactive tab: ${url || 'empty'}`);
            await page.close().catch(() => { });
          }
        } catch (e) { }
      }
    } catch (e) {
      console.error('[Cleaner] Cleanup error:', e.message);
    }
  }, 10 * 60 * 1000);
}

/**
 * Create Task Page
 */
export async function createTaskPage(taskId) {
  const context = await getBrowser();
  if (!context) throw new Error('Browser not initialized');

  const page = await context.newPage();

  await page.setExtraHTTPHeaders({
    'Accept-Language': 'uk-UA,uk;q=0.9,en-US;q=0.8,en;q=0.7'
  });

  return page;
}

/**
 * Inject Regional Cookies
 */
export async function injectRegionalCookies(context, url) {
  if (!url) return;

  try {
    const domain = new URL(url).hostname;
    const cleanDomain = domain.replace('www.', '');

    let storeId = '11767'; // Default UA
    if (domain.includes('zara.com/es')) storeId = '10701';
    if (domain.includes('zara.com/pl')) storeId = '10659';
    if (domain.includes('zara.com/de')) storeId = '10500';

    const cookies = [
      {
        name: 'CookiesConsent',
        value: 'C0001%3BC0002%3BC0003%3BC0004',
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
    console.log(`[Cookies] Injected regional cookies for ${cleanDomain}`);
  } catch (e) {
    console.warn(`[Cookies] Injection error: ${e.message}`);
  }
}

/**
 * Login Session Mode
 * @param {string} userDataDir - Path to profile (REQUIRED)
 */
export async function startLoginSession(userDataDir) {
  // Check Env
  validateEnvironment();

  if (!userDataDir) {
    throw new Error('startLoginSession requires userDataDir');
  }

  await closeBrowser();

  try {
    console.log('\n🔑 [Login Mode] Starting session for authorization...');
    console.log('--------------------------------------------------');
    console.log('📝 INSTRUCTIONS:');
    console.log('1. Login to your Zara account in the opened browser.');
    console.log('2. Complete CAPTCHA or Email/SMS verification if needed.');
    console.log('3. AFTER successful login — simply CLOSE the browser window.');
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
    page.setDefaultNavigationTimeout(0);
    page.setDefaultTimeout(0);

    console.log('🌐 Navigating to ID page...');
    await page.goto('https://www.zara.com/ua/uk/identification', { waitUntil: 'domcontentloaded' })
      .catch(() => page.goto('https://www.zara.com/ua/uk/', { waitUntil: 'domcontentloaded' }));

    await new Promise((resolve) => {
      context.on('close', resolve);
      context.on('page', (p) => {
        p.on('close', () => {
          if (context.pages().length === 0) resolve();
        });
      });
    });

    try {
      const cookies = await context.cookies();
      const sessionCookie = cookies.find(c => c.name === 'Z_SESSION_ID' || c.name === 'itx-v-ev');
      console.log(`\n✅ Session ended. Cookies retrieved: ${cookies.length}`);
      if (sessionCookie) {
        console.log(`📡 Active session detected: ${sessionCookie.name} (Protected)`);
      } else {
        console.warn('⚠️ Warning: Main session cookie not found. Ensure you logged in.');
      }
    } catch (e) { }

    await context.close().catch(() => { });
    console.log('🚪 Browser closed. Profile updated.');
  } catch (error) {
    console.error('❌ Login Mode Error:', error);
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
    console.error('❌ Screenshot error:', error.message);
    return null;
  }
}

export async function closeAlerts(page) {
  try {
    if (page.isClosed()) return;

    const selectors = [
      '[data-qa-id="zds-alert-dialog-cancel-button"]',
      '[data-testid="dialog-close-button"]',
      'button[aria-label="Close"]',
      '#onetrust-accept-btn-handler',
      '#onetrust-reject-all-handler',
      '.cookie-settings-banner button',
      'button:has-text("Stay on this site")',
      'button:has-text("Залишитися на цьому сайті")',
      'button:has-text("Kontynuuj na tej stronie")',
      'button:has-text("Auf dieser Website bleiben")',
      'button:has-text("Continuar en España")',
      '[class*="market-selector"] button',
      '[data-qa-action="market-selector-close"]',
      '[class*="layout-header-links-modal"] button:first-child'
    ];

    for (const selector of selectors) {
      try {
        const element = await page.$(selector);
        if (element && await element.isVisible()) {
          console.log(`[Alert] Found popup (${selector}), closing...`);
          await element.click();
          await new Promise(r => setTimeout(r, 500));
        }
      } catch (e) { }
    }
  } catch (error) { }
}

export async function removeUIObstacles(page) {
  try {
    if (page.isClosed()) return;
    await closeAlerts(page);

    try {
      const stayOnSiteSelectors = [
        'button:has-text("Stay on this site")',
        'button:has-text("Залишитися на цьому сайті")',
        '[class*="layout-header-links-modal"] button:first-child',
        '[data-qa-action="stay-on-site"]'
      ];
      for (const selector of stayOnSiteSelectors) {
        const btn = await page.$(selector);
        if (btn && await btn.isVisible()) {
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
  } catch (error) { }
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
