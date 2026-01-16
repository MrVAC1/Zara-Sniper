import Blacklist from '../models/Blacklist.js';
import User from '../models/User.js';
import { isOwner } from '../utils/auth.js';
const MAX_ATTEMPTS = 3;

/**
 * Middleware для перевірки доступу користувача
 */
export async function checkAccess(ctx, next) {
  const userId = ctx.from?.id;

  if (!userId) {
    return ctx.reply('❌ Неможливо ідентифікувати користувача');
  }

  // Перевірка на blacklist
  const blacklisted = await Blacklist.findOne({ telegramId: userId });
  if (blacklisted && blacklisted.attempts >= MAX_ATTEMPTS) {
    return ctx.reply('🚫 Ваш доступ заблоковано');
  }

  // Перевірка на власника
  if (isOwner(userId)) {
    // Створити/оновити користувача як власника
    await User.findOneAndUpdate(
      { telegramId: userId },
      { telegramId: userId, isOwner: true },
      { upsert: true, new: true }
    );
    return next();
  }

  // Якщо не власник - збільшити кількість спроб
  const blacklistEntry = await Blacklist.findOne({ telegramId: userId });

  if (blacklistEntry) {
    blacklistEntry.attempts += 1;
    await blacklistEntry.save();

    if (blacklistEntry.attempts >= MAX_ATTEMPTS) {
      return ctx.reply('🚫 Доступ заблоковано після 3-х спроб несанкціонованого доступу');
    }

    return ctx.reply(`⚠️ Доступ заборонено. Спроба ${blacklistEntry.attempts}/${MAX_ATTEMPTS}`);
  } else {
    // Перша спроба
    await Blacklist.create({
      telegramId: userId,
      attempts: 1,
      reason: 'Unauthorized access attempt'
    });
    return ctx.reply(`⚠️ Доступ заборонено. Спроба 1/${MAX_ATTEMPTS}`);
  }
}

/**
 * Перевірка чи користувач є власником (експортується з auth.js для зручності)
 */
export { isOwner };

