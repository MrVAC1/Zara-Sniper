
import { getBrowser } from '../services/browser.js';
import { saveSession } from '../services/session.js';
import { reportError } from '../services/logService.js';
import User from '../models/User.js';

/**
 * Handle /login command
 * Usage: /login email@example.com mypassword
 */
export async function handleLogin(ctx) {
  const userId = ctx.from.id;
  const parts = ctx.message.text.split(' ');

  if (parts.length < 3) {
    return ctx.reply('⚠️ Формат команди: /login email@example.com пароль');
  }

  const email = parts[1].trim();
  const password = parts.slice(2).join(' ').trim(); // Password might contain spaces

  await ctx.reply('🔐 Починаю процес входу...\nЦе займе близько 30-45 секунд. Будь ласка, зачекайте.');

  let page = null;
  try {
    const { globalContext } = await getBrowser();
    if (!globalContext) {
      return ctx.reply('❌ Браузер не ініціалізовано. Спробуйте через хвилину.');
    }

    page = await globalContext.newPage();

    // 1. Navigate to Login Page
    await ctx.reply('🔄 Переходжу на сторінку входу...');
    await page.goto('https://www.zara.com/ua/uk/logon', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise(r => setTimeout(r, 3000)); // Anti-bot pause

    // 2. Email Step
    const emailInput = await page.waitForSelector('[data-qa-input-qualifier="logonId"]', { visible: true, timeout: 15000 });
    if (!emailInput) throw new Error('Email input not found (Akamai?)');

    await emailInput.fill(email);
    await new Promise(r => setTimeout(r, 1000));

    // Click Submit (Check specific button)
    await page.click('[data-qa-id="logon-form-submit"]');

    // Wait for Password Link or Password Input
    await ctx.reply('📧 Email введено. Перемикаюсь на пароль...');
    await new Promise(r => setTimeout(r, 3000));

    // Send debug screenshot
    const shot1 = await page.screenshot({ type: 'jpeg', quality: 60 });
    await ctx.replyWithPhoto({ source: shot1 }, { caption: 'Debug: Post-Email Step' });

    // 3. Switch to Password (if link exists)
    try {
      // Sometimes Zara asks for password immediately, sometimes link.
      // Selector for link: a[href*="/login/password"] or similar
      const passwordLink = await page.$('a[href*="/login/password"]');
      if (passwordLink) {
        await passwordLink.click();
        await new Promise(r => setTimeout(r, 2000));
      }
    } catch (e) {
      console.log('No password link found, checking input directly.');
    }

    // 4. Password Step
    const passwordInput = await page.waitForSelector('[data-qa-input-qualifier="password"]', { visible: true, timeout: 15000 });
    if (!passwordInput) throw new Error('Password input not found');

    await passwordInput.fill(password);
    await new Promise(r => setTimeout(r, 1000));

    await page.click('[data-qa-id="logon-form-submit"]');
    await ctx.reply('🔑 Пароль введено. Очікую вхід...');

    // 5. Finalize - Wait for success element
    // "My Account" or similar. Or just wait for URL change to home.
    try {
      await page.waitForNavigation({ timeout: 15000, waitUntil: 'domcontentloaded' }).catch(() => { });
      // Check specific element usually found on logged in header? 
      // Or check cookies immediately
    } catch (e) { }

    await new Promise(r => setTimeout(r, 5000)); // Final settle

    // 6. Save Valid Session
    await saveSession(globalContext);

    // Final Screenshot
    const finalShot = await page.screenshot({ type: 'jpeg', quality: 70 });
    await ctx.replyWithPhoto({ source: finalShot }, { caption: '✅ Вхід виконано (сподіваюсь). Сесію збережено.' });

    await page.close();

  } catch (error) {
    console.error('Login Error:', error);
    await ctx.reply(`❌ Помилка входу: ${error.message}`);

    if (page && !page.isClosed()) {
      await reportError(page, error, 'Manual Login Command');
      await page.close();
    }
  }
}
