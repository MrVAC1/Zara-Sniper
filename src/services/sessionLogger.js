import fs from 'fs';
import path from 'path';

class SessionLogger {
  constructor() {
    this.logDir = path.join(process.cwd(), 'logs');
    this.positiveLogFile = null;
    this.negativeLogFile = null;
    this.globalApiCount = 0;
    this.taskApiCounts = new Map();
    this.forcePositiveTasks = new Set();
    this._handlersRegistered = false;

    if (!fs.existsSync(this.logDir)) {
      try {
        fs.mkdirSync(this.logDir, { recursive: true });
      } catch (e) {
        console.error(`[SessionLogger] Failed to create logs directory: ${e.message}`);
      }
    }

    // Early Initialization: Create files immediately so startup errors are captured
    this._initFileNames();
    this._registerGlobalHandlers();
  }

  _initFileNames() {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');

    const timestamp = `${day}_${month}_${year}-${hours}-${minutes}-${seconds}`;
    this.positiveLogFile = path.join(this.logDir, `positive_${timestamp}.txt`);
    this.negativeLogFile = path.join(this.logDir, `negative_${timestamp}.txt`);

    // Create empty files to ensure they exist and are writable
    try {
      if (!fs.existsSync(this.positiveLogFile)) fs.writeFileSync(this.positiveLogFile, '', 'utf8');
      if (!fs.existsSync(this.negativeLogFile)) fs.writeFileSync(this.negativeLogFile, '', 'utf8');
    } catch (e) {
      console.error(`[SessionLogger] Failed to create initial log files: ${e.message}`);
    }
  }

  _registerGlobalHandlers() {
    if (this._handlersRegistered) return;

    process.on('uncaughtException', (error) => {
      this.log('ERROR', { context: 'CRITICAL', message: 'Uncaught Exception Detected' }, error);
    });

    process.on('unhandledRejection', (reason) => {
      const error = reason instanceof Error ? reason : new Error(String(reason));
      this.log('ERROR', { context: 'CRITICAL', message: 'Unhandled Promise Rejection' }, error);
    });

    this._handlersRegistered = true;
  }

  /**
   * Скидає лічильники. Опціонально генерує нові назви файлів.
   * @param {boolean} rotate - Чи створювати нові файли логів.
   */
  startNewSession(rotate = false) {
    this.globalApiCount = 0;
    this.taskApiCounts.clear();
    this.forcePositiveTasks.clear();

    if (rotate) {
      // CLEANUP: Check if old log files are empty and delete them
      this._cleanupEmptyLogFiles();
      this._initFileNames();
    }

    this.log('SUCCESS', {
      context: 'SYSTEM',
      message: `Нова сесія розпочата${rotate ? ' (Створено нові файли)' : ' (Продовження запису)'}. Лічильники скинуто.`
    });
  }

  /**
   * Видаляє старі порожні файли логів при створенні нових.
   * Перевіряє поточні positive та negative файли - якщо вони порожні або містять лише пробіли, видаляє їх.
   */
  _cleanupEmptyLogFiles() {
    const filesToCheck = [this.positiveLogFile, this.negativeLogFile];

    for (const filePath of filesToCheck) {
      if (!filePath || !fs.existsSync(filePath)) continue;

      try {
        const stats = fs.statSync(filePath);
        const content = fs.readFileSync(filePath, 'utf8').trim();

        // Видаляємо якщо файл порожній або містить лише пробіли/переноси рядків
        if (stats.size === 0 || content.length === 0) {
          fs.unlinkSync(filePath);
          console.log(`[SessionLogger] 🧹 Deleted empty log file: ${path.basename(filePath)}`);
        }
      } catch (e) {
        // Ignore errors during cleanup
        console.warn(`[SessionLogger] Cleanup warning: ${e.message}`);
      }
    }

    // Also cleanup any old empty files in logs directory
    this._cleanupOldEmptyLogs();
  }

  /**
   * Сканує папку logs і видаляє всі порожні файли positive_*.txt та negative_*.txt
   */
  _cleanupOldEmptyLogs() {
    try {
      const files = fs.readdirSync(this.logDir);

      for (const file of files) {
        if (!file.match(/^(positive|negative)_.*\.txt$/)) continue;

        const filePath = path.join(this.logDir, file);

        try {
          const stats = fs.statSync(filePath);

          // Видаляємо файли розміром 0 байт або з лише пробілами
          if (stats.size === 0) {
            fs.unlinkSync(filePath);
            console.log(`[SessionLogger] 🧹 Cleaned up empty: ${file}`);
          } else if (stats.size < 50) {
            // Для дуже маленьких файлів перевіряємо вміст
            const content = fs.readFileSync(filePath, 'utf8').trim();
            if (content.length === 0) {
              fs.unlinkSync(filePath);
              console.log(`[SessionLogger] 🧹 Cleaned up empty: ${file}`);
            }
          }
        } catch (e) {
          // Skip files that can't be accessed
        }
      }
    } catch (e) {
      console.warn(`[SessionLogger] Old logs cleanup error: ${e.message}`);
    }
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
    delete metadata.skipFile; // Не записувати цей прапорець у файл

    if (Object.keys(metadata).length > 0) {
      logLine += ` | Data: ${JSON.stringify(metadata)}`;
    }

    // Додавання стеку помилки
    if (error) {
      logLine += `\n[ERROR STACK]\n${error.stack || error}\n`;
    }

    // Вивід у консоль
    // Ми виводимо в консоль тільки системні та критичні повідомлення (context !== 'TASK').
    // Логи завдань виводяться через TaskQueue, щоб зберегти формат з дельта-часом [+1.2s].
    if (context !== 'TASK') {
      const consoleMethod = level === 'ERROR' ? console.error : (level === 'WARN' ? console.warn : console.log);
      consoleMethod(logLine);
    }

    // Запис у відповідний файл
    let targetFile = null;

    // ПРІОРИТЕТ: Якщо завдання в активній фазі викупу (після TARGET DETECTED)
    if (taskId && this.forcePositiveTasks.has(taskId)) {
      targetFile = this.positiveLogFile;
    } else {
      // ПЕРЕВІРКА НА ЗАБОРОНУ ЗАПИСУ: Routine hunting logs skip filling negative.txt
      // Але ERROR та WARN (наприклад IP Block) завжди записуються.
      const isRoutine = data.skipFile === true;
      if (!isRoutine || level === 'ERROR' || level === 'WARN') {
        targetFile = this.negativeLogFile;
      }
    }

    if (targetFile) {
      try {
        fs.appendFileSync(targetFile, logLine + '\n', 'utf8');
      } catch (fsErr) {
        console.error(`[SessionLogger] Помилка запису у файл: ${fsErr.message}`);
      }
    }
  }

  /**
   * Записує підсумок полювання для конкретного завдання.
   * @param {string} taskId 
   * @param {string} productName 
   */
  logSummary(taskId, productName) {
    if (!taskId) return;
    const count = this.taskApiCounts.get(taskId.toString()) || 0;
    this.log('INFO', {
      taskId,
      context: 'SUMMARY',
      message: `Підсумок полювання для "${productName}": Всього перевірок API: ${count}.`
    });
  }

  /**
   * Позначає завдання як "успішне виявлення". 
   * Після цього всі логи по цьому taskId (навіть помилки) йтимуть у positive файл.
   * @param {string} taskId 
   */
  promoteToPositive(taskId) {
    if (taskId) {
      const taskIdStr = taskId.toString();
      // Обов'язково додаємо візуальне розділення (2 пустих рядки) при КОЖНІЙ новій детекції
      if (this.positiveLogFile) {
        try {
          fs.appendFileSync(this.positiveLogFile, '\n\n', 'utf8');
        } catch (e) { }
      }
      this.forcePositiveTasks.add(taskIdStr);
    }
  }

  /**
   * Знімає позначку примусового логування в positive файл.
   * @param {string} taskId 
   */
  demote(taskId) {
    if (taskId) {
      this.forcePositiveTasks.delete(taskId.toString());
    }
  }
}

// export const instead of default to match named import in browser.js
export const sessionLogger = new SessionLogger();
