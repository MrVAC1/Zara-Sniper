import { getBrowser } from './browser.js';
import { getHealthCheckInterval, getTimeConfig } from '../utils/timeUtils.js';

let sessionCheckTimeout = null;

export function startSessionHealthCheck(telegramBot) {
    const { HEALTH_CHECK_INTERVAL, GOTO_TIMEOUT } = getTimeConfig();

    const scheduleNextCheck = () => {
        const delay = getHealthCheckInterval(HEALTH_CHECK_INTERVAL);
        console.log(`[Health] Next check in ${Math.round(delay / 60000)} minutes.`);

        sessionCheckTimeout = setTimeout(async () => {
            await runHealthCheck(telegramBot);
            scheduleNextCheck();
        }, delay);
    };

    // Start first check
    scheduleNextCheck();
}

async function runHealthCheck(telegramBot) {
    console.log('[Health] Checking session health...');
    const healthy = await checkSession(telegramBot);
    if (!healthy) {
        console.warn('[Health] Session unhealthy! Pausing operations.');
        triggerIpGuard(60); // Pause for 60 mins or until manual fix
    }
}

export async function checkSession(telegramBot) {
    const { GOTO_TIMEOUT } = getTimeConfig();
    let page = null;
    try {
        const browser = await getBrowser();
        page = await browser.newPage();

        // 1. Check Header on Home Page
        await page.goto('https://www.zara.com/ua/uk/', { waitUntil: 'domcontentloaded', timeout: GOTO_TIMEOUT });

        const loginHeader = await page.$('[data-qa-id="layout-header-user-logon"]');
        if (loginHeader) {
            console.warn('[Health] Found "Logon" in header. User is NOT logged in.');
            await notifySessionDead(telegramBot);
            if (page) await page.close();
            return false;
        }

        // 2. Check Account Page Redirect
        await page.goto('https://www.zara.com/ua/uk/user/account', { waitUntil: 'domcontentloaded', timeout: GOTO_TIMEOUT });

        const url = page.url();
        const loginForm = await page.$('[data-qa-id="logon-form-submit"]');

        if (url.includes('account.zara.com/login') || loginForm) {
            console.warn('[Health] Redirected to Login page. Session is dead.');
            await notifySessionDead(telegramBot);
            if (page) await page.close();
            return false;
        }

        console.log('[Health] Session is ACTIVE ✅');
        if (page) await page.close();
        return true;

    } catch (e) {
        console.error('[Health] Check failed:', e.message);
        if (page) await page.close().catch(() => { });
        return false; // Fail safe
    }
}

async function notifySessionDead(telegramBot) {
    const { getOwnerIds } = await import('../utils/auth.js');
    const ownerIds = getOwnerIds();
    if (telegramBot && ownerIds.length > 0) {
        for (const oid of ownerIds) {
            await telegramBot.telegram.sendMessage(oid,
                '⚠️ <b>УВАГА: Сесія Zara завершилася!</b>\nБот не зможе викупити товари.\nПотрібно знову увійти в аккаунт.',
                { parse_mode: 'HTML' }
            ).catch(() => { });
        }
    }
}

let ipBlockTimeout = null;
let isIpBlocked = false;

export function triggerIpGuard(durationMinutes = 30) {
    if (isIpBlocked) return;

    console.warn(`[IP Guard] 🛡️ IP Block/Captcha detected! Pausing operations for ${durationMinutes} minutes.`);
    isIpBlocked = true;

    // Notify Admin (console for now)
    console.error('⚠️ ALERT: IP BLOCKED TEMPORARILY');

    ipBlockTimeout = setTimeout(() => {
        console.log('[IP Guard] 🛡️ Lifting IP Block. Resuming operations.');
        isIpBlocked = false;
        ipBlockTimeout = null;
    }, durationMinutes * 60 * 1000);
}

export function isSystemPaused() {
    return isIpBlocked;
}
