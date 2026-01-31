import SniperTask from '../models/SniperTask.js';
import User from '../models/User.js';
import { parseProductOptions } from './zaraParser.js';


/**
 * Система черги завдань з обмеженням одночасного виконання
 */
class TaskQueue {
  constructor(maxConcurrency = 5) {
    this.maxConcurrency = maxConcurrency;
    this.running = new Map(); // taskId -> Promise
    this.queue = [];
    this.loggers = new Map(); // taskId -> logger function
  }

  /**
   * Логування з префіксом Task ID
   */
  createLogger(taskId) {
    const ownerId = process.env.OWNER_ID ? process.env.OWNER_ID.split(',')[0].trim() : 'Unknown';
    const prefix = `[Owner: ${ownerId}]`;

    const logger = {
      lastLogTime: Date.now(),
      _getDuration() {
        const now = Date.now();
        const duration = (now - this.lastLogTime) / 1000;
        this.lastLogTime = now;
        return `[+${duration.toFixed(2)}s]`;
      },
      log: function (message) { console.log(`${prefix} [Task ${taskId}] ${message} ${this._getDuration()}`); },
      error: function (message) { console.error(`${prefix} [Task ${taskId}] ❌ ${message} ${this._getDuration()}`); },
      success: function (message) { console.log(`${prefix} [Task ${taskId}] ✅ ${message} ${this._getDuration()}`); },
      warn: function (message) { console.warn(`${prefix} [Task ${taskId}] ⚠️ ${message} ${this._getDuration()}`); }
    };
    this.loggers.set(taskId.toString(), logger);
    return logger;
  }

  getLogger(taskId) {
    return this.loggers.get(taskId.toString()) || this.createLogger(taskId);
  }

  /**
   * Додати завдання до черги
   */
  async enqueue(taskId, taskFunction) {
    const taskIdStr = taskId.toString();

    if (this.running.has(taskIdStr)) {
      this.getLogger(taskId).warn('Завдання вже виконується');
      return;
    }

    // Якщо є вільне місце, запускаємо одразу
    if (this.running.size < this.maxConcurrency) {
      return this.execute(taskId, taskFunction);
    }

    // Інакше додаємо в чергу
    this.queue.push({ taskId, taskFunction });
    this.getLogger(taskId).log(`Додано в чергу (позиція: ${this.queue.length})`);
  }

  /**
   * Виконати завдання
   */
  async execute(taskId, taskFunction) {
    const taskIdStr = taskId.toString();
    const logger = this.getLogger(taskId);

    logger.log('Запуск виконання завдання');

    const taskPromise = (async () => {
      try {
        await taskFunction(logger);
      } catch (error) {
        logger.error(`Помилка виконання: ${error.message}`);
        throw error;
      } finally {
        // Видаляємо з виконуваних
        this.running.delete(taskIdStr);
        this.loggers.delete(taskIdStr);
        logger.log('Завдання завершено');

        // Запускаємо наступне завдання з черги
        this.processNext();
      }
    })();

    this.running.set(taskIdStr, taskPromise);
    return taskPromise;
  }

  /**
   * Обробити наступне завдання з черги
   */
  processNext() {
    if (this.queue.length === 0 || this.running.size >= this.maxConcurrency) {
      return;
    }

    const { taskId, taskFunction } = this.queue.shift();
    this.execute(taskId, taskFunction).catch(error => {
      this.getLogger(taskId).error(`Помилка обробки: ${error.message}`);
    });
  }

  /**
   * Прибрати завдання з черги
   */
  remove(taskId) {
    const taskIdStr = taskId.toString();

    // Видаляємо з черги
    this.queue = this.queue.filter(item => item.taskId.toString() !== taskIdStr);

    // Видаляємо logger
    this.loggers.delete(taskIdStr);

    // Завдання, що виконується, завершиться само (не перериваємо)
  }

  /**
   * Отримати статистику
   */
  getStats() {
    return {
      running: this.running.size,
      queued: this.queue.length,
      maxConcurrency: this.maxConcurrency
    };
  }

  /**
   * Отримати список виконуваних завдань
   */
  getRunningTasks() {
    return Array.from(this.running.keys());
  }
}

// Експортуємо singleton
const queue = new TaskQueue(parseInt(process.env.MAX_CONCURRENT_TASKS) || 5);
export default queue;

/**
 * Відновлення активних завдань (Cold Start)
 */
export async function initializeActiveTasks(context, telegramBot) {
  try {
    console.log('🔄 [Bootstrap] Starting Cold Start restoration...');

    // 1. Пошук активних завдань для поточного власника
    const ownerIds = process.env.OWNER_ID ? process.env.OWNER_ID.split(',').map(s => s.trim()) : [];
    const users = await User.find({ telegramId: { $in: ownerIds } });
    const userIds = users.map(u => u._id);

    // Якщо користувачів не знайдено, нічого не відновлюємо (безпека)
    if (userIds.length === 0) {
      console.log('⚠️ [Bootstrap] No users found for current OWNER_ID configuration. Skipping restoration.');
      return;
    }

    const tasks = await SniperTask.find({
      status: { $in: ['SEARCHING', 'HUNTING', 'PENDING', 'MONITORING', 'hunting', 'processing'] },
      userId: { $in: userIds }
    });

    if (tasks.length === 0) {
      console.log('✅ [Bootstrap] No active tasks found in DB.');
      return;
    }

    console.log(`[Bootstrap] Found ${tasks.length} active tasks in DB.`);

    // Dynamic import to avoid circular dependency
    const { startSniper } = await import('./sniperEngine.js');

    for (const task of tasks) {
      try {
        console.log(`[Bootstrap] Restoring task: ${task._id} - ${task.productName}`);

        // 2. Data Integrity Check
        let needsSave = false;

        // Ensure Store ID is correct for UA (if we had storeId in task, we would check it here)
        // For now, we assume global config or browser injection handles it.

        // Check Product ID
        if (!task.productId) {
          console.log(`🛠 [Bootstrap] Missing productId for ${task.productName}. Fetching...`);
          try {
            const details = await parseProductOptions(task.url);
            if (details && details.productId) {
              task.productId = details.productId;

              // Update color/size values if possible
              if (task.selectedColor && details.colors) {
                const c = details.colors.find(c => c.name === task.selectedColor.name);
                if (c) task.selectedColor.value = c.value;
              }

              needsSave = true;
              if (details.page) await details.page.close().catch(() => { });
            }
          } catch (e) {
            console.error(`⚠️ [Bootstrap] Failed to repair data for ${task.productName}: ${e.message}`);
          }
        }

        // Reset status to hunting if needed
        if (task.status !== 'hunting') {
          task.status = 'hunting';
          needsSave = true;
        }

        if (needsSave) await task.save();

        // 3. Create Page & Start Hunting
        console.log(`🌐 [Bootstrap] Creating page for ${task.productName}...`);
        const page = await context.newPage();

        // Start Sniper with existing page
        // We pass the page explicitly so startSniper doesn't create a new one
        // NON-BLOCKING for the sniper itself, but we throttle the LOOP
        startSniper(task._id, telegramBot, page).catch(err => {
          console.error(`❌ [Bootstrap] Failed to start sniper for ${task._id}:`, err);
        });

        // THROTTLE: Wait 3s before restoring next task (Legacy macOS crash fix)
        await new Promise(r => setTimeout(r, 3000));

      } catch (error) {
        console.error(`❌ [Bootstrap] Failed to restore task ${task._id}: ${error.message}`);
        // Continue to next task
      }
    }

    console.log('✅ [Bootstrap] Restoration complete.');

  } catch (error) {
    console.error('❌ [Bootstrap] Critical error during restoration:', error);
  }
}

