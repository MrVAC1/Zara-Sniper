import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';
import { proxyManager } from './proxyManager.js';
import { loadSession, saveSession, saveSessionData } from './session.js';
import { reportError } from './logService.js';
import { Semaphore } from '../utils/botUtils.js';
import sessionLogger from './sessionLogger.js';
import { attachNetworkRouter, setFingerprint } from './networkRouter.js';

dotenv.config();

// Initialize require for JSON import compatibility
const require = createRequire(import.meta.url);

// Configure Stealth Plugin
const stealth = StealthPlugin();
chromium.use(stealth);

// Global Browser Context
let globalContext = null;
let isInitializing = false;
const initLock = new Semaphore(1);

// Getter to retrieve the *current* runtime context
export const getContext = () => globalContext;

const IS_MAC = process.platform === 'darwin';
const IS_DOCKER = process.env.IS_DOCKER === 'true' || process.env.K_SERVICE; // Detects Docker or K8s/HF

// Randomized User Agents
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

export const getRandomUserAgent = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
export const USER_AGENT = getRandomUserAgent();

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-blink-features=AutomationControlled',
  '--disable-infobars',
  '--start-maximized',
  '--disable-web-security',
  '--disable-features=IsolateOrigins,site-per-process',
  '--disable-site-isolation-trials',
  '--use-fake-ui-for-media-stream',
  '--ignore-certificate-errors',
  '--disable-gpu',
  '--enforce-webrtc-ip-permission-check',  // WebRTC IP leak protection
  '--disable-webrtc-hw-encoding',
  '--disable-webrtc-hw-decoding'
];

const KEEPER_URL = 'https://www.zara.com/ua/uk/';

if (IS_DOCKER) {
  LAUNCH_ARGS.push(
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--no-zygote'
  );
  console.log('[System] Docker environment detected. Applying optimized args.');
}

/**
 * Validates Environment for Legacy macOS
 */
function validateEnvironment() {
  if (IS_DOCKER) return; // Skip OS checks in Docker
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
        console.error(`\n❌ [CRITICAL ERROR] Legacy macOS (v11/Big Sur or older) detected.`);
        console.error(`   You have Playwright v${version} installed, which is NOT compatible with your OS.`);
        console.error(`   Newer Playwright versions require macOS 12+ due to Chromium dependencies.`);
        console.error(`\n👉 AUTOMATIC FIX REQUIRED:`);
        console.error(`   You must manually downgrade Playwright to continue:`);
        console.error(`   npm install playwright@1.35.0`);
        console.error(`\n   After running this command, restart the bot.\n`);
        throw new Error('Playwright version incompatible with Legacy macOS');
      }

      console.log(`[System] ✅ Environment passed: macOS (Legacy) + Playwright ${version}`);
    } catch (e) {
      if (e.message.includes('Incompatible')) throw e;
      console.warn(`[System] ⚠️ Could not verify Playwright version: ${e.message}`);
    }
  }
}

// Default Profile Path (Platform Agnostic)
export const USER_DATA_DIR = path.join(os.homedir(), '.zara_box_profile');

/**
 * Initialize Playwright Browser Context with Persistent Profile
 * @param {string} userDataDir - Path to the user data directory (Optional, defaults to standard path)
 */
export async function initBrowser(userDataDir = USER_DATA_DIR) {
  // Validate Environment first
  validateEnvironment();

  if (!userDataDir) {
    throw new Error('initBrowser requires userDataDir argument');
  }

  // Hard Lock: Multiple tasks shouldn't initialize at once
  await initLock.acquire();

  try {
    // If context exists and healthy, return it 
    if (globalContext && isContextHealthy()) {
      return globalContext;
    }

    isInitializing = true;
    console.log('🔄 [Init] Hard Lock acquired. Starting browser initialization...');

    // 1. Handle Singleton Lock (Windows/Chromium glitches)
    const lockFile = path.join(userDataDir, 'SingletonLock');
    if (fs.existsSync(lockFile)) {
      console.log('🧹 SingletonLock detected. Attempting removal...');
      for (let i = 0; i < 3; i++) {
        try {
          if (fs.existsSync(lockFile)) {
            fs.unlinkSync(lockFile);
            console.log(`[Init] ✅ SingletonLock removed (Attempt ${i + 1}).`);
            break;
          }
        } catch (e) {
          console.warn(`[Init] ⚠️ SingletonLock busy (Attempt ${i + 1}): ${e.message}`);
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }

    console.log(`[Init] Launching Browser (Chromium Bundled)...`);
    console.log(`[Profile] ${userDataDir}`);

    // Fallback to ProxyManager if no config provided
    // if (!proxyConfig) {
    //   proxyConfig = proxyManager.getPlaywrightProxy();
    // }

    // Load session from MongoDB (if exists) -> temp file
    const sessionFilePath = await loadSession();
    if (sessionFilePath) {
      const stats = fs.statSync(sessionFilePath);
      console.log(`[Session] Restoring session from: ${sessionFilePath} (Size: ${stats.size} bytes)`);
    } else {
      console.log(`[Session] No saved session found. Starting fresh.`);
    }

    // Fix for "proxy: expected object, got null"
    const launchOptions = {
      headless: IS_DOCKER ? true : process.env.HEADLESS === 'true',
      viewport: null,
      ignoreHTTPSErrors: true, // Allow proxy SSL certificates
      ignoreDefaultArgs: ['--enable-automation'],
      args: LAUNCH_ARGS,
      userAgent: USER_AGENT,
      locale: 'uk-UA',
      timezoneId: 'Europe/Kyiv',
      channel: undefined,
      executablePath: undefined,
      proxy: undefined,  // Will be set below based on proxyManager
      storageState: sessionFilePath || undefined // Inject loaded session
    };

    // --- FULL PROXY MODE ---
    // Browser uses proxy for ALL requests (auth, browsing, checkout)
    // This ensures consistent IP throughout the session to avoid Akamai suspicion
    const proxyConfig = proxyManager.getNextProxy();

    if (proxyConfig) {
      console.log(`[Init] 🛡️ FULL PROXY MODE: ${proxyConfig.masked}`);
      launchOptions.proxy = {
        server: proxyConfig.server,
        username: proxyConfig.username,
        password: proxyConfig.password
      };
    } else {
      // Fallback: Check legacy Bright Data ENV vars
      const bdUser = process.env.BRIGHTDATA_USER;
      const bdPass = process.env.BRIGHTDATA_PASSWORD;

      if (bdUser && bdPass) {
        const bdServer = process.env.BRIGHTDATA_PROXY_URL || 'http://brd.superproxy.io:33335';
        console.log(`[Init] 🛡️ Using legacy Bright Data: ${bdServer}`);
        launchOptions.proxy = {
          server: bdServer,
          username: bdUser,
          password: bdPass
        };
      } else {
        console.log(`[Init] ⚠️ No proxies configured. Using direct connection (NOT RECOMMENDED).`);
      }
    }

    // PERSISTENCE FIX: Do NOT wipe userDataDir. Playwright needs it.
    if (sessionFilePath && fs.existsSync(userDataDir)) {
      console.log('[Session] ℹ️ Injecting DB session into existing persistent profile...');
    }

    console.group('[Browser Init]');
    if (launchOptions.proxy) {
      console.log(`[Network] Browser: FULL PROXY MODE (all requests)`);
      console.log(`[Network] Proxy: ${proxyConfig?.masked || 'Bright Data Legacy'}`);
    } else {
      console.log(`[Network] Browser: Direct Connection (Host IP)`);
    }

    // Force IPv4 if not already set globally (Safety net for container)
    try {
      const dns = await import('node:dns');
      if (dns.setDefaultResultOrder) dns.setDefaultResultOrder('ipv4first');
    } catch (e) { }

    globalContext = await chromium.launchPersistentContext(userDataDir, launchOptions);

    // --- COST OPTIMIZATION: Resource Blocking (DISABLED via REQUEST) ---
    // await globalContext.route('**/*', route => {
    //   const type = route.request().resourceType();
    //   if (['image', 'media', 'font', 'stylesheet'].includes(type)) {
    //     // console.log(`[Optim] Blocked resource: ${type}`);
    //     return route.abort();
    //   }
    //   return route.continue();
    // });
    // console.log('[Init] 📉 Resource Blocker Activated (Images, Media, Fonts, Stylesheets)');
    console.log('[Init] 🎨 Resource Blocker DISABLED - Full Site Loading Enabled');

    console.groupEnd();

    // Default Timeouts
    globalContext.setDefaultTimeout(30000);
    globalContext.setDefaultNavigationTimeout(60000);

    // --- KEEPER TAB INITIALIZATION ---
    // Ensure one tab is always open (Keeper) to prevent browser closure
    const pages = globalContext.pages();
    let keeperPage = null;

    // Check if we already have a keeper (e.g. from session restore or previous run)
    for (const p of pages) {
      if (p.url().includes('zara.com/ua/uk') && !p.isClosed()) {
        keeperPage = p;
        break;
      }
    }

    if (!keeperPage) {
      console.log(`[Init] 🛡️ Opening Keeper Tab (${KEEPER_URL})...`);
      keeperPage = await globalContext.newPage();
      // Don't await goto strictly to avoid blocking init if it's slow
      keeperPage.goto(KEEPER_URL, { waitUntil: 'domcontentloaded' }).catch(e => console.warn('[Keeper] Load warning:', e.message));
    } else {
      console.log('[Init] 🛡️ Keeper Tab already exists.');
    }
    // ---------------------------------

    // --- LAZY COOKIE VERIFICATION ---
    try {
      // Use the keeper page for verification instead of a new one to save resources?
      // Or stick to current logic. Current logic creates new page.
      const page = await globalContext.newPage();

      // Wake up context
      console.log('🌐 [Session] Warming up context: Navigating to Zara...');
      try {
        await page.goto('https://www.zara.com/ua/uk/', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, 1000)); // Wait for hydration [OPTIMIZED: was 2000]
        await handleStoreRedirect(page); // Handle modal after warmup navigation
      } catch (navErr) {
        console.warn(`[Session] Warm-up navigation failed: ${navErr.message}`);
      }

      // Check cookies
      const cookies = await globalContext.cookies();
      const sessionCookie = cookies.find(c => c.name === 'Z_SESSION_ID' || c.name === 'itx-v-ev');

      console.group('[Session Verification]');
      console.log(`🍪 Total Cookies: ${cookies.length}`);

      if (cookies.length > 0) {
        const sample = cookies.slice(0, 3).map(c => c.name).join(', ');
        console.log(`🍪 Sample: ${sample}...`);
      }

      if (sessionCookie) {
        console.log(`✅ Active Session: ${sessionCookie.name} (Value: ${sessionCookie.value.substring(0, 10)}...)`);
      } else {
        console.error(`⚠️ NO Active Session Cookie found!`);

        // Critical Failure Report
        const proxyIP = 'Direct/Host'; // Or fetch from checker
        const userAgent = await page.evaluate(() => navigator.userAgent);

        await reportError(page, new Error(`Session Restore Failed: 0 Cookies loaded. UA: ${userAgent}`), `Session Init (IP: ${proxyIP})`);
      }
      console.groupEnd();

      await page.close();
    } catch (e) {
      console.warn('[Session] Verification error:', e.message);
    }

    // --- VERIFICATION STEP ---
    try {
      const page = await globalContext.newPage();
      console.log('[Verification] Checking Browser IP via Bright Data...');

      try {
        await page.goto('https://api.ipify.org', { waitUntil: 'domcontentloaded', timeout: 15000 });
      } catch (e) {
        if (e.message.includes('407')) {
          console.error('❌ [CRITICAL] Proxy Authentication Failed (407). Check BRIGHTDATA_USER / BRIGHTDATA_PASSWORD.');
          throw e;
        }
        throw e;
      }

      const content = await page.content();
      const ipMatch = content.match(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/);
      if (ipMatch) {
        console.log(`[Verification] 🌍 Browser IP (Bright Data): ${ipMatch[0]}`);
      } else {
        console.warn('[Verification] ⚠️ Could not determine IP.');
      }
      await page.close();
    } catch (e) {
      console.warn(`[Verification] Failed to check IP: ${e.message}`);
    }
    // -------------------------

    // Default Timeouts
    globalContext.setDefaultTimeout(30000);
    globalContext.setDefaultNavigationTimeout(60000);

    console.log(`[Stealth] Initializing fingerprint generation...`);

    // --- FINGERPRINT GENERATION LOGIC ---
    const { FingerprintGenerator } = await import('fingerprint-generator');
    const { FingerprintInjector } = await import('fingerprint-injector');

    const fingerprintGenerator = new FingerprintGenerator();
    const fingerprintInjector = new FingerprintInjector();

    let fingerprint;
    try {
      fingerprint = fingerprintGenerator.getFingerprint({
        devices: ['desktop'],
        operatingSystems: ['windows'],
        browsers: [{ name: 'chrome', minVersion: 115 }], // Target modern Chrome
      });

      // safeRetries is internal to the generator logic mostly, but we validate the output here directly.
      const fpData = fingerprint ? fingerprint.fingerprint : null;
      if (!fpData || (!fpData.userAgent && (!fpData.navigator || !fpData.navigator.userAgent))) {
        throw new Error('Generated fingerprint is invalid or empty');
      }

      const finalUA = fpData.userAgent || fpData.navigator.userAgent;
      console.log(`[Stealth] Fingerprint generated: ${finalUA.substring(0, 50)}...`);
    } catch (err) {
      console.warn(`[Stealth] ⚠️ Fingerprint generation failed: ${err.message}`);
      console.log(`[Stealth] Using fallback User-Agent due to generation failure`);

      // Fallback
      fingerprint = {
        fingerprint: {
          userAgent: USER_AGENT,
          navigator: {
            userAgent: USER_AGENT,
            platform: IS_MAC ? 'MacIntel' : 'Win32',
            language: 'uk-UA,uk;q=0.9,en-US;q=0.8,en;q=0.7',
            hardwareConcurrency: 4,
            deviceMemory: 8
          },
          screen: {
            width: 1920,
            height: 1080,
            availWidth: 1920,
            availHeight: 1040,
            colorDepth: 24,
            pixelDepth: 24
          }
        },
        headers: {}
      };
    }

    // Inject the fingerprint (generated or fallback)
    try {
      await fingerprintInjector.attachFingerprintToPlaywright(globalContext, fingerprint);
      console.log('[Stealth] Fingerprint injected successfully.');
    } catch (fpError) {
      console.warn(`[Stealth] ⚠️ Failed to inject fingerprint (Browser closed?): ${fpError.message}`);
      // Proceed without fingerprint if critical failure, or re-throw if needed. 
      // If browser is closed, next steps will fail anyway.
      if (fpError.message.includes('closed') || fpError.message.includes('Target page')) {
        throw fpError; // Re-throw to trigger cleanup in catch block
      }
    }

    // --- CANVAS NOISE INJECTION (Anti-Fingerprinting) ---
    console.log('[Stealth] Injecting canvas noise...');
    await globalContext.addInitScript(() => {
      const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
      const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;

      HTMLCanvasElement.prototype.toDataURL = function (...args) {
        const ctx = this.getContext('2d');
        if (ctx) {
          const imageData = ctx.getImageData(0, 0, this.width, this.height);
          // Add tiny noise to prevent fingerprinting
          for (let i = 0; i < imageData.data.length; i += 4) {
            imageData.data[i] += Math.random() * 2 - 1;     // R
            imageData.data[i + 1] += Math.random() * 2 - 1; // G
            imageData.data[i + 2] += Math.random() * 2 - 1; // B
          }
          ctx.putImageData(imageData, 0, 0);
        }
        return originalToDataURL.apply(this, args);
      };

      // Also add noise to getImageData for WebGL fingerprinting
      CanvasRenderingContext2D.prototype.getImageData = function (...args) {
        const imageData = originalGetImageData.apply(this, args);
        for (let i = 0; i < imageData.data.length; i += 10) {
          imageData.data[i] += Math.random() * 2 - 1;
        }
        return imageData;
      };
    });

    // --- PERMISSION GRANTS (Appear More Human) ---
    try {
      await globalContext.grantPermissions(['notifications', 'geolocation'], {
        origin: 'https://www.zara.com'
      });
      console.log('[Stealth] Permissions granted for Zara domain.');
    } catch (permErr) {
      console.warn(`[Stealth] Permission grant failed: ${permErr.message}`);
    }
    // ------------------------------------

    // Apply Additional Stealth Scripts (Optional / Supplementary)
    await applyStealthScripts(globalContext);

    // --- NETWORK ROUTER INTEGRATION ---
    // Attach context-aware routing for checkout proxy
    setFingerprint(fingerprint);
    await attachNetworkRouter(globalContext, fingerprint);
    console.log('[Stealth] Network router attached for checkout proxy routing.');

    // --- GHOST PAGE CLEANER ---
    globalContext.on('page', async (page) => {
      try {
        await new Promise(r => setTimeout(r, 3000));
        if (page.isClosed()) return;

        const url = page.url();
        if (url === 'about:blank' || url === 'data:,') {
          console.log('[Cleaner] Closed empty tab (about:blank) to save resources.');
          await page.close().catch(() => { });
          return;
        }

        // --- STAY-IN-STORE BUTTON WATCHER ---
        // Continuously monitor for the "stay in store" modal and click it
        const stayInStoreWatcher = setInterval(async () => {
          try {
            if (page.isClosed()) {
              clearInterval(stayInStoreWatcher);
              return;
            }

            const stayBtn = await page.$('[data-qa-action="stay-in-store"]');
            if (stayBtn && await stayBtn.isVisible()) {
              console.log('[Browser] 📍 "Stay in Store" modal detected, clicking...');
              await stayBtn.click().catch(() => { });
              await new Promise(r => setTimeout(r, 500));
            }
          } catch (e) {
            // Page closed or other error - stop watching
            if (e.message.includes('closed') || e.message.includes('Target')) {
              clearInterval(stayInStoreWatcher);
            }
          }
        }, 2000); // Check every 2 seconds

        // Stop watcher when page closes
        page.on('close', () => {
          clearInterval(stayInStoreWatcher);
        });
        // ------------------------------------

      } catch (e) { }
    });
    // ---------------------------

    globalContext.on('close', () => {
      console.log('⚠️ Browser context closed!');
    });

    if (globalContext.browser()) {
      globalContext.browser().on('disconnected', () => {
        console.log('⚠️ Browser disconnected! Resetting global context...');
        globalContext = null;
      });
    }

    console.log('[Session] ✅ Browser initialized.');

    // Start session logging upon successful browser init (counters only, no rotation)
    sessionLogger.startNewSession(false);

    return globalContext;
  } catch (error) {
    // Append initialization failure to the current session log (if exists)
    sessionLogger.log('ERROR', { context: 'BROWSER_INIT', message: 'Browser Initialization Error' }, error);

    console.error('❌ Browser Initialization Error:', error);
    globalContext = null;
    throw error;
  } finally {
    isInitializing = false;
    initLock.release();
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
  // If we don't have a context, we can't auto-init without the path.
  // The app architecture should ensure initBrowser is called first in main().
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

      for (const page of pages) {
        try {
          if (page.isClosed()) continue;

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
            // CRITICAL FIX: DO NOT close tabs that might be loading/redirecting to Zara
            // Only close if it's strictly 'about:blank' or 'data:,' AND has no title/content

            // Explicitly SKIP any zara tab
            if (url.includes('zara.com')) {
              continue;
            }

            console.log(`[Cleaner] Closing blank/empty tab to save resources: ${url || 'about:blank'}`);
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
 * Attach Global Akamai 403 Detector to Page
 * Logs all Akamai blocks regardless of context (login, checkout, hunting)
 * AUTO-RESTART: Closes browser and restarts with new proxy on block
 */
export function attachAkamaiDetector(page, context = 'Unknown') {
  page.on('response', async (response) => {
    try {
      const status = response.status();
      const url = response.url();

      if ((status === 403 || status === 429 || status === 502) && url.includes('zara.com')) {
        console.error(`[Akamai Global] 🛡️ BLOCK DETECTED! Status: ${status}, Context: ${context}, URL: ${url}`);

        // Log to negative file
        sessionLogger.log('ERROR', {
          context: 'AKAMAI_GLOBAL_BLOCK',
          blockContext: context,
          status,
          url,
          message: `Akamai ${status} block detected in ${context}. URL: ${url}`
        });

        // Take screenshot if possible
        try {
          if (!page.isClosed()) {
            await page.screenshot({ type: 'png' }).catch(() => { });
          }
        } catch (e) { }

        // AUTO-ROTATION: Switch proxy on block and restart browser
        if (process.env.PROXY_ROTATION_ON_BLOCK === 'true') {
          const currentProxy = proxyManager.getCurrentProxy();

          if (currentProxy) {
            console.error(`[Akamai] 🔄 Rotating proxy due to ${status} block...`);
            proxyManager.markProxyBlocked(currentProxy.url);

            // Get next proxy
            const nextProxy = proxyManager.getNextProxy();
            if (nextProxy) {
              console.log(`[Akamai] ✅ Next proxy selected: ${nextProxy.masked}`);
              console.log(`[Akamai] 🔄 AUTO-RESTARTING browser with new proxy...`);

              // Set flag to prevent multiple restarts
              if (!globalContext._isRestarting) {
                globalContext._isRestarting = true;

                // Close browser and reinitialize with new proxy
                try {
                  // Close all pages first
                  const pages = globalContext.pages();
                  for (const p of pages) {
                    await p.close().catch(() => { });
                  }

                  // Close browser context
                  await globalContext.close().catch(() => { });
                  globalContext = null;

                  console.log(`[Akamai] 🔄 Browser closed. Reinitializing with new proxy...`);

                  // Reinitialize browser (will pick up the new proxy from proxyManager)
                  // The initBrowser function will be called by the watchdog or task system
                  // We set globalContext to null to trigger reinitialization
                } catch (restartErr) {
                  console.error(`[Akamai] ❌ Browser restart failed: ${restartErr.message}`);
                  globalContext = null;
                }
              }
            } else {
              console.error(`[Akamai] ❌ No healthy proxies available. Continuing with direct connection.`);
            }
          }
        }
      }
    } catch (e) {
      console.warn(`[Akamai Detector] Error: ${e.message}`);
    }
  });
}

/**
 * Create Task Page
 */
export async function createTaskPage(taskId) {
  const context = await getBrowser();
  if (!context) throw new Error('Browser not initialized');

  const page = await context.newPage();

  // Standard Viewport (Match Device)
  // Removed randomization to keep standard resolution as requested
  // await page.setViewportSize({ width: 1920, height: 1080 }); // Optional: Force standard FHD if needed, but 'null' in context is better

  // Enhanced Headers (Modern Chrome)
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'uk-UA,uk;q=0.9,en-US;q=0.8,en;q=0.7',
    'sec-ch-ua': '"Chromium";v="121", "Not A Brand";v="99"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'none',
    'upgrade-insecure-requests': '1'
  });

  // Attach global Akamai detector
  attachAkamaiDetector(page, `Task:${taskId}`);

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

// Safe Navigation (Direct Connection Mode)
export async function safeNavigate(page, url, options = {}) {
  const MAX_RETRIES = 5;
  let currentUrl = url;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 30000, ...options });
      return; // Success
    } catch (error) {
      console.warn(`[Navigate] Attempt ${attempt} failed: ${error.message}`);
      // Simple retry without proxy rotation
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, 2000));
      } else {
        throw error;
      }
    }
  }
}

export async function startLoginSession(userDataDir) {
  // Check Env
  validateEnvironment();

  if (!userDataDir) {
    throw new Error('startLoginSession requires userDataDir');
  }

  await closeBrowser();

  // Retry Loop for Session Start
  const MAX_SESSION_RETRIES = 10;
  for (let attempt = 0; attempt < MAX_SESSION_RETRIES; attempt++) {
    try {
      console.log('\n🔑 [Login Mode] Starting session for authorization...');
      console.log('--------------------------------------------------');
      console.log('📝 INSTRUCTIONS:');
      console.log('1. Login to your Zara account in the opened browser.');
      console.log('2. Complete CAPTCHA or Email/SMS verification if needed.');
      console.log('3. AFTER successful login — simply CLOSE the browser window.');
      console.log('--------------------------------------------------\n');

      // Direct Connection - No Protocol/Proxy Logic needed
      const launchOptions = {
        headless: false,
        viewport: null,
        ignoreDefaultArgs: ['--enable-automation'],
        args: LAUNCH_ARGS,
        userAgent: USER_AGENT,
        locale: 'uk-UA',
        timezoneId: 'Europe/Kyiv',
        proxy: undefined // Enforce Direct
      };

      console.log(`[Login] Using Direct Connection (Host IP)`);

      const context = await chromium.launchPersistentContext(userDataDir, launchOptions);

      await applyStealthScripts(context);

      const page = await context.newPage();
      page.setDefaultNavigationTimeout(0); // Long timeout for manual interaction
      page.setDefaultTimeout(0);

      console.log('🌐 Navigating to ID page...');

      // --- SAFE GOTO BLOCK ---
      try {
        await page.goto('https://www.zara.com/ua/uk/identification', { waitUntil: 'domcontentloaded', timeout: 30000 });
      } catch (navError) {
        console.warn(`[Login] Navigation error: ${navError.message}. Retrying...`);
        // Fallback to home if ID page fails
        try {
          await page.goto('https://www.zara.com/ua/uk/', { waitUntil: 'domcontentloaded' });
        } catch (e) { }
      }
      // -----------------------

      // --- LIVE SESSION POLLING ---
      // We poll the storage state while the browser is open to capture cookies before closure
      let lastValidState = null;
      const pollInterval = setInterval(async () => {
        try {
          if (context.pages().length > 0) {
            lastValidState = await context.storageState().catch(() => null);
          }
        } catch (e) { }
      }, 10000);

      await new Promise((resolve) => {
        context.on('close', resolve);
        context.on('page', (p) => {
          p.on('close', () => {
            if (context.pages().length === 0) resolve();
          });
        });
      });

      clearInterval(pollInterval);

      if (lastValidState) {
        console.log(`[Login Mode] ✅ Captured session state (Size: ${JSON.stringify(lastValidState).length} chars). Saving...`);
        try {
          await saveSessionData(lastValidState);
        } catch (e) {
          console.error('[Login Mode] DB Save Error:', e.message);
        }
      } else {
        console.error('[Login Mode] ❌ Failed to capture any session state before close.');
      }

      await context.close().catch(() => { });
      console.log('🚪 Browser closed. Profile updated.');
      return; // Success, exit loop

    } catch (error) {
      console.error('❌ Login Mode Error:', error);
      await new Promise(r => setTimeout(r, 3000));
    }
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

/**
 * Handles the "Stay in Store" redirect modal.
 * @param {import('playwright').Page} page
 */
export async function handleStoreRedirect(page) {
  try {
    if (page.isClosed()) return;
    const selector = '[data-qa-action="stay-in-store"]';
    const btn = await page.$(selector);
    if (btn && await btn.isVisible()) {
      console.log('[Browser] 📍 "Stay in Store" modal detected, clicking...');
      await btn.click().catch(() => { });
    }
  } catch (e) { }
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
        '[data-qa-action="stay-on-site"]',
        '[data-qa-action="stay-in-store"]'
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
  // StealthPlugin handles most overrides (webdriver, chrome runtime, etc.)
  // We only add specific localized overrides here
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'languages', { get: () => ['uk-UA', 'uk', 'en-US', 'en'] });

    // Permission override for notifications
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) => (
      parameters.name === 'notifications' ?
        Promise.resolve({ state: Notification.permission }) :
        originalQuery(parameters)
    );

    // --- LAYER 2: WebGL & Hardware Spoofing (For HF/Cloud) ---
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (parameter) {
      // Spoof Vendor
      if (parameter === 37445) {
        return 'Google Inc. (NVIDIA)';
      }
      // Spoof Renderer (Akamai Check) - Updated to GTX 1660 Ti
      if (parameter === 37446) {
        return 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Ti Direct3D11 vs_5_0 ps_5_0)';
      }
      return getParameter.apply(this, arguments);
    };

    // Mask Hardware - Windows Desktop Identity
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 }); // 8-core CPU
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 16 }); // 16GB RAM
    Object.defineProperty(navigator, 'platform', { get: () => 'Win32' }); // Windows Platform (MANDATORY)
    // ---------------------------------------------------------

    // --- LAYER 3: WebRTC IP Leak Prevention ---
    // Prevents real IP from leaking through WebRTC during proxy checkout phase
    const originalRTCPeerConnection = window.RTCPeerConnection;
    window.RTCPeerConnection = function (...args) {
      const config = args[0] || {};

      // Force ICE servers to be empty to prevent STUN/TURN IP discovery
      config.iceServers = [];

      // Create the connection with modified config
      const pc = new originalRTCPeerConnection(config);

      // Override createOffer to suppress ICE candidates
      const originalCreateOffer = pc.createOffer.bind(pc);
      pc.createOffer = async function (options) {
        const offer = await originalCreateOffer(options);
        // Remove candidate lines that may contain IP addresses
        if (offer && offer.sdp) {
          offer.sdp = offer.sdp.replace(/a=candidate:.+\r\n/g, '');
        }
        return offer;
      };

      return pc;
    };

    // Copy static properties
    if (originalRTCPeerConnection) {
      window.RTCPeerConnection.prototype = originalRTCPeerConnection.prototype;
      Object.keys(originalRTCPeerConnection).forEach(key => {
        window.RTCPeerConnection[key] = originalRTCPeerConnection[key];
      });
    }
    // -----------------------------------------
  });
}

/**
 * Kill lingering Chromium processes on Windows to prevent profile locking
 */
export async function cleanupBrowserProcesses() {
  if (process.platform !== 'win32') return;

  try {
    const { execSync } = require('child_process');
    console.log('[Init] 🧹 Cleaning up lingering Chromium processes...');
    // /F - force, /IM - image name, /T - tree (killer children)
    // We ignore error if no processes found (exit code 128)
    try {
      execSync('taskkill /F /IM chrome.exe /T 2>nul');
    } catch (e) { }
    try {
      execSync('taskkill /F /IM chromium.exe /T 2>nul');
    } catch (e) { }

    // Give OS time to release file handles
    await new Promise(r => setTimeout(r, 1000));
  } catch (err) {
    console.warn(`[Init] ⚠️ Process cleanup warning: ${err.message}`);
  }
}
