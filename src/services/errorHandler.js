import User from '../models/User.js';
import { getTimeConfig } from '../utils/timeUtils.js';

const { DELAY_CAPTCHA_SOLVE } = getTimeConfig();

/**
 * Перевірка авторизації сесії
 */
export async function checkAuthSession(page, telegramBot) {
  try {
    // Перевірка чи є елементи авторизації
    const isLoggedIn = await page.evaluate(() => {
      // Перевірка наявності кнопок входу/реєстрації
      const loginButtons = document.querySelectorAll(
        'button:has-text("Вхід"), button:has-text("Login"), a[href*="login"]'
      );
      return loginButtons.length === 0;
    });

    if (!isLoggedIn) {
      // Сповіщення власника
      const owner = await User.findOne({ isOwner: true });
      if (owner && telegramBot) {
        await telegramBot.telegram.sendMessage(
          owner.telegramId,
          '⚠️ *Увага!*\n\nСесія авторизації завершилася. Будь ласка, авторизуйтеся в браузері.',
          { parse_mode: 'Markdown' }
        );
      }
      return false;
    }

    return true;
  } catch (error) {
    console.error('❌ Помилка перевірки авторизації:', error);
    return true; // Якщо не вдалося перевірити, припускаємо що все ОК
  }
}

/**
 * Обробка CAPTCHA (базова логіка)
 */
export async function handleCaptcha(page) {
  try {
    // Перевірка наявності CAPTCHA
    const hasCaptcha = await page.evaluate(() => {
      const captchaSelectors = [
        '[class*="captcha"]',
        '[id*="captcha"]',
        'iframe[src*="recaptcha"]',
        'iframe[src*="hcaptcha"]'
      ];

      for (const selector of captchaSelectors) {
        if (document.querySelector(selector)) {
          return true;
        }
      }
      return false;
    });

    if (hasCaptcha) {
      console.log('⚠️ Виявлено CAPTCHA - потрібна ручна перевірка');

      // Можна додати інтеграцію з сервісами розпізнавання CAPTCHA
      // Наразі просто чекаємо
      await new Promise(r => setTimeout(r, DELAY_CAPTCHA_SOLVE)); // Pause for manual solve
      return false;
    }

    return true;
  } catch (error) {
    console.error('❌ Помилка обробки CAPTCHA:', error);
    return true;
  }
}

/**
 * Глобальна обробка помилок
 */
export function setupErrorHandling(bot, browser) {
  process.on('unhandledRejection', async (reason, promise) => {
    console.error('❌ Unhandled Rejection:', reason);

    try {
      const owner = await User.findOne({ isOwner: true });
      if (owner && bot) {
        await bot.telegram.sendMessage(
          owner.telegramId,
          `❌ *Критична помилка*\n\n${reason?.message || reason?.toString() || 'Невідома помилка'}`,
          { parse_mode: 'Markdown' }
        ).catch(() => { }); // Ігноруємо помилки відправки
      }
    } catch (error) {
      console.error('❌ Помилка відправки сповіщення:', error);
    }
  });

  process.on('uncaughtException', async (error) => {
    console.error('❌ Uncaught Exception:', error);

    try {
      const owner = await User.findOne({ isOwner: true });
      if (owner && bot) {
        await bot.telegram.sendMessage(
          owner.telegramId,
          `❌ *Критична помилка*\n\n${error.message}`,
          { parse_mode: 'Markdown' }
        ).catch(() => { }); // Ігноруємо помилки відправки
      }
    } catch (err) {
      console.error('❌ Помилка відправки сповіщення:', err);
    }

    // Завершуємо процес
    process.exit(1);
  });
}

