import dotenv from 'dotenv';
dotenv.config();

class ProxyManager {
  constructor() {
    this.proxies = [];           // Array of proxy configs
    this.currentIndex = -1;      // Current proxy index (-1 = none/direct)
    this.blockedProxies = new Map(); // proxyUrl -> unblock timestamp
    this.proxyStats = new Map(); // proxyUrl -> { success: 0, failures: 0 }

    this.maxRetries = parseInt(process.env.PROXY_MAX_RETRIES) || 3;
    this.cooldownMs = parseInt(process.env.PROXY_COOLDOWN_MS) || 300000; // 5min default

    this.loadProxies();
  }

  loadProxies() {
    try {
      const proxyListEnv = process.env.PROXY_LIST?.trim();

      if (!proxyListEnv) {
        console.log('[ProxyManager] No PROXY_LIST configured. Using direct connection.');
        return;
      }

      // Parse comma-separated proxy list
      const proxyStrings = proxyListEnv.split(',').map(p => p.trim()).filter(Boolean);

      this.proxies = proxyStrings.map((proxyUrl, index) => {
        try {
          const url = new URL(proxyUrl);
          const config = {
            url: proxyUrl,
            server: `${url.protocol}//${url.host}`,
            username: url.username || '',
            password: url.password || '',
            masked: `${url.protocol}//${url.username ? '***:***@' : ''}${url.host}`
          };

          // Initialize stats
          this.proxyStats.set(proxyUrl, { success: 0, failures: 0, blocks: 0 });

          return config;
        } catch (e) {
          console.error(`[ProxyManager] Invalid proxy format at index ${index}: ${proxyUrl}`);
          return null;
        }
      }).filter(Boolean);

      console.log(`[ProxyManager] ✅ Loaded ${this.proxies.length} proxies from ENV.`);
      this.proxies.forEach((p, i) => {
        console.log(`  [${i + 1}] ${p.masked}`);
      });
    } catch (error) {
      console.error(`[ProxyManager] Failed to load proxies: ${error.message}`);
    }
  }

  /**
   * Get current active proxy
   */
  getCurrentProxy() {
    if (this.currentIndex < 0 || this.proxies.length === 0) return null;
    return this.proxies[this.currentIndex];
  }

  /**
   * Get next healthy proxy from pool
   * Skips blocked proxies (in cooldown)
   */
  getNextProxy() {
    if (this.proxies.length === 0) return null;

    const startIndex = this.currentIndex;
    const now = Date.now();

    // Try each proxy in round-robin order
    for (let i = 0; i < this.proxies.length; i++) {
      this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
      const proxy = this.proxies[this.currentIndex];

      // Check if proxy is in cooldown
      const unblockTime = this.blockedProxies.get(proxy.url);
      if (unblockTime && now < unblockTime) {
        const remainingSec = Math.ceil((unblockTime - now) / 1000);
        console.log(`[ProxyManager] ⏭️ Skipping ${proxy.masked} (cooldown: ${remainingSec}s remaining)`);
        continue;
      }

      // Remove from cooldown if time expired
      if (unblockTime) {
        this.blockedProxies.delete(proxy.url);
        console.log(`[ProxyManager] ♻️ ${proxy.masked} cooldown expired, back in rotation`);
      }

      console.log(`[ProxyManager] 🔄 Selected proxy #${this.currentIndex + 1}: ${proxy.masked}`);
      return proxy;
    }

    // All proxies are blocked
    console.error('[ProxyManager] ❌ All proxies are in cooldown! Using direct connection.');
    this.currentIndex = -1;
    return null;
  }

  /**
   * Mark proxy as blocked and add to cooldown
   */
  markProxyBlocked(proxyUrl) {
    const unblockTime = Date.now() + this.cooldownMs;
    this.blockedProxies.set(proxyUrl, unblockTime);

    // Update stats
    const stats = this.proxyStats.get(proxyUrl);
    if (stats) {
      stats.blocks++;
    }

    const proxy = this.proxies.find(p => p.url === proxyUrl);
    const masked = proxy?.masked || proxyUrl;

    console.error(`[ProxyManager] 🚫 Proxy ${masked} marked as BLOCKED (cooldown: ${this.cooldownMs / 1000}s)`);
  }

  /**
   * Record successful request for proxy
   */
  recordSuccess(proxyUrl) {
    const stats = this.proxyStats.get(proxyUrl);
    if (stats) {
      stats.success++;
    }
  }

  /**
   * Record failed request for proxy
   */
  recordFailure(proxyUrl) {
    const stats = this.proxyStats.get(proxyUrl);
    if (stats) {
      stats.failures++;
    }
  }

  /**
   * Get health status for all proxies
   */
  getProxyHealth() {
    return this.proxies.map((proxy, index) => {
      const stats = this.proxyStats.get(proxy.url) || { success: 0, failures: 0, blocks: 0 };
      const unblockTime = this.blockedProxies.get(proxy.url);
      const inCooldown = unblockTime && Date.now() < unblockTime;
      const cooldownRemaining = inCooldown ? Math.ceil((unblockTime - Date.now()) / 1000) : 0;

      const totalRequests = stats.success + stats.failures;
      const successRate = totalRequests > 0 ? ((stats.success / totalRequests) * 100).toFixed(1) : 'N/A';

      return {
        index: index + 1,
        masked: proxy.masked,
        active: this.currentIndex === index,
        blocked: inCooldown,
        cooldownSec: cooldownRemaining,
        stats: {
          success: stats.success,
          failures: stats.failures,
          blocks: stats.blocks,
          successRate: successRate
        }
      };
    });
  }

  /**
   * Helper for Playwright format
   */
  getPlaywrightProxy() {
    const proxy = this.getCurrentProxy();
    if (!proxy) return undefined;

    return {
      server: proxy.server,
      username: proxy.username,
      password: proxy.password
    };
  }

  /**
   * Get proxy config for HTTP-level fetch (networkRouter)
   * Used by https-proxy-agent and http-proxy-agent
   */
  getHttpProxyConfig() {
    const proxy = this.getCurrentProxy();
    if (!proxy) return null;

    try {
      const url = new URL(proxy.url);
      return {
        host: url.hostname,
        port: url.port || (url.protocol === 'https:' ? '443' : '80'),
        auth: proxy.username && proxy.password
          ? `${proxy.username}:${proxy.password}`
          : undefined,
        protocol: url.protocol
      };
    } catch (e) {
      console.error('[ProxyManager] Failed to parse proxy URL:', e.message);
      return null;
    }
  }
}

// Singleton instance
export const proxyManager = new ProxyManager();
