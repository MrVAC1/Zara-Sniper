import { getBrowser } from './browser.js';

let cachedToken = null;
let tokenExpiry = 0;

/**
 * Force refresh of the session (clears cache and reloads browser page)
 */
export async function refreshSession() {
    console.log('[TokenManager] Forcing session refresh...');
    cachedToken = null;
    tokenExpiry = 0;

    try {
        const browser = await getBrowser();
        const pages = browser.pages();
        // Reload the first available page to refresh cookies/tokens
        if (pages.length > 0) {
            const page = pages[0];
            if (!page.isClosed()) {
                console.log('[TokenManager] Reloading background page to update cookies...');
                await page.reload({ waitUntil: 'domcontentloaded' });
                // Short wait to let background scripts run
                await new Promise(r => setTimeout(r, 3000));
            }
        }
    } catch (error) {
        console.error('[TokenManager] Error during session refresh:', error.message);
    }
}

export async function getAuthToken() {
    if (cachedToken && Date.now() < tokenExpiry) {
        return cachedToken;
    }

    const browser = await getBrowser();
    if (!browser) throw new Error('BROWSER_DISCONNECTED');
    let pages = browser.pages();
    // Use first open page or create new if none
    let page = pages.length > 0 ? pages[0] : await browser.newPage();

    // Try to get token from localStorage or cookies
    const tokenData = await page.evaluate(() => {
        // Try localStorage first
        // Zara often stores auth data in localStorage keys like 'user-token' or similar
        // Adjust key based on actual site inspection if needed
        // For now, let's try to extract from script tags or standard storage
        return null; // Placeholder for now, we rely on cookies mostly for Zara
    });

    // Actually, for Zara we need the Bearer token which is often in the initial state or network requests
    // A more reliable way is to intercept a request or check specific cookies/storage

    // Let's grab cookies which are essential
    const cookies = await page.context().cookies();
    const itxSession = cookies.find(c => c.name === 'ITXSESSIONID');

    // If we need a JWT specifically (Authorization: Bearer ...), it's often in window.zara.appConfig or similar
    // Or we can intercept it from network traffic

    // Since we are using a hybrid approach, we might need to listen to a request to capture the token
    // For this initial version, we will return null and rely on cookies passing in the request headers
    // The instructions say: "Authorization: Bearer [JWT_TOKEN] (токен брати з активної сесії)"

    // Let's try to find it in the browser state
    const jwt = await page.evaluate(() => {
        try {
            // Common places for SPA tokens
            // This is a guess and needs verification on the actual site
            return window?.zara?.appConfig?.authToken ||
                sessionStorage.getItem('authToken') ||
                localStorage.getItem('authToken') ||
                null;
        } catch (e) {
            return null;
        }
    });

    if (jwt) {
        cachedToken = jwt;
        tokenExpiry = Date.now() + 1000 * 60 * 15; // Cache for 15 mins
        console.log('[TokenManager] Updated JWT from browser session.');
        return jwt;
    }

    // Fallback: If no JWT found directly, try to intercept from network (optional optimization)
    // For now we return cached if available or null

    return cachedToken;
}

export async function getHeaders(storeId = '11767') { // Updated to new UA Store ID
    const browser = await getBrowser();
    if (!browser) throw new Error('BROWSER_DISCONNECTED');
    let pages = browser.pages();
    // Use an existing page if possible to share session state
    let page = pages.find(p => !p.isClosed());

    // If no page open, we might need to open one to get fresh cookies/tokens
    // But ideally we keep one open in background
    if (!page) {
        try {
            page = await browser.newPage();
            // Go to home to init session if needed
            // await page.goto('https://www.zara.com/ua/uk/', { waitUntil: 'domcontentloaded' });
        } catch (e) {
            console.error('[TokenManager] Failed to create page:', e);
            return {};
        }
    }

    let cookies = [];
    try {
        cookies = await page.context().cookies();
    } catch (e) {
        console.error('[TokenManager] Error getting cookies:', e.message);
        return {};
    }

    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    const token = await getAuthToken();

    // Referer mapping based on Store ID
    const refererMap = {
        '11767': 'https://www.zara.com/ua/uk/',
        '10701': 'https://www.zara.com/es/en/', // Spain (International/English)
        '10700': 'https://www.zara.com/es/es/', // Spain (Local)
        '10659': 'https://www.zara.com/pl/pl/', // Poland
        '10500': 'https://www.zara.com/de/de/', // Germany
    };

    const referer = refererMap[storeId] || 'https://www.zara.com/ua/uk/';

    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.125 Safari/537.36',
        'Cookie': cookieHeader,
        'Referer': referer
    };

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    return headers;
}
