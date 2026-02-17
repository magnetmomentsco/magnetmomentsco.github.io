/**
 * Magnet Moments Co. — Client-Side Analytics Tracker
 * ====================================================
 * Lightweight analytics for Firebase Realtime Database.
 * Loaded on every page; dynamically imports Firebase 9 compat SDK.
 *
 * Public API exposed on window.MMTracker:
 *   .track(event, data)        — log a custom event
 *   .getVariant(experimentName) — get A/B variant for visitor
 *   .getProductViews(handle)   — promise resolving to today's view count
 *
 * Fires `mm:tracker-ready` on document once Firebase is initialised.
 */
;(function () {
  'use strict';

  /* ──────────────────────────── 0. CONSTANTS ──────────────────────────── */

  var FIREBASE_CONFIG = {
    apiKey: 'FIREBASE_API_KEY',
    authDomain: 'magnetmoments-analytics.firebaseapp.com',
    databaseURL: 'https://magnetmoments-analytics-default-rtdb.firebaseio.com',
    projectId: 'magnetmoments-analytics',
    storageBucket: 'magnetmoments-analytics.appspot.com',
    messagingSenderId: '000000000000',
    appId: '1:000000000000:web:0000000000000000000000'
  };

  var FB_SDK_APP   = 'https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js';
  var FB_SDK_DB    = 'https://www.gstatic.com/firebasejs/9.23.0/firebase-database-compat.js';

  var BATCH_INTERVAL   = 30000;   // flush batched writes every 30 s
  var CLICK_THROTTLE   = 200;     // ms between tracked clicks
  var RAGE_WINDOW      = 500;     // ms window for rage-click detection
  var RAGE_MIN_CLICKS  = 3;
  var RAGE_RADIUS      = 50;      // px
  var SCROLL_DEBOUNCE  = 250;     // ms
  var INTENT_THRESHOLDS = { low: 5, medium: 10 }; // < low → low, < medium → medium, else high

  /* ──────────────────────────── 1. UTILITIES ──────────────────────────── */

  /** Generate a UUID v4 (crypto-safe with fallback). */
  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    // Fallback for older browsers
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  /** Today as YYYY-MM-DD. */
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  /** ISO timestamp. */
  function now() { return new Date().toISOString(); }

  /** Convert URL path to a Firebase-safe slug: `/shop/golden-girls/` → `shop-golden-girls` */
  function pageSlug(path) {
    return (path || location.pathname)
      .replace(/^\/|\/$/g, '')   // strip leading/trailing slashes
      .replace(/\//g, '-')       // slashes → dashes
      .replace(/[.#$\[\]]/g, '-') // Firebase-illegal chars
      || 'home';
  }

  /** Simple debounce. */
  function debounce(fn, ms) {
    var t;
    return function () {
      var ctx = this, args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, ms);
    };
  }

  /** Simple throttle (trailing-edge). */
  function throttle(fn, ms) {
    var last = 0;
    return function () {
      var n = Date.now();
      if (n - last >= ms) { last = n; fn.apply(this, arguments); }
    };
  }

  /** Truncate a string to `max` chars. */
  function trunc(s, max) {
    if (!s) return '';
    return s.length > max ? s.substring(0, max) : s;
  }

  /** Classify device from screen width. */
  function deviceType() {
    var w = window.innerWidth || screen.width;
    if (w < 768) return 'mobile';
    if (w < 1024) return 'tablet';
    return 'desktop';
  }

  /** Read connection info if available. */
  function connectionSpeed() {
    var c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!c) return 'unknown';
    return c.effectiveType || c.type || 'unknown';
  }

  /** Extract UTM parameters from the current URL. */
  function utmParams() {
    var params = new URLSearchParams(location.search);
    return {
      source:   params.get('utm_source')   || null,
      medium:   params.get('utm_medium')   || null,
      campaign: params.get('utm_campaign') || null,
      content:  params.get('utm_content')  || null,
      term:     params.get('utm_term')     || null
    };
  }

  /** Classify traffic source from referrer + UTM. */
  function trafficSource(utm) {
    if (utm.medium === 'cpc' || utm.medium === 'ppc' || utm.medium === 'paid') return 'paid';
    if (utm.source) return 'referral'; // has utm_source but not paid → treat as referral/campaign

    var ref = document.referrer;
    if (!ref) return 'direct';

    var host;
    try { host = new URL(ref).hostname; } catch (_) { return 'direct'; }
    if (host === location.hostname) return 'direct'; // internal

    var searchEngines = /google\.|bing\.|yahoo\.|duckduckgo\.|baidu\.|yandex\./i;
    if (searchEngines.test(host)) return 'organic';

    var socials = /facebook\.|instagram\.|twitter\.|x\.com|tiktok\.|pinterest\.|linkedin\.|youtube\.|threads\.net|reddit\./i;
    if (socials.test(host)) return 'social';

    return 'referral';
  }

  /** Simple FNV-1a 32-bit hash used for A/B bucketing. */
  function fnv1a(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0; // unsigned
  }

  /* ──────────────────────── 2. STATE & STORAGE ────────────────────────── */

  var state = {
    visitorId:   null,
    sessionId:   null,
    sessionStart: null,
    pagesViewed: 0,
    intentScore: 0,
    slug:        pageSlug(),
    date:        today(),
    dnt:         false,    // Do Not Track active
    isAdmin:     false,    // on /admin/ page
    fbReady:     false,
    db:          null,     // Firebase database ref
    batchQueue:  [],       // pending writes
    scrollFired: {}        // threshold → boolean
  };

  /** Initialise or retrieve the persistent visitor ID. */
  function initVisitor() {
    var stored = null;
    try { stored = localStorage.getItem('mm_vid'); } catch (_) {}
    if (stored) { state.visitorId = stored; return; }
    state.visitorId = uuid();
    try { localStorage.setItem('mm_vid', state.visitorId); } catch (_) {}
  }

  /** Initialise or retrieve session. */
  function initSession() {
    var sid = null;
    try { sid = sessionStorage.getItem('mm_sid'); } catch (_) {}
    if (sid) {
      state.sessionId = sid;
      state.sessionStart = Number(sessionStorage.getItem('mm_sstart')) || Date.now();
      state.pagesViewed  = Number(sessionStorage.getItem('mm_spv'))    || 0;
    } else {
      state.sessionId    = uuid();
      state.sessionStart = Date.now();
      state.pagesViewed  = 0;
      try {
        sessionStorage.setItem('mm_sid', state.sessionId);
        sessionStorage.setItem('mm_sstart', String(state.sessionStart));
      } catch (_) {}
    }
    state.pagesViewed++;
    try { sessionStorage.setItem('mm_spv', String(state.pagesViewed)); } catch (_) {}
  }

  /** Restore persisted intent score. */
  function initIntent() {
    try { state.intentScore = Number(localStorage.getItem('mm_intent')) || 0; } catch (_) {}
  }

  /* ─────────────────── 3. FIREBASE DYNAMIC LOADER ─────────────────────── */

  /**
   * Load a script tag returning a Promise.
   * Avoids duplicates by checking existing <script> srcs.
   */
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[src="' + src + '"]')) { resolve(); return; }
      var s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload  = resolve;
      s.onerror = function () { reject(new Error('Failed to load ' + src)); };
      document.head.appendChild(s);
    });
  }

  /** Load Firebase compat SDK then initialise app + database. */
  function initFirebase() {
    return loadScript(FB_SDK_APP)
      .then(function () { return loadScript(FB_SDK_DB); })
      .then(function () {
        /* Prevent double-init if another script already initialised Firebase */
        if (!firebase.apps.length) {
          firebase.initializeApp(FIREBASE_CONFIG);
        }
        state.db = firebase.database();
        state.fbReady = true;

        document.dispatchEvent(new CustomEvent('mm:tracker-ready'));
      });
  }

  /* ──────────────────────── 4. DATABASE HELPERS ───────────────────────── */

  /** Get a Firebase ref. */
  function ref(path) {
    return state.db.ref(path);
  }

  /** Atomic increment via transaction. */
  function increment(path) {
    return ref(path).transaction(function (val) { return (val || 0) + 1; });
  }

  /** Push to a list. */
  function pushData(path, data) {
    return ref(path).push(data);
  }

  /** Set data at path. */
  function setData(path, data) {
    return ref(path).set(data);
  }

  /** Queue a write operation to be flushed later (batching). */
  function enqueue(op) {
    state.batchQueue.push(op);
  }

  /** Flush all queued writes. */
  function flushBatch() {
    if (!state.fbReady || state.batchQueue.length === 0) return;
    var ops = state.batchQueue.splice(0);
    var updates = {};
    ops.forEach(function (op) {
      if (op.type === 'increment') {
        // Increments must use transactions — can't batch; run immediately
        increment(op.path);
      } else if (op.type === 'push') {
        var key = ref(op.path).push().key;
        updates[op.path + '/' + key] = op.data;
      } else if (op.type === 'set') {
        updates[op.path] = op.data;
      }
    });
    if (Object.keys(updates).length) {
      state.db.ref().update(updates);
    }
  }

  /** Use sendBeacon to flush on page unload (best-effort). */
  function flushBeacon() {
    if (!state.fbReady || state.batchQueue.length === 0) return;
    // sendBeacon can't talk to Firebase directly, so we flush remaining via REST
    var ops = state.batchQueue.splice(0);
    var updates = {};
    ops.forEach(function (op) {
      if (op.type === 'increment') {
        // Fallback: set instead of increment (lossy but best-effort on unload)
        updates[op.path] = { '.sv': 'increment', '_delta': 1 };
      } else if (op.type === 'push') {
        var key = 'bc_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
        updates[op.path + '/' + key] = op.data;
      } else if (op.type === 'set') {
        updates[op.path] = op.data;
      }
    });
    if (Object.keys(updates).length) {
      // Try Firebase REST API via sendBeacon
      var url = FIREBASE_CONFIG.databaseURL + '/.json';
      var blob = new Blob([JSON.stringify(updates)], { type: 'application/json' });
      try { navigator.sendBeacon(url, blob); } catch (_) {}
    }
  }

  /* ─────────────────────── 5. PAGE VIEW TRACKING ──────────────────────── */

  function trackPageView() {
    if (state.dnt) return;
    var utm = utmParams();
    var data = {
      url:       location.href,
      path:      location.pathname,
      title:     document.title,
      referrer:  document.referrer || null,
      timestamp: now(),
      sessionId: state.sessionId,
      visitorId: state.visitorId,
      device:    deviceType(),
      utm:       utm,
      source:    trafficSource(utm)
    };
    enqueue({ type: 'push', path: '/pageViews/' + state.date + '/' + state.slug, data: data });
    // Also increment a simple counter for social-proof product view counts
    increment('/productViewCounts/' + state.date + '/' + state.slug);
    // Intent: +1 per page view
    bumpIntent(1);
  }

  /* ─────────────────────── 6. LIVE PRESENCE ───────────────────────────── */

  function setupPresence() {
    if (state.dnt || !state.fbReady) return;
    var presRef = ref('/presence/' + state.visitorId);
    var connRef = ref('.info/connected');

    connRef.on('value', function (snap) {
      if (snap.val() === true) {
        presRef.onDisconnect().remove();
        presRef.set({
          page:      location.pathname,
          slug:      state.slug,
          device:    deviceType(),
          timestamp: firebase.database.ServerValue.TIMESTAMP
        });
      }
    });
  }

  /* ─────────────────────── 7. SCROLL DEPTH ────────────────────────────── */

  function setupScrollTracking() {
    if (state.dnt) return;
    state.scrollFired = {};
    var thresholds = [25, 50, 75, 100];

    var handler = debounce(function () {
      var scrollTop  = window.pageYOffset || document.documentElement.scrollTop;
      var docHeight  = Math.max(
        document.body.scrollHeight, document.documentElement.scrollHeight,
        document.body.offsetHeight, document.documentElement.offsetHeight
      );
      var winHeight  = window.innerHeight;
      var scrollable = docHeight - winHeight;
      if (scrollable <= 0) return;
      var pct = Math.round((scrollTop / scrollable) * 100);

      thresholds.forEach(function (t) {
        if (pct >= t && !state.scrollFired[t]) {
          state.scrollFired[t] = true;
          enqueue({ type: 'increment', path: '/scrollDepth/' + state.date + '/' + state.slug + '/' + t });
          if (t >= 75) bumpIntent(2); // intent bonus for deep scroll
        }
      });
    }, SCROLL_DEBOUNCE);

    window.addEventListener('scroll', handler, { passive: true });
  }

  /* ─────────────────────── 8. CLICK TRACKING ──────────────────────────── */

  /** Rage-click detector state. */
  var rageState = { clicks: [], timer: null };

  function setupClickTracking() {
    if (state.dnt) return;

    var handler = throttle(function (e) {
      var target = e.target || {};
      var vw = window.innerWidth || 1;
      var vh = window.innerHeight || 1;
      var data = {
        x:     Math.round((e.clientX / vw) * 10000) / 100,   // % with 2 decimals
        y:     Math.round((e.clientY / vh) * 10000) / 100,
        tag:   (target.tagName || '').toLowerCase(),
        cls:   trunc(target.className || '', 100),
        id:    target.id || null,
        text:  trunc((target.textContent || '').trim(), 50),
        ts:    now()
      };
      enqueue({ type: 'push', path: '/clicks/' + state.date + '/' + state.slug, data: data });

      // --- Rage-click detection ---
      detectRageClick(e.clientX, e.clientY);
    }, CLICK_THROTTLE);

    document.addEventListener('click', handler, true);
  }

  function detectRageClick(x, y) {
    var n = Date.now();
    rageState.clicks.push({ x: x, y: y, t: n });

    // Trim clicks outside the time window
    rageState.clicks = rageState.clicks.filter(function (c) { return n - c.t < RAGE_WINDOW; });

    if (rageState.clicks.length >= RAGE_MIN_CLICKS) {
      // Check if all clicks are within RAGE_RADIUS of each other
      var first = rageState.clicks[0];
      var allClose = rageState.clicks.every(function (c) {
        var dx = c.x - first.x, dy = c.y - first.y;
        return Math.sqrt(dx * dx + dy * dy) <= RAGE_RADIUS;
      });

      if (allClose) {
        enqueue({
          type: 'push',
          path: '/rageClicks/' + state.date + '/' + state.slug,
          data: {
            x:     first.x,
            y:     first.y,
            count: rageState.clicks.length,
            ts:    now()
          }
        });
        rageState.clicks = []; // reset after recording
      }
    }
  }

  /* ──────────────── 9. PRODUCT ENGAGEMENT FUNNEL ──────────────────────── */

  function setupFunnelListeners() {
    if (state.dnt) return;

    var events = [
      { name: 'mm:product-card-hover', key: 'product-card-hover', intentPts: 0 },
      { name: 'mm:modal-open',         key: 'modal-open',         intentPts: 3 },
      { name: 'mm:image-browse',       key: 'image-browse',       intentPts: 0 },
      { name: 'mm:add-to-cart',        key: 'add-to-cart',        intentPts: 5 },
      { name: 'mm:checkout-start',     key: 'checkout-start',     intentPts: 0 }
    ];

    events.forEach(function (evt) {
      document.addEventListener(evt.name, function (e) {
        var detail = (e && e.detail) || {};
        var handle = detail.productHandle || 'unknown';

        enqueue({
          type: 'increment',
          path: '/funnel/' + state.date + '/' + evt.key + '/' + handle
        });

        if (evt.intentPts) bumpIntent(evt.intentPts);

        // Special: product view intent boost (+2)
        if (evt.key === 'modal-open' || evt.key === 'product-card-hover') {
          if (evt.key !== 'product-card-hover') bumpIntent(2);
        }
      });
    });
  }

  /* ────────────────── 10. NEWSLETTER POPUP TRACKING ───────────────────── */

  function setupNewsletterListeners() {
    if (state.dnt) return;
    ['mm:popup-shown', 'mm:popup-dismissed', 'mm:popup-submitted'].forEach(function (name) {
      document.addEventListener(name, function (e) {
        var key = name.replace('mm:', '').replace(/-/g, '_');
        enqueue({ type: 'increment', path: '/newsletter/' + state.date + '/' + key });

        // Include dismiss method if available
        if (name === 'mm:popup-dismissed' && e.detail && e.detail.method) {
          enqueue({
            type: 'push',
            path: '/newsletter/' + state.date + '/dismiss_details',
            data: { method: e.detail.method, ts: now() }
          });
        }
      });
    });
  }

  /* ──────────────────── 11. PERFORMANCE METRICS ───────────────────────── */

  function capturePerformance() {
    if (state.dnt) return;

    // Wait a bit after load so paint metrics are available
    var capture = function () {
      var perf = {};

      // Navigation Timing
      if (window.performance && performance.getEntriesByType) {
        var nav = performance.getEntriesByType('navigation')[0];
        if (nav) {
          perf.pageLoad         = Math.round(nav.loadEventEnd - nav.startTime);
          perf.domContentLoaded = Math.round(nav.domContentLoadedEventEnd - nav.startTime);
          perf.ttfb             = Math.round(nav.responseStart - nav.requestStart);
        }
      }

      // Web-vitals via PerformanceObserver (best-effort)
      try { observeWebVitals(perf); } catch (_) {}

      // Send after collecting paint metrics (give observers 3 s)
      setTimeout(function () {
        perf.device     = deviceType();
        perf.connection = connectionSpeed();
        perf.timestamp  = now();
        perf.url        = location.pathname;
        enqueue({ type: 'push', path: '/performance/' + state.date + '/' + state.slug, data: perf });
      }, 3000);
    };

    if (document.readyState === 'complete') { capture(); }
    else { window.addEventListener('load', capture); }
  }

  /** Observe LCP, FID, CLS, FCP, INP via PerformanceObserver. */
  function observeWebVitals(perf) {
    // FCP
    if (PerformanceObserver.supportedEntryTypes &&
        PerformanceObserver.supportedEntryTypes.indexOf('paint') !== -1) {
      var paintEntries = performance.getEntriesByType('paint');
      paintEntries.forEach(function (e) {
        if (e.name === 'first-contentful-paint') perf.fcp = Math.round(e.startTime);
      });
    }

    // LCP
    try {
      new PerformanceObserver(function (list) {
        var entries = list.getEntries();
        if (entries.length) perf.lcp = Math.round(entries[entries.length - 1].startTime);
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch (_) {}

    // CLS
    try {
      var clsValue = 0;
      new PerformanceObserver(function (list) {
        list.getEntries().forEach(function (e) {
          if (!e.hadRecentInput) clsValue += e.value;
        });
        perf.cls = Math.round(clsValue * 1000) / 1000;
      }).observe({ type: 'layout-shift', buffered: true });
    } catch (_) {}

    // FID
    try {
      new PerformanceObserver(function (list) {
        var entries = list.getEntries();
        if (entries.length) perf.fid = Math.round(entries[0].processingStart - entries[0].startTime);
      }).observe({ type: 'first-input', buffered: true });
    } catch (_) {}

    // INP (Interaction to Next Paint) — newer metric
    try {
      var maxINP = 0;
      new PerformanceObserver(function (list) {
        list.getEntries().forEach(function (e) {
          var dur = e.duration;
          if (dur > maxINP) maxINP = dur;
        });
        perf.inp = Math.round(maxINP);
      }).observe({ type: 'event', buffered: true, durationThreshold: 16 });
    } catch (_) {}
  }

  /* ────────────────────── 12. ERROR TRACKING ──────────────────────────── */

  function setupErrorTracking() {
    if (state.dnt) return;

    // JS runtime errors
    window.addEventListener('error', function (e) {
      // Distinguish image load errors from JS errors
      if (e.target && e.target.tagName === 'IMG') {
        enqueue({
          type: 'push',
          path: '/errors/' + state.date,
          data: {
            kind:      'image',
            src:       e.target.src || e.target.currentSrc || null,
            page:      location.pathname,
            timestamp: now()
          }
        });
        return;
      }

      enqueue({
        type: 'push',
        path: '/errors/' + state.date,
        data: {
          kind:      'runtime',
          message:   trunc(e.message || '', 500),
          source:    e.filename || null,
          line:      e.lineno || null,
          col:       e.colno || null,
          stack:     trunc((e.error && e.error.stack) || '', 1000),
          page:      location.pathname,
          timestamp: now()
        }
      });
    }, true); // useCapture to catch img errors

    // Unhandled promise rejections
    window.addEventListener('unhandledrejection', function (e) {
      var reason = e.reason || {};
      enqueue({
        type: 'push',
        path: '/errors/' + state.date,
        data: {
          kind:      'promise',
          message:   trunc(String(reason.message || reason), 500),
          stack:     trunc(String(reason.stack || ''), 1000),
          page:      location.pathname,
          timestamp: now()
        }
      });
    });
  }

  /* ──────────────────────── 13. CART EVENTS ───────────────────────────── */

  function setupCartListeners() {
    if (state.dnt) return;
    document.addEventListener('mm:cart-update', function (e) {
      var detail = (e && e.detail) || {};
      enqueue({
        type: 'push',
        path: '/cart/' + state.date,
        data: {
          action:    detail.action || 'unknown',
          items:     detail.items || null,
          total:     detail.total || null,
          visitorId: state.visitorId,
          sessionId: state.sessionId,
          timestamp: now()
        }
      });
    });
  }

  /* ───────────────────── 14. A/B TESTING SUPPORT ──────────────────────── */

  /**
   * Deterministically assign a variant (A or B) based on visitor ID + experiment name.
   * Returns 'A' or 'B'.
   */
  function getVariant(experimentName) {
    var seed = state.visitorId + ':' + experimentName;
    return fnv1a(seed) % 2 === 0 ? 'A' : 'B';
  }

  /** Check for active experiments in localStorage and track variant exposure. */
  function processExperiments() {
    if (state.dnt) return;
    var raw;
    try { raw = localStorage.getItem('mm_experiments'); } catch (_) { return; }
    if (!raw) return;
    var experiments;
    try { experiments = JSON.parse(raw); } catch (_) { return; }
    // Expected format: ["experiment-name-1", "experiment-name-2"]
    if (!Array.isArray(experiments)) return;

    experiments.forEach(function (name) {
      var variant = getVariant(name);
      enqueue({ type: 'increment', path: '/abTests/' + name + '/' + variant + '/views' });
    });
  }

  /* ────────────────── 15. VISITOR INTENT SCORING ──────────────────────── */

  function bumpIntent(points) {
    state.intentScore += points;
    try { localStorage.setItem('mm_intent', String(state.intentScore)); } catch (_) {}
    writeIntent();
  }

  function writeIntent() {
    if (state.dnt || !state.fbReady) return;
    var level = 'low';
    if (state.intentScore >= INTENT_THRESHOLDS.medium) level = 'high';
    else if (state.intentScore >= INTENT_THRESHOLDS.low) level = 'medium';

    setData('/visitors/' + state.visitorId + '/intent', {
      score: state.intentScore,
      level: level,
      updatedAt: now()
    });
  }

  /** Also bump intent for time on site (>60 s → +2, once per session). */
  function setupTimeIntent() {
    if (state.dnt) return;
    var key = 'mm_time_intent_' + state.sessionId;
    var already;
    try { already = sessionStorage.getItem(key); } catch (_) {}
    if (already) return;
    setTimeout(function () {
      try { sessionStorage.setItem(key, '1'); } catch (_) {}
      bumpIntent(2);
    }, 60000);
  }

  /* ─────────────────── 16. SOCIAL PROOF (PRODUCT VIEWS) ───────────────── */

  /**
   * Returns a Promise resolving to the number of page views for a product today.
   * Works even if DNT is on (reading, not writing).
   */
  function getProductViews(handle) {
    if (!state.fbReady) {
      return new Promise(function (resolve) {
        document.addEventListener('mm:tracker-ready', function () {
          resolve(getProductViews(handle));
        }, { once: true });
      });
    }
    var slug = 'shop-' + handle;
    return ref('/productViewCounts/' + state.date + '/' + slug)
      .once('value')
      .then(function (snap) { return snap.val() || 0; });
  }

  /* ──────────────────── 17. PUBLIC API & CUSTOM EVENTS ────────────────── */

  /**
   * Generic tracking method — sends a custom event to Firebase.
   * @param {string} event — event name
   * @param {object} data  — arbitrary payload
   */
  function track(event, data) {
    if (state.dnt) return;
    enqueue({
      type: 'push',
      path: '/events/' + state.date + '/' + event,
      data: Object.assign({}, data || {}, {
        visitorId: state.visitorId,
        sessionId: state.sessionId,
        page:      location.pathname,
        timestamp: now()
      })
    });
  }

  /* Expose public API */
  window.MMTracker = {
    track:            track,
    getVariant:       getVariant,
    getProductViews:  getProductViews
  };

  /* ──────────────────────── 18. LIFECYCLE ─────────────────────────────── */

  /** Periodic batch flush. */
  var batchTimer = setInterval(flushBatch, BATCH_INTERVAL);

  /** Flush on visibility change (tab hidden) and before unload. */
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flushBatch();
  });

  window.addEventListener('pagehide', function () {
    // Record session duration
    if (!state.dnt && state.fbReady) {
      var duration = Math.round((Date.now() - state.sessionStart) / 1000);
      setData('/sessions/' + state.date + '/' + state.sessionId, {
        visitorId:  state.visitorId,
        duration:   duration,
        pages:      state.pagesViewed,
        device:     deviceType(),
        endedAt:    now()
      });
    }
    flushBatch();
    flushBeacon(); // last resort for anything left
  });

  /* ──────────────────────── 19. INITIALISATION ────────────────────────── */

  function init() {
    // Populate IDs
    initVisitor();
    initSession();
    initIntent();

    // Admin check — skip tracking on admin pages
    if (/^\/admin\//i.test(location.pathname)) {
      state.isAdmin = true;
    }

    // Do Not Track
    if (navigator.doNotTrack === '1' || window.doNotTrack === '1') {
      state.dnt = true;
    }

    // Start error tracking early (before Firebase loads)
    if (!state.isAdmin) setupErrorTracking();

    // Load Firebase asynchronously — never block rendering
    initFirebase()
      .then(function () {
        if (state.isAdmin) return; // no tracking on admin

        // --- Core tracking ---
        trackPageView();
        setupPresence();
        setupScrollTracking();
        setupClickTracking();
        setupFunnelListeners();
        setupNewsletterListeners();
        setupCartListeners();
        capturePerformance();
        setupTimeIntent();
        processExperiments();

        // Initial intent write
        if (!state.dnt) writeIntent();
      })
      .catch(function (err) {
        // Firebase failed to load — degrade gracefully, log to console
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[MMTracker] Firebase init failed:', err);
        }
      });
  }

  // Kick off — run immediately (script is async/deferred or at end of body)
  init();

})();
