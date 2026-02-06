/**
 * Network Router - Context-Aware Proxy Routing
 * 
 * Routes requests based on URL patterns:
 * - PROXY: checkout/payment pages and APIs
 * - DIRECT: static assets (images, fonts, CSS)
 * - DEFAULT: direct connection for everything else
 * 
 * Implements header stripping and cookie synchronization for stealth.
 */

import { proxyManager } from './proxyManager.js';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { HttpProxyAgent } from 'http-proxy-agent';

// Disable SSL certificate validation for Bright Data proxies
// This is required because Bright Data uses SSL interception (MITM)
// which results in self-signed certificates
// process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Track current routing mode
let isCheckoutPhase = false;
let storedFingerprint = null;

// URL patterns that trigger proxy mode
const PROXY_PATTERNS = [
  /\/checkout/i,
  /\/payment/i,
  /\/itxrest\/.*\/checkout/i,
  /\/itxrest\/.*\/payment/i,
  /\/itxrest\/.*\/order/i
];

// Static asset extensions to bypass proxy (only video - everything else loads normally)
// NOTE: We do NOT bypass images/CSS/fonts during checkout to ensure buttons render
const BYPASS_EXTENSIONS = [
  '.mp4', '.webm', '.mp3', '.avi', '.mov'  // Only media files
];

// Headers to strip from proxied requests (proxy footprint removal)
const STRIP_HEADERS = [
  'via',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'forwarded',
  'proxy-authorization',
  'x-proxy-id',
  'x-real-ip'
];

/**
 * Check if URL should be routed through proxy
 */
function shouldUseProxy(url) {
  if (!isCheckoutPhase) return false;

  try {
    const urlObj = new URL(url);
    const fullPath = urlObj.pathname + urlObj.search;

    // Check if matches proxy patterns
    for (const pattern of PROXY_PATTERNS) {
      if (pattern.test(fullPath) || pattern.test(url)) {
        return true;
      }
    }
  } catch (e) {
    // Invalid URL, use direct
  }

  return false;
}

/**
 * Check if URL is a static asset that should bypass proxy
 */
function isStaticAsset(url) {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname.toLowerCase();

    for (const ext of BYPASS_EXTENSIONS) {
      if (pathname.endsWith(ext)) {
        return true;
      }
    }
  } catch (e) {
    // Invalid URL
  }

  return false;
}

/**
 * Strip proxy-identifying headers and inject fingerprint headers
 */
function sanitizeHeaders(originalHeaders) {
  const headers = { ...originalHeaders };

  // Remove proxy footprint headers
  for (const header of STRIP_HEADERS) {
    delete headers[header];
    delete headers[header.toLowerCase()];
    // Also try capitalized versions
    const capitalized = header.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('-');
    delete headers[capitalized];
  }

  // Inject consistent fingerprint headers
  if (storedFingerprint) {
    const fp = storedFingerprint.fingerprint || storedFingerprint;
    const userAgent = fp.userAgent || fp.navigator?.userAgent;

    if (userAgent) {
      headers['User-Agent'] = userAgent;
      headers['user-agent'] = userAgent;
    }

    // Windows Desktop Chrome headers
    headers['Sec-CH-UA'] = '"Chromium";v="121", "Not A Brand";v="99"';
    headers['Sec-CH-UA-Mobile'] = '?0';
    headers['Sec-CH-UA-Platform'] = '"Windows"';
  }

  return headers;
}

/**
 * Parse Set-Cookie headers for browser context injection
 */
function parseSetCookieHeaders(setCookieHeaders, url) {
  if (!setCookieHeaders) return [];

  const cookies = [];
  const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];

  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname;

    for (const cookieStr of headers) {
      try {
        const parts = cookieStr.split(';').map(p => p.trim());
        const [nameValue, ...attributes] = parts;
        const [name, ...valueParts] = nameValue.split('=');
        const value = valueParts.join('=');

        const cookie = {
          name: name.trim(),
          value: value,
          domain: domain,
          path: '/'
        };

        // Parse attributes
        for (const attr of attributes) {
          const [attrName, attrValue] = attr.split('=').map(s => s?.trim());
          const attrLower = attrName?.toLowerCase();

          if (attrLower === 'domain' && attrValue) {
            cookie.domain = attrValue.startsWith('.') ? attrValue : `.${attrValue}`;
          } else if (attrLower === 'path' && attrValue) {
            cookie.path = attrValue;
          } else if (attrLower === 'secure') {
            cookie.secure = true;
          } else if (attrLower === 'httponly') {
            cookie.httpOnly = true;
          } else if (attrLower === 'samesite' && attrValue) {
            cookie.sameSite = attrValue;
          } else if (attrLower === 'expires' && attrValue) {
            cookie.expires = new Date(attrValue).getTime() / 1000;
          } else if (attrLower === 'max-age' && attrValue) {
            cookie.expires = Date.now() / 1000 + parseInt(attrValue, 10);
          }
        }

        cookies.push(cookie);
      } catch (e) {
        // Skip malformed cookie
      }
    }
  } catch (e) {
    console.warn('[NetworkRouter] Cookie parse error:', e.message);
  }

  return cookies;
}

/**
 * Perform proxied HTTP fetch
 */
async function proxiedFetch(url, options = {}) {
  const proxyConfig = proxyManager.getHttpProxyConfig();

  if (!proxyConfig) {
    throw new Error('No proxy available for checkout request');
  }

  // Build proxy URL
  const proxyUrl = proxyConfig.auth
    ? `http://${proxyConfig.auth}@${proxyConfig.host}:${proxyConfig.port}`
    : `http://${proxyConfig.host}:${proxyConfig.port}`;

  // Create appropriate agent based on target URL protocol
  const isHttps = url.startsWith('https://');
  const agent = isHttps
    ? new HttpsProxyAgent(proxyUrl, { rejectUnauthorized: false }) // Allow Bright Data SSL
    : new HttpProxyAgent(proxyUrl);

  // Dynamic import of node-fetch for ESM compatibility
  const fetch = (await import('node-fetch')).default;

  const response = await fetch(url, {
    ...options,
    agent,
    headers: sanitizeHeaders(options.headers || {}),
    redirect: 'manual' // Handle redirects manually to preserve cookies
  });

  return response;
}

/**
 * Attach network router to browser context
 * @param {import('playwright').BrowserContext} context - Playwright browser context
 * @param {object} fingerprint - Generated fingerprint for header consistency
 */
export async function attachNetworkRouter(context, fingerprint = null) {
  storedFingerprint = fingerprint;

  console.log('[NetworkRouter] 🌐 Attaching context-aware routing...');

  // Route all requests through our handler
  await context.route('**/*', async (route, request) => {
    const url = request.url();
    const method = request.method();
    const resourceType = request.resourceType();

    try {
      // Static assets always bypass proxy
      if (isStaticAsset(url)) {
        if (isCheckoutPhase && shouldUseProxy(url)) {
          console.log(`[NetworkRouter] ⚡ Static asset bypassed: ${url.split('/').pop()}`);
        }
        return route.continue();
      }

      // Check if this request should use proxy
      if (shouldUseProxy(url)) {
        console.log(`[NetworkRouter] 🔄 Proxying ${method}: ${url.substring(0, 80)}...`);

        try {
          // Get original request data
          const headers = request.headers();
          const postData = request.postData();

          // Perform proxied fetch
          const response = await proxiedFetch(url, {
            method,
            headers,
            body: postData || undefined
          });

          // Get response data
          const arrayBuffer = await response.arrayBuffer();
          const body = Buffer.from(arrayBuffer);
          const responseHeaders = {};
          response.headers.forEach((value, key) => {
            // Skip problematic headers
            if (!['content-encoding', 'transfer-encoding', 'connection'].includes(key.toLowerCase())) {
              responseHeaders[key] = value;
            }
          });

          // Sync cookies to browser context
          const setCookies = response.headers.raw()['set-cookie'];
          if (setCookies && setCookies.length > 0) {
            const cookies = parseSetCookieHeaders(setCookies, url);
            if (cookies.length > 0) {
              await context.addCookies(cookies);
              console.log(`[NetworkRouter] 🍪 Synced ${cookies.length} cookies from proxied response`);
            }
          }

          // Record success
          const currentProxy = proxyManager.getCurrentProxy();
          if (currentProxy) {
            proxyManager.recordSuccess(currentProxy.url);
          }

          // Fulfill with proxied response
          await route.fulfill({
            status: response.status,
            headers: responseHeaders,
            body
          });

          return;
        } catch (proxyError) {
          console.error(`[NetworkRouter] ❌ Proxy fetch failed: ${proxyError.message}`);

          // Record failure and potentially rotate
          const currentProxy = proxyManager.getCurrentProxy();
          if (currentProxy) {
            proxyManager.recordFailure(currentProxy.url);

            // Check if we should rotate
            if (proxyError.message.includes('403') || proxyError.message.includes('429')) {
              proxyManager.markProxyBlocked(currentProxy.url);
              proxyManager.getNextProxy();
            }
          }

          // Fallback to direct for this request
          console.log('[NetworkRouter] ⚠️ Falling back to direct connection for this request');
          return route.continue();
        }
      }

      // Default: continue with direct connection
      return route.continue();

    } catch (error) {
      console.error(`[NetworkRouter] Route error: ${error.message}`);
      return route.continue();
    }
  });

  console.log('[NetworkRouter] ✅ Network routing active (Default: Direct)');
}

/**
 * Enter checkout phase - activates proxy routing for checkout URLs
 */
export function enterCheckoutPhase() {
  // DISABLED: We now use Global Browser Proxy for everything.
  // Manual interception via node-fetch is no longer needed/desired.
  if (!isCheckoutPhase) {
    // isCheckoutPhase = true; // KEEP FALSE to disable routing
    console.log('[NetworkRouter] ℹ️ Checkout Phase started (Native Browser Proxy active). Routing disabled.');
  }
}

/**
 * Exit checkout phase - returns to direct connection
 */
export function exitCheckoutPhase() {
  if (isCheckoutPhase) {
    isCheckoutPhase = false;
    console.log('[NetworkRouter] 🌐 Returning to Direct Connection...');
  }
}

/**
 * Check if currently in checkout phase
 */
export function isInCheckoutPhase() {
  return isCheckoutPhase;
}

/**
 * Update stored fingerprint (for header injection)
 */
export function setFingerprint(fingerprint) {
  storedFingerprint = fingerprint;
}

export default {
  attachNetworkRouter,
  enterCheckoutPhase,
  exitCheckoutPhase,
  isInCheckoutPhase,
  setFingerprint
};
