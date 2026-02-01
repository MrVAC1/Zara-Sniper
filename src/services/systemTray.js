/**
 * System Tray (опціональна функція)
 * 
 * Примітка: System Tray вимагає Electron, який не є обов'язковим для роботи бота.
 * Якщо Electron не встановлено, функція просто пропускається.
 */
export function createSystemTray(telegramBot) {
  // System Tray доступний тільки в Electron середовищі
  // Оскільки бот працює як Node.js додаток, System Tray не підтримується
  console.log('ℹ️ System Tray недоступний (потрібен Electron). Бот працює у фоновому режимі.');
  console.log('ℹ️ Використайте /view для перегляду стану браузера');
  
  // Можна додати альтернативні рішення:
  // - Використання node-notifier для сповіщень
  // - Логування в файл
  // - HTTP endpoint для статусу
  
  return null;
}
