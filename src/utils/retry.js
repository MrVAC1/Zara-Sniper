/**
 * Утиліта для повторних спроб виконання операцій
 */
export async function retry(fn, options = {}) {
  const {
    retries = 3,
    delay = 1000,
    onRetry = null,
    shouldRetry = (error) => true
  } = options;

  let lastError;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // Перевірка чи потрібно повторювати
      if (!shouldRetry(error)) {
        throw error;
      }

      // Якщо це остання спроба, викидаємо помилку
      if (attempt === retries) {
        break;
      }

      // Виклик callback перед повтором
      if (onRetry) {
        onRetry(error, attempt);
      }

      // Затримка перед наступною спробою
      await new Promise(resolve => setTimeout(resolve, delay * attempt));
    }
  }

  throw lastError;
}

