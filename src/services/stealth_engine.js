/**
 * Stealth Engine v3 - Complete Anti-Fingerprinting Module
 * Targets: CreepJS Stealth 0%, Headless 0%, WebDriver hidden
 * 
 * v3 Fixes:
 * 1. Deeper webdriver removal (Chromium internal)
 * 2. Proper chrome.runtime with csi and loadTimes
 * 3. WebGL parameter alignment
 */

// ============================================================
// STEALTH PAYLOAD v3
// ============================================================

// ============================================================
// LAUNCH ARGUMENTS
// ============================================================

import path from 'path';

// Resolve extension path
const EXTENSION_PATH = path.resolve(process.cwd(), 'src', 'stealth-extension');

export const STEALTH_PAYLOAD = ''; // Deprecated: Now using extension
// 2. Launch Arguments
export const STEALTH_LAUNCH_ARGS = [
  '--disable-blink-features=AutomationControlled', // Critical for webdriver detection
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--enable-webgl',
  '--enable-webgl2',
  '--ignore-gpu-blocklist',
  '--use-angle=gl',                 // Use ANGLE with GL backend (allows parameter spoofing)
  '--enable-accelerated-2d-canvas',
  '--enable-gpu-rasterization',
  '--disable-features=IsolateOrigins,site-per-process',
  // Additional stealth
  '--disable-background-networking',
  '--mute-audio',
  '--no-first-run',
  '--window-size=1920,1040',        // Force Window Size (with frame)
  '--force-device-scale-factor=1',  // Force 100% Scale
  // Extension Loading (v4)
  `--disable-extensions-except=${path.resolve(process.cwd(), 'src', 'stealth-extension')}`,
  `--load-extension=${path.resolve(process.cwd(), 'src', 'stealth-extension')}`
];

// ============================================================
// CONTEXT OPTIONS
// ============================================================

export const STEALTH_CONTEXT_OPTIONS = {
  viewport: { width: 1920, height: 1080 },
  screen: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  colorScheme: 'light',
  locale: 'uk-UA',
  timezoneId: 'Europe/Kyiv',
  ignoreHTTPSErrors: true,
  ignoreDefaultArgs: ['--enable-automation']
};

/**
 * Verify stealth on a page
 */
export async function verifyGPU(page) {
  try {
    const result = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) return { error: 'WebGL not available' };

      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');

      return {
        vendor: debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : 'N/A',
        renderer: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : 'N/A',
        webdriver: navigator.webdriver,
        hardwareConcurrency: navigator.hardwareConcurrency,
        deviceMemory: navigator.deviceMemory,
        colorDepth: screen.colorDepth,
        platform: navigator.platform,
        chromeRuntime: typeof chrome !== 'undefined' && typeof chrome.runtime !== 'undefined',
        chromeCsi: typeof chrome !== 'undefined' && typeof chrome.csi === 'function',
        chromeLoadTimes: typeof chrome !== 'undefined' && typeof chrome.loadTimes === 'function'
      };
    });
    return result;
  } catch (e) {
    return { error: e.message };
  }
}
