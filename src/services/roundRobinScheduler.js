
/**
 * RoundRobinScheduler
 * Ensures tasks execute their API checks sequentially in a loop:
 * Task 1 -> Task 2 -> Task 3 -> ... -> Task 1
 */
class RoundRobinScheduler {
  constructor() {
    this.tasks = []; // Ordered list of task IDs
    this.currentIndex = 0; // Pointer to current turn
    this.resolvers = new Map(); // Map<taskId, resolveFunction>
    this.activeCheck = false; // Is a check currently executing?
  }

  /**
   * Register a task to the circle
   */
  register(taskId) {
    const id = taskId.toString();
    if (!this.tasks.includes(id)) {
      this.tasks.push(id);
      console.log(`[Scheduler] Registered Task ${id}. Total: ${this.tasks.length}`);
    }
  }

  /**
   * Remove a task from the circle
   */
  unregister(taskId) {
    const id = taskId.toString();
    const index = this.tasks.indexOf(id);
    if (index !== -1) {
      this.tasks.splice(index, 1);
      this.resolvers.delete(id);
      console.log(`[Scheduler] Unregistered Task ${id}. Total: ${this.tasks.length}`);

      // If we removed the task that was just about to run or running, adjust index
      if (index < this.currentIndex) {
        this.currentIndex--;
      }
      if (this.currentIndex >= this.tasks.length) {
        this.currentIndex = 0;
      }

      // If the removed task was holding the lock or next in line, we might need to kick the next one
      this.triggerNext();
    }
  }

  /**
   * Wait for this task's turn
   * Returns a Promise that resolves when it's allowed to run
   */
  waitTurn(taskId) {
    const id = taskId.toString();

    // Safety: Ensure registered
    if (!this.tasks.includes(id)) this.register(id);

    return new Promise((resolve) => {
      // If it's already this task's turn and no check is running, go immediately
      if (this.tasks.length > 0 && this.tasks[this.currentIndex] === id && !this.activeCheck) {
        this.activeCheck = true;
        resolve();
      } else {
        // Otherwise wait
        // Overwrite existing resolver if any (shouldn't happen in single loop)
        this.resolvers.set(id, resolve);

        // Edge case: If system is idle but index points elsewhere, trigger next might be needed
        // But usually yieldTurn handles the flow.
      }
    });
  }

  /**
   * Signal that this task is done with its check
   * Passes control to the next task
   */
  yieldTurn(taskId) {
    const id = taskId.toString();

    // Only yield if this task was actually the one running
    // (Simple protection, though in single-threaded JS strictly not needed if logic is correct)

    this.activeCheck = false;

    // Move pointer
    this.currentIndex++;
    if (this.currentIndex >= this.tasks.length) {
      this.currentIndex = 0;
    }

    this.triggerNext();
  }

  triggerNext() {
    if (this.tasks.length === 0) return;

    if (this.activeCheck) return; // Something is running, wait for it to yield

    const nextTaskId = this.tasks[this.currentIndex];
    const resolver = this.resolvers.get(nextTaskId);

    if (resolver) {
      this.activeCheck = true;
      this.resolvers.delete(nextTaskId); // Clear waiting state
      resolver(); // Wake up the task
    } else {
      // The next task hasn't called waitTurn() yet (maybe doing other processing).
      // It will check 'activeCheck' when it calls waitTurn() and start immediately.
    }
  }
}

const scheduler = new RoundRobinScheduler();
export default scheduler;
