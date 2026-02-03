import dotenv from 'dotenv';
dotenv.config();

/**
 * Generates a random integer between min and max (inclusive).
 */
export const randomDelay = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

/**
 * Calculates a delay with a percentage-based jitter.
 * @param {number} base - The base delay in milliseconds.
 * @param {number} percent - The jitter percentage (e.g., 0.15 for +/- 15%).
 * @returns {number} The calculated delay with jitter.
 */
export const getJitteredDelay = (base, percent = 0.15) => {
  const jitter = Math.floor(base * percent);
  return Math.max(0, base + randomDelay(-jitter, jitter));
};

/**
 * Calculates the Sniper Interval with a specific large jitter (-10s to +20s).
 * @param {number} base - The base SNIPER_INTERVAL from env.
 * @returns {number} The calculated interval.
 */
export const getSniperInterval = (base) => {
  // Jitter: -10000ms to +20000ms
  const jitter = randomDelay(-10000, 20000);
  // Ensure at least 10s wait
  return Math.max(10000, base + jitter);
};

/**
 * Calculates the Health Check Interval with a specific jitter (+/- 2 minutes).
 * @param {number} base - The base HEALTH_CHECK_INTERVAL from env.
 * @returns {number} The calculated interval.
 */
export const getHealthCheckInterval = (base) => {
  // Jitter: +/- 2 minutes (120000ms)
  const jitter = randomDelay(-120000, 120000);
  // Ensure at least 5 minutes wait
  return Math.max(300000, base + jitter);
};

// --- Global Configuration Getters (Safe Fallbacks) ---

export const getTimeConfig = () => ({
  SNIPER_INTERVAL: parseInt(process.env.SNIPER_INTERVAL) || 10000,
  GOTO_TIMEOUT: parseInt(process.env.GOTO_TIMEOUT) || 10000,
  SELECTOR_TIMEOUT: parseInt(process.env.SELECTOR_TIMEOUT) || 10000,
  ACTION_PAUSE: parseInt(process.env.ACTION_PAUSE) || 800,
  CLICK_DELAY: parseInt(process.env.CLICK_DELAY) || 200,
  MIN_DELAY: parseInt(process.env.MIN_DELAY) || 0,
  MAX_DELAY: parseInt(process.env.MAX_DELAY) || 200,
  HEALTH_CHECK_INTERVAL: parseInt(process.env.HEALTH_CHECK_INTERVAL) || 900000,

  // New Timing Variables
  TIMEOUT_SIZE_MENU: parseInt(process.env.TIMEOUT_SIZE_MENU) || 2000,
  DELAY_POST_RELOAD: parseInt(process.env.DELAY_POST_RELOAD) || 500,
  DELAY_BETWEEN_CONTINUE: parseInt(process.env.DELAY_BETWEEN_CONTINUE) || 300,
  TIMEOUT_3DS_REDIRECT: parseInt(process.env.TIMEOUT_3DS_REDIRECT) || 3000,
  DELAY_POST_CVV: parseInt(process.env.DELAY_POST_CVV) || 2000,
  DELAY_CAPTCHA_SOLVE: parseInt(process.env.DELAY_CAPTCHA_SOLVE) || 30000,
  TIMEOUT_API_RETRY: parseInt(process.env.TIMEOUT_API_RETRY) || 500,
  TIMEOUT_HEALTH_PAGE: parseInt(process.env.TIMEOUT_HEALTH_PAGE) || 60000,
  DELAY_3DS_SUCCESS: parseInt(process.env.DELAY_3DS_SUCCESS) || 2500,

  // Supplemental Timing Variables
  TIMEOUT_CLICK_TRIAL: parseInt(process.env.TIMEOUT_CLICK_TRIAL) || 500,
  TIMEOUT_DB_RETRY: parseInt(process.env.TIMEOUT_DB_RETRY) || 3000,
  TIMEOUT_LOOP_RETRY: parseInt(process.env.TIMEOUT_LOOP_RETRY) || 3000,
  DELAY_WATCH_LOOP: parseInt(process.env.DELAY_WATCH_LOOP) || 300,
  TIMEOUT_FAST_SELECTOR: parseInt(process.env.TIMEOUT_FAST_SELECTOR) || 1000,
  TIMEOUT_SOLD_OUT_CHECK: parseInt(process.env.TIMEOUT_SOLD_OUT_CHECK) || 500,
  TIMEOUT_MODAL_CHECK: parseInt(process.env.TIMEOUT_MODAL_CHECK) || 500,
  IN_STOCK_RECOVERY_TIMEOUT: parseInt(process.env.IN_STOCK_RECOVERY_TIMEOUT) || 5000,
  DELAY_RECOVERY_WATCHDOG: parseInt(process.env.DELAY_RECOVERY_WATCHDOG) || 8000,
  DELAY_FAST_RECOVERY: parseInt(process.env.DELAY_FAST_RECOVERY) || 2000,
  DELAY_SUB_SECOND: parseInt(process.env.DELAY_SUB_SECOND) || 200,
  DELAY_CHECKOUT_STEP: parseInt(process.env.DELAY_CHECKOUT_STEP) || 200,
  DELAY_FAST_BACKTRACK: parseInt(process.env.DELAY_FAST_BACKTRACK) || 200,
  TIMEOUT_PAY_BUTTON: parseInt(process.env.TIMEOUT_PAY_BUTTON) || 3000,

  // Hybrid Sniper Config
  API_MONITORING_INTERVAL: parseInt(process.env.API_MONITORING_INTERVAL) || 500,
  AKAMAI_BAN_DELAY: parseInt(process.env.AKAMAI_BAN_DELAY) || 45000,
  AKAMAI_CHECKOUT_PAUSE: parseInt(process.env.AKAMAI_CHECKOUT_PAUSE) || 150000
});
