(function () {
  'use strict';

  // ============================================================
  // 1. WEBDRIVER REMOVAL (AGGRESSIVE - Multiple layers)
  // ============================================================

  // Method 1: Delete from Navigator prototype
  try {
    const navigatorProto = Object.getPrototypeOf(navigator);
    delete navigatorProto.webdriver;
  } catch (e) { }

  // Method 2: Override getter on navigator
  try {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
      configurable: true,
      enumerable: false  // Hide from enumeration
    });
  } catch (e) { }

  // Method 3: Override Object.getOwnPropertyDescriptor for webdriver
  const origGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
  Object.getOwnPropertyDescriptor = function (obj, prop) {
    if (prop === 'webdriver' && obj === navigator) {
      return undefined;
    }
    return origGetOwnPropertyDescriptor.call(this, obj, prop);
  };
  try {
    Object.getOwnPropertyDescriptor.toString = () => 'function getOwnPropertyDescriptor() { [native code] }';
  } catch (e) { }

  // ============================================================
  // 2. NAVIGATOR PROPERTIES
  // ============================================================
  const navOverrides = {
    hardwareConcurrency: 8,
    deviceMemory: 8,
    platform: 'Win32',
    vendor: 'Google Inc.',
    language: 'uk-UA',
    maxTouchPoints: 0,
    pdfViewerEnabled: true,
    cookieEnabled: true,
    doNotTrack: null,
    onLine: true
  };

  Object.keys(navOverrides).forEach(prop => {
    try {
      Object.defineProperty(navigator, prop, {
        get: () => navOverrides[prop],
        configurable: true,
        enumerable: true
      });
    } catch (e) { }
  });

  // Languages array
  try {
    Object.defineProperty(navigator, 'languages', {
      get: () => Object.freeze(['uk-UA', 'uk', 'en-US', 'en']),
      configurable: true
    });
  } catch (e) { }

  // ============================================================
  // 3. SCREEN PROPERTIES (Disabled to match Device Native Resolution)
  // ============================================================
  /*
  const screenOverrides = {
    width: 1920,
    height: 1080,
    availWidth: 1920,
    availHeight: 1040,
    colorDepth: 24,
    pixelDepth: 24,
    orientation: { type: 'landscape-primary', angle: 0 }
  };

  Object.keys(screenOverrides).forEach(prop => {
    if (prop === 'orientation') return;
    try {
      Object.defineProperty(screen, prop, {
        get: () => screenOverrides[prop],
        configurable: true
      });
    } catch(e) {}
  });
  */

  // ============================================================
  // 4. CHROME RUNTIME (Complete emulation for anti-detection)
  // ============================================================
  if (!window.chrome) {
    window.chrome = {};
  }

  // chrome.app - CreepJS checks for this
  if (!window.chrome.app) {
    window.chrome.app = {
      isInstalled: false,
      InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
      RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
      getDetails: function () { return null; },
      getIsInstalled: function () { return false; },
      installState: function (callback) {
        if (callback) callback('not_installed');
      },
      runningState: function () { return 'cannot_run'; }
    };
  }

  // chrome.runtime - must have specific structure
  if (!window.chrome.runtime) {
    window.chrome.runtime = {
      connect: function (extensionId, connectInfo) {
        return {
          name: '',
          sender: undefined,
          onMessage: { addListener: function () { }, removeListener: function () { }, hasListener: function () { return false; } },
          onDisconnect: { addListener: function () { }, removeListener: function () { }, hasListener: function () { return false; } },
          postMessage: function () { },
          disconnect: function () { }
        };
      },
      sendMessage: function (extensionId, message, options, responseCallback) {
        if (typeof responseCallback === 'function') {
          responseCallback(undefined);
        }
      },
      getManifest: function () { return undefined; },
      getURL: function (path) { return ''; },
      id: undefined,
      onConnect: { addListener: function () { }, removeListener: function () { }, hasListener: function () { return false; } },
      onMessage: { addListener: function () { }, removeListener: function () { }, hasListener: function () { return false; } },
      onInstalled: { addListener: function () { }, removeListener: function () { }, hasListener: function () { return false; } },
      PlatformOs: { MAC: 'mac', WIN: 'win', ANDROID: 'android', CROS: 'cros', LINUX: 'linux', OPENBSD: 'openbsd' },
      PlatformArch: { ARM: 'arm', ARM64: 'arm64', X86_32: 'x86-32', X86_64: 'x86-64', MIPS: 'mips', MIPS64: 'mips64' },
      PlatformNaclArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64', MIPS: 'mips', MIPS64: 'mips64' },
      RequestUpdateCheckStatus: { THROTTLED: 'throttled', NO_UPDATE: 'no_update', UPDATE_AVAILABLE: 'update_available' },
      OnInstalledReason: { INSTALL: 'install', UPDATE: 'update', CHROME_UPDATE: 'chrome_update', SHARED_MODULE_UPDATE: 'shared_module_update' },
      OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' }
    };
  }

  // chrome.webstore - deprecated but some checks look for it
  if (!window.chrome.webstore) {
    window.chrome.webstore = undefined;
  }

  // chrome.csi - timing info (CreepJS checks this)
  window.chrome.csi = function () {
    return {
      startE: Date.now(),
      onloadT: Date.now(),
      pageT: Math.floor(Math.random() * 1000) + 500,
      tran: 15
    };
  };

  // chrome.loadTimes - page load times (CreepJS checks this)  
  window.chrome.loadTimes = function () {
    return {
      commitLoadTime: Date.now() / 1000,
      connectionInfo: 'http/1.1',
      finishDocumentLoadTime: Date.now() / 1000,
      finishLoadTime: Date.now() / 1000,
      firstPaintAfterLoadTime: 0,
      firstPaintTime: Date.now() / 1000,
      navigationType: 'Other',
      npnNegotiatedProtocol: 'unknown',
      requestTime: Date.now() / 1000 - 0.1,
      startLoadTime: Date.now() / 1000,
      wasAlternateProtocolAvailable: false,
      wasFetchedViaSpdy: false,
      wasNpnNegotiated: false
    };
  };

  // Make chrome functions look native
  try {
    window.chrome.csi.toString = () => 'function csi() { [native code] }';
    window.chrome.loadTimes.toString = () => 'function loadTimes() { [native code] }';
  } catch (e) { }

  // ============================================================
  // 5. WEBGL - Use REAL GPU values, don't spoof to different GPU
  // CreepJS detects mismatches between reported GPU and actual rendering
  // ============================================================

  const webglProtos = [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype];

  webglProtos.forEach(proto => {
    const origGetExtension = proto.getExtension;
    proto.getExtension = function (name) {
      const ext = origGetExtension.call(this, name);
      // Ensure WEBGL_debug_renderer_info returns proper extension
      if (name === 'WEBGL_debug_renderer_info' && !ext) {
        return {
          UNMASKED_VENDOR_WEBGL: 0x9245,
          UNMASKED_RENDERER_WEBGL: 0x9246
        };
      }
      return ext;
    };
  });

  // ============================================================
  // 6. CANVAS NOISE
  // ============================================================
  let noiseSeed = Date.now() % 1000000;
  const noise = () => {
    noiseSeed = Math.imul(noiseSeed ^ (noiseSeed >>> 15), 0x1CE4E5B9);
    return ((noiseSeed ^ (noiseSeed >>> 16)) >>> 0) / 4294967296;
  };

  const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
  CanvasRenderingContext2D.prototype.getImageData = function (x, y, w, h) {
    const data = origGetImageData.call(this, x, y, w, h);
    if (data.data.length >= 4) {
      data.data[0] = Math.max(0, Math.min(255, data.data[0] + Math.floor(noise() * 2) - 1));
    }
    return data;
  };

  // ============================================================
  // 7. WORKER PROTECTION  
  // ============================================================
  const WORKER_STEALTH = 'try{Object.defineProperty(navigator,"webdriver",{get:()=>undefined});Object.defineProperty(navigator,"hardwareConcurrency",{get:()=>8});Object.defineProperty(navigator,"deviceMemory",{get:()=>8});}catch(e){}';

  const OrigWorker = window.Worker;
  window.Worker = function (url, opts) {
    if (typeof url === 'string' && !url.startsWith('blob:') && !url.startsWith('data:')) {
      try {
        const blob = new Blob([WORKER_STEALTH + ';importScripts("' + url + '");'], { type: 'application/javascript' });
        url = URL.createObjectURL(blob);
      } catch (e) { }
    }
    return new OrigWorker(url, opts);
  };
  window.Worker.prototype = OrigWorker.prototype;

  // ============================================================
  // 8. AUTOMATION MARKERS REMOVAL
  // ============================================================
  const autoMarkers = [
    '__playwright', '__pw_manual', '__puppeteer', '__selenium',
    '__webdriver_evaluate', '__webdriver_script_fn', '__webdriver_unwrapped',
    '_phantom', 'callPhantom', '_Selenium_IDE_Recorder', 'domAutomation',
    'domAutomationController', '__nightmare', 'webdriver', 'driver',
    'cdc_adoQpoasnfa76pfcZLmcfl_Array', 'cdc_adoQpoasnfa76pfcZLmcfl_Promise',
    'cdc_adoQpoasnfa76pfcZLmcfl_Symbol'
  ];

  autoMarkers.forEach(m => {
    try {
      if (m in window) delete window[m];
    } catch (e) { }
    try {
      Object.defineProperty(window, m, {
        get: () => undefined,
        configurable: true
      });
    } catch (e) { }
  });

  // Also check document
  try {
    if (document.$cdc_asdjflasutopfhvcZLmcfl_) {
      delete document.$cdc_asdjflasutopfhvcZLmcfl_;
    }
  } catch (e) { }

  // ============================================================
  // 9. PERMISSIONS API
  // ============================================================
  if (navigator.permissions && navigator.permissions.query) {
    const origQuery = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = function (desc) {
      if (desc && desc.name === 'notifications') {
        return Promise.resolve({ state: 'granted', onchange: null });
      }
      return origQuery(desc);
    };
  }

  // ============================================================
  // 10. PLUGINS (Robust Proxy Fix)
  // ============================================================
  const mockPlugins = [
    { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
    { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: 'Portable Document Format' },
    { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' }
  ];

  try {
    Object.defineProperty(navigator, 'plugins', {
      get: () => {
        const p = Object.create(PluginArray.prototype);
        mockPlugins.forEach((pl, i) => {
          const plugin = Object.create(Plugin.prototype);
          Object.assign(plugin, pl);
          Object.defineProperty(p, i, { value: plugin, enumerable: true });
          Object.defineProperty(p, pl.name, { value: plugin, enumerable: true });
        });
        Object.defineProperty(p, 'length', { get: () => mockPlugins.length });
        return p;
      },
      configurable: true
    });
  } catch (e) { }

  // ============================================================
  // 11. USER_AGENT_DATA & VERSION SYNC (Chrome 144.0.7559.133)
  // ============================================================

  const UA_MAJOR = "144";
  const UA_FULL = "144.0.7559.133";

  const brands = [
    { brand: 'Google Chrome', version: UA_MAJOR },
    { brand: 'Chromium', version: UA_MAJOR },
    { brand: 'Not?A_Brand', version: '99' }
  ];

  const fullVersionList = [
    { brand: 'Google Chrome', version: UA_FULL },
    { brand: 'Chromium', version: UA_FULL },
    { brand: 'Not?A_Brand', version: '99.0.0.0' }
  ];

  // Complete navigator.userAgentData override
  const mockedUAData = {
    brands: brands,
    mobile: false,
    platform: 'Windows',
    getHighEntropyValues: (hints) => Promise.resolve({
      brands: brands,
      mobile: false,
      platform: 'Windows',
      architecture: 'x86',
      bitness: '64',
      model: '',
      platformVersion: '10.0.0',
      uaFullVersion: UA_FULL,
      fullVersionList: fullVersionList
    }),
    toJSON: () => ({ brands, mobile: false, platform: 'Windows' })
  };

  try {
    Object.defineProperty(Navigator.prototype, 'userAgentData', {
      get: () => mockedUAData,
      configurable: true,
      enumerable: true
    });
  } catch (e) { }

  // AppVersion & UserAgent Sync
  try {
    Object.defineProperty(Navigator.prototype, 'userAgent', {
      get: () => `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${UA_MAJOR}.0.0.0 Safari/537.36`,
      configurable: true
    });

    Object.defineProperty(Navigator.prototype, 'appVersion', {
      get: () => `5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${UA_MAJOR}.0.0.0 Safari/537.36`,
      configurable: true
    });
  } catch (e) { }

  // ============================================================
  // 12. Additional Headless Fixes
  // ============================================================

  // Connection info - ensure not empty
  try {
    Object.defineProperty(navigator, 'connection', {
      get: () => ({
        effectiveType: '4g',
        rtt: 50,
        downlink: 10,
        saveData: false,
        type: 'wifi'
      }),
      configurable: true
    });
  } catch (e) { }

  // Battery API
  if (navigator.getBattery) {
    const origGetBattery = navigator.getBattery.bind(navigator);
    navigator.getBattery = function () {
      return origGetBattery().then(battery => {
        // Return real battery with slight modifications
        return {
          charging: true,
          chargingTime: 0,
          dischargingTime: Infinity,
          level: 0.95 + Math.random() * 0.05,
          onchargingchange: null,
          onchargingtimechange: null,
          ondischargingtimechange: null,
          onlevelchange: null
        };
      });
    };
  }

  console.log('[Stealth v4 (Extension)] ✅ Active');
})();
