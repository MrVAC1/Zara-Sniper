import fs from 'fs';
import path from 'path';

class ProxyManager {
  constructor() {
    this.proxies = [];
    this.currentIndex = 0;
    this.proxyFile = 'Webshare 10 proxies.txt';
    this.loadProxies();
  }

  loadProxies() {
    try {
      const filePath = path.join(process.cwd(), this.proxyFile);
      if (!fs.existsSync(filePath)) {
        console.warn(`[ProxyManager] ⚠️ Proxy file not found: ${this.proxyFile}. Using direct connection.`);
        return;
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      // Filter empty lines and parse
      this.proxies = content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && line.includes(':'))
        .map(line => {
          const parts = line.split(':');
          if (parts.length >= 2) {
            // Format: IP:PORT:USER:PASS
            return {
              server: `http://${parts[0]}:${parts[1]}`,
              username: parts[2] || '',
              password: parts[3] || ''
            };
          }
          return null;
        })
        .filter(p => p !== null);

      console.log(`[ProxyManager] Loaded ${this.proxies.length} proxies.`);
    } catch (error) {
      console.error(`[ProxyManager] Failed to load proxies: ${error.message}`);
    }
  }

  getCurrentProxy() {
    if (this.proxies.length === 0) return null;
    return this.proxies[this.currentIndex];
  }

  getNextProxy() {
    if (this.proxies.length === 0) return null;
    this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
    const proxy = this.proxies[this.currentIndex];
    console.log(`[ProxyManager] 🔄 Rotating to proxy #${this.currentIndex + 1}: ${proxy.server}`);
    return proxy;
  }

  // Helper for Playwright format
  getPlaywrightProxy() {
    const proxy = this.getCurrentProxy();
    if (!proxy) return undefined;

    return {
      server: proxy.server,
      username: proxy.username,
      password: proxy.password
    };
  }
}

// Singleton instance
export const proxyManager = new ProxyManager();
