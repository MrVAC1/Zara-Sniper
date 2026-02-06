import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { URL } from 'url';
import { HttpsProxyAgent } from 'https-proxy-agent';
dotenv.config();

class ProxyManager {
  constructor() {
    this.proxies = [];           // Browser Proxies (ips-isp_proxy.txt)
    this.telegramProxies = [];   // Telegram Proxies (Webshare)
    this.currentIndex = -1;      // Current Browser proxy index
    this.blockedProxies = new Map();
    this.proxyStats = new Map();

    this.maxRetries = parseInt(process.env.PROXY_MAX_RETRIES) || 3;
    this.cooldownMs = parseInt(process.env.PROXY_COOLDOWN_MS) || 300000;

    this.loadProxies();
  }

  // Test proxy connectivity with timeout
  async testProxy(proxyUrl, timeout = 5000) {
    const agent = new HttpsProxyAgent(proxyUrl, { timeout });

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch('https://api.telegram.org', {
        method: 'HEAD',
        agent,
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      return response.ok;
    } catch (err) {
      const errorCode = err.code || err.name || 'UNKNOWN';
      console.error(`[ProxyManager] Proxy test failed (${errorCode}): ${err.message}`);
      return false;
    }
  }

  loadProxies() {
    try {
      // 1. Load BROWSER Proxies (ips-isp_proxy.txt ONLY)
      const browserProxyPath = path.join(process.cwd(), 'ips-isp_proxy.txt');
      if (fs.existsSync(browserProxyPath)) {
        console.log(`[ProxyManager] 📂 Found Browser proxy file: ${browserProxyPath}`);
        const content = fs.readFileSync(browserProxyPath, 'utf-8');
        this.proxies = this._parseProxies(content);
        console.log(`[ProxyManager] ✅ Loaded ${this.proxies.length} Browser proxies.`);
      } else {
        console.warn('[ProxyManager] ⚠️ ips-isp_proxy.txt not found. Browser will be offline or direct (if allowed).');
      }

      // 2. Load TELEGRAM Proxies (Webshare 10 proxies.txt ONLY)
      const telegramProxyPath = path.join(process.cwd(), 'Webshare 10 proxies.txt');
      if (fs.existsSync(telegramProxyPath)) {
        console.log(`[ProxyManager] 📂 Found Telegram proxy file: ${telegramProxyPath}`);
        const content = fs.readFileSync(telegramProxyPath, 'utf-8');
        this.telegramProxies = this._parseProxies(content);
        console.log(`[ProxyManager] ✅ Loaded ${this.telegramProxies.length} Telegram proxies.`);
      } else {
        console.error('[ProxyManager] ❌ "Webshare 10 proxies.txt" missing! Telegram cannot start in Strict Mode.');
      }

    } catch (error) {
      console.error(`[ProxyManager] Failed to load proxies: ${error.message}`);
    }
  }

  _parseProxies(rawText) {
    return rawText
      .split('\n')
      .map(p => p.trim())
      .filter(p => p && !p.startsWith('#'))
      .map((proxyRaw, index) => {
        try {
          let proxyUrl = proxyRaw;

          // Handle IP:PORT:USER:PASS format (Webshare format)
          const parts = proxyRaw.split(':');
          if (parts.length === 4) {
            const ip = parts[0].trim();
            const port = parts[1].trim();
            const user = parts[2].trim();
            const pass = parts[3].trim();

            // Validate IP structure
            if (ip.match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/)) {
              proxyUrl = `http://${user}:${pass}@${ip}:${port}`;
              console.log(`[ProxyManager] ✓ Parsed proxy: http://${user}:***@${ip}:${port}`);
            }
          } else {
            // Auto-prefix http if missing for other formats
            if (!proxyUrl.startsWith('http') && !proxyUrl.startsWith('socks')) {
              proxyUrl = `http://${proxyUrl}`;
            }
          }

          const url = new URL(proxyUrl);
          const config = {
            url: proxyUrl,
            server: `${url.protocol}//${url.hostname}:${url.port}`,
            username: decodeURIComponent(url.username || ''),
            password: decodeURIComponent(url.password || ''),
            masked: `${url.protocol}//${url.username ? '***:***@' : ''}${url.hostname}:${url.port}`
          };
          this.proxyStats.set(proxyUrl, { success: 0, failures: 0, blocks: 0 });
          return config;
        } catch (e) {
          console.warn(`[ProxyManager] Failed to parse proxy line ${index + 1}: ${e.message}`);
          return null;
        }
      })
      .filter(Boolean);
  }

  getCurrentProxy() {
    if (this.currentIndex < 0 || this.proxies.length === 0) return null;
    return this.proxies[this.currentIndex];
  }

  getNextProxy() {
    if (this.proxies.length === 0) return null;

    const now = Date.now();
    for (let i = 0; i < this.proxies.length; i++) {
      this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
      const proxy = this.proxies[this.currentIndex];

      const unblockTime = this.blockedProxies.get(proxy.url);
      if (unblockTime && now < unblockTime) {
        continue;
      }

      if (unblockTime) {
        this.blockedProxies.delete(proxy.url);
        console.log(`[ProxyManager] ♻️ ${proxy.masked} cooldown expired.`);
      }

      console.log(`[ProxyManager] 🔄 Selected Browser Proxy #${this.currentIndex + 1}: ${proxy.masked}`);
      return proxy;
    }

    console.error('[ProxyManager] ❌ All Browser Proxies in cooldown!');
    return null;
  }

  // STRICT: Telegram Proxy Rotation (Webshare ONLY)
  telegramProxyIndex = 0;

  getTelegramProxy() {
    if (this.telegramProxies.length === 0) {
      throw new Error('No Telegram proxies available in "Webshare 10 proxies.txt"');
    }
    // Return first proxy on initial call
    return this.telegramProxies[0];
  }

  getNextTelegramProxy() {
    if (this.telegramProxies.length === 0) {
      throw new Error('FATAL: All Telegram proxies exhausted. No fallback allowed.');
    }

    // Rotate to next Telegram proxy
    this.telegramProxyIndex = (this.telegramProxyIndex + 1) % this.telegramProxies.length;
    const proxy = this.telegramProxies[this.telegramProxyIndex];

    console.log(`[ProxyManager] 🔄 Telegram Proxy #${this.telegramProxyIndex + 1}/${this.telegramProxies.length}: ${proxy.masked}`);
    return proxy;
  }

  getBrowserProxy(index = 0) {
    if (this.proxies.length === 0) return null;
    return this.proxies[index % this.proxies.length];
  }

  markProxyBlocked(proxyUrl) {
    const unblockTime = Date.now() + this.cooldownMs;
    this.blockedProxies.set(proxyUrl, unblockTime);
    const stats = this.proxyStats.get(proxyUrl);
    if (stats) stats.blocks++;

    const proxy = this.proxies.find(p => p.url === proxyUrl);
    console.error(`[ProxyManager] 🚫 Proxy ${proxy?.masked || proxyUrl} BLOCKED.`);
  }

  recordSuccess(proxyUrl) {
    const stats = this.proxyStats.get(proxyUrl);
    if (stats) stats.success++;
  }

  recordFailure(proxyUrl) {
    const stats = this.proxyStats.get(proxyUrl);
    if (stats) stats.failures++;
  }

  getHttpProxyConfig() {
    const proxy = this.getCurrentProxy();
    if (!proxy) return null;
    try {
      const url = new URL(proxy.url);
      return {
        host: url.hostname,
        port: url.port || (url.protocol === 'https:' ? '443' : '80'),
        auth: proxy.username && proxy.password ? `${proxy.username}:${proxy.password}` : undefined,
        protocol: url.protocol
      };
    } catch (e) { return null; }
  }
}

export const proxyManager = new ProxyManager();
