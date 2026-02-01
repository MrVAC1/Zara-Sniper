import { initBrowser, closeBrowser } from './src/services/browser.js';
import path from 'path';
import os from 'os';
import fs from 'fs';

const TEST_PROFILE = path.join(os.tmpdir(), 'zara_fingerprint_test_' + Date.now());

async function test() {
  try {
    console.log('🧪 Testing Fingerprint Generation...');
    if (!fs.existsSync(TEST_PROFILE)) fs.mkdirSync(TEST_PROFILE);

    const context = await initBrowser(TEST_PROFILE);
    const page = await context.newPage();

    console.log('✅ Browser launched.');

    // Verify User Agent
    const ua = await page.evaluate(() => navigator.userAgent);
    console.log(`📱 User Agent: ${ua}`);

    if (ua.includes('Headless')) {
      throw new Error('User Agent contains "Headless" - Stealth failed!');
    }

    const platform = await page.evaluate(() => navigator.platform);
    console.log(`💻 Platform: ${platform}`);

    await page.close();
    await closeBrowser();

    // Cleanup
    try {
      fs.rmSync(TEST_PROFILE, { recursive: true, force: true });
    } catch (e) { }

    console.log('🎉 Verification PASSED');
    process.exit(0);
  } catch (error) {
    console.error('❌ Verification FAILED:', error);
    process.exit(1);
  }
}

test();
