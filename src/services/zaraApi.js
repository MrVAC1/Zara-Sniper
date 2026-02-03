import { getHeaders } from './tokenManager.js';
import { USER_AGENT } from './browser.js';
import { getTimeConfig } from '../utils/timeUtils.js';

const { TIMEOUT_API_RETRY } = getTimeConfig();

export const STORE_IDS = {
    ES: '10701', // Spain
    PL: '11725', // Poland
    DE: '10705', // Germany
    UA: '11767'  // Ukraine
};

/**
 * Check availability via API
 * GET https://www.zara.com/itxrest/1/catalog/store/[STORE_ID]/product/id/[PRODUCT_ID]/availability
 */
export async function checkAvailability(storeId, productId, targetSkuId = null, context = {}) {
    const headers = await getHeaders(storeId);
    if (!headers || !headers['Cookie']) {
        console.warn('[API] Warning: No headers/cookies available. Returning null to trigger refresh...');
        return null;
    }
    const url = `https://www.zara.com/itxrest/1/catalog/store/${storeId}/product/id/${productId}/availability`;
    const isDebug = process.env.DEBUG_API === 'true';

    const start = Date.now();
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                ...headers,
                'User-Agent': USER_AGENT
            }
        });

        const duration = Date.now() - start;

        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                console.error(`[API] CRITICAL: Access Denied (${response.status})`);
                throw new Error('AKAMAI_BLOCK');
            }
            if (response.status === 404) {
                // Product might need checking via sizing info or is gone
                console.warn('[API] Product not found (404)');
            }
            throw new Error(`API Error: ${response.status}`);
        }

        const data = await response.json();

        if (isDebug) {
            console.log(`\n[DEBUG_API] URL: ${url}`);
            console.log(`[DEBUG_API] Product ID: ${productId}`);
            console.log(`[DEBUG_API] Time: ${duration}ms`);

            if (context.color) console.log(`[DEBUG_API] Color: ${context.color}`);
            if (context.size) console.log(`[DEBUG_API] Size: ${context.size}`);

            if (targetSkuId && data.skusAvailability) {
                const targetSku = data.skusAvailability.find(s => s.sku === targetSkuId);
                console.log('[DEBUG_API] SKU Data:', targetSku ? JSON.stringify(targetSku, null, 2) : 'SKU NOT FOUND IN RESPONSE');
            } else {
                console.log('[DEBUG_API] Response:', JSON.stringify(data, null, 2).substring(0, 500) + '...');
            }
        }

        // LOGIC FOR SKU DEBUGGING ALWAYS (Requested by User)
        if (targetSkuId && data.skusAvailability) {
            const targetSku = data.skusAvailability.find(s => s.sku == targetSkuId); // Use loose equality for safety
            if (!targetSku) {
                console.log("⚠️ [API MISMATCH] SKU NOT FOUND IN RESPONSE");
                console.log(`Запитуваний Product ID: ${productId}`);
                console.log("Доступні SKU від Zara:", data.skusAvailability.map(s => s.sku).join(', '));
                console.log("Бот шукає SKU:", targetSkuId);
            } else {
                const status = targetSku.availability;
                if (!isDebug) console.log(`[HUNTING] SKU: ${targetSkuId} | Status: ${status} | ${duration}ms | ProductId: ${productId}`);
            }
        }

        return data;
    } catch (error) {
        if (error.message === 'AKAMAI_BLOCK') throw error;
        console.warn(`[API] Availability check failed: ${error.message}`);
        throw error;
    }
}

/**
 * Get Sizing Info via API
 * GET https://www.zara.com/itxrest/2/returns/store/[STORE_ID]/product/[PRODUCT_ID]/sizing-info?locale=[LOCALE]
 */
export async function getSizingInfo(storeId, productId, locale = 'uk-UA') {
    const headers = await getHeaders(storeId);
    const url = `https://www.zara.com/itxrest/2/returns/store/${storeId}/product/${productId}/sizing-info?locale=${locale}`;

    let retries = 2;
    while (retries >= 0) {
        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    ...headers,
                    'User-Agent': USER_AGENT
                }
            });

            if (!response.ok) {
                throw new Error(`API Error: ${response.status}`);
            }

            const data = await response.json();
            return data;
        } catch (error) {
            console.warn(`[API] Sizing info attempt failed (${retries} left): ${error.message}`);
            if (retries === 0) throw error;
            retries--;
            await new Promise(r => setTimeout(r, TIMEOUT_API_RETRY));
        }
    }
}
