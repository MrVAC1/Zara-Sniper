import fs from 'fs';
import path from 'path';

class SessionLogger {
  constructor() {
    this.logDir = path.join(process.cwd(), 'logs');
    this.positiveLogFile = null;
    this.negativeLogFile = null;
    this.globalApiCount = 0;
    this.taskApiCounts = new Map();

    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  /**
   * Скидає лічильники та генерує нові назви файлів логів (Позитивний та Негативний).
   * Викликається після успішної ініціалізації браузера.
   */
  startNewSession() {
    this.globalApiCount = 0;
    this.taskApiCounts.clear();

    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');

    // Формат: DD_MM_YYYY-HH-mm-ss (Windows-friendly)
    const timestamp = `${day}_${month}_${year}-${hours}-${minutes}-${seconds}`;

    this.positiveLogFile = path.join(this.logDir, `positive_${timestamp}.txt`);
    this.negativeLogFile = path.join(this.logDir, `negative_${timestamp}.txt`);

    this.log('SUCCESS', { context: 'SYSTEM', message: 'Нова сесія розпочата. Лічильники скинуто. Створено роздільні файли логів.' });
  }

  /**
   * Збільшує лічильники API запитів.
   * @param {string} taskId 
   */
  increment(taskId) {
    this.globalApiCount++;
    if (taskId) {
      const taskIdStr = taskId.toString();
      const count = (this.taskApiCounts.get(taskIdStr) || 0) + 1;
      this.taskApiCounts.set(taskIdStr, count);
    }
  }

  /**
   * Основна функція логування.
   * @param {'INFO'|'WARN'|'ERROR'|'SUCCESS'} level 
   * @param {Object} data - Об'єкт з даними (context, taskId, productName, price тощо)
   * @param {Error|null} error - Об'єкт помилки
   */
  log(level, data = {}, error = null) {
    const now = new Date();
    const timeStr = `[${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}]`;

    const context = data.context || 'TASK';
    const taskId = data.taskId ? data.taskId.toString() : null;
    const taskCount = taskId ? (this.taskApiCounts.get(taskId) || 0) : 0;

    let message = '';
    if (data.message) {
      message = data.message;
    } else if (level === 'SUCCESS' && data.productName) {
      message = `Куплено товар: ${data.productName} | Ціна: ${data.price || 'N/A'}`;
    } else if (error) {
      message = error.message;
    }

    // Формування рядка логу
    let logLine = `${timeStr} [${level}] [${context}] `;

    if (taskId) {
      logLine += `[TaskID: ${taskId.substring(0, 8)}] `;
    }

    logLine += message;

    // Додавання статистики
    if (taskId) {
      logLine += ` | Спроб API: ${taskCount}`;
    }
    logLine += ` | Всього API: ${this.globalApiCount}`;

    // Додавання метаданих
    const metadata = { ...data };
    delete metadata.context;
    delete metadata.taskId;
    delete metadata.message;

    if (Object.keys(metadata).length > 0) {
      logLine += ` | Data: ${JSON.stringify(metadata)}`;
    }

    // Додавання стеку помилки
    if (error) {
      logLine += `\n[ERROR STACK]\n${error.stack || error}\n`;
    }

    // Вивід у консоль
    const consoleMethod = level === 'ERROR' ? console.error : (level === 'WARN' ? console.warn : console.log);
    consoleMethod(logLine);

    // Запис у відповідний файл
    let targetFile = null;
    if (level === 'SUCCESS' || level === 'INFO') {
      targetFile = this.positiveLogFile;
    } else if (level === 'ERROR' || level === 'WARN') {
      targetFile = this.negativeLogFile;
    }

    if (targetFile) {
      try {
        fs.appendFileSync(targetFile, logLine + '\n', 'utf8');
      } catch (fsErr) {
        console.error(`[SessionLogger] Помилка запису у файл: ${fsErr.message}`);
      }
    }
  }
}

const sessionLogger = new SessionLogger();
export default sessionLogger;
