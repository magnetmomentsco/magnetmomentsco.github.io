/**
 * Firebase Realtime Database Rules — Regression Tests
 * ====================================================
 * Validates every write path used by mm-tracker, webapp-event,
 * webapp-market, and the admin dashboard reads.
 *
 * Run locally:
 *   npm run test:rules
 *
 * Requires: firebase-tools (uses the RTDB emulator under the hood)
 */
// @ts-check
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require('@firebase/rules-unit-testing');
const { readFileSync } = require('fs');
const { resolve } = require('path');
const { describe, it, before, after, beforeEach } = require('node:test');

const RULES_PATH = resolve(__dirname, '..', 'scripts', 'firebase-rules.json');
const PROJECT_ID = 'demo-magnetmomentsco-test';

/** @type {import('@firebase/rules-unit-testing').RulesTestEnvironment} */
let testEnv;

// Helpers — compat-style database references
function unauthedDb() {
  return testEnv.unauthenticatedContext().database();
}
function authedDb(uid, claims) {
  return testEnv.authenticatedContext(uid || 'admin-uid', claims || {
    email: 'alyssa.magnetmomentsco@gmail.com',
  }).database();
}

// ─────────────────────────────────────────────────────────────────────────
// Setup / Teardown
// ─────────────────────────────────────────────────────────────────────────
before(async () => {
  const rules = readFileSync(RULES_PATH, 'utf8');
  // Validate JSON syntax before anything else
  JSON.parse(rules);

  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    database: { rules, host: '127.0.0.1', port: 9399 },
  });
});

beforeEach(async () => {
  await testEnv.clearDatabase();
});

after(async () => {
  if (testEnv) await testEnv.cleanup();
});

// ─────────────────────────────────────────────────────────────────────────
// 1. TRACKER WRITES — unauthenticated (public analytics)
// ─────────────────────────────────────────────────────────────────────────
describe('Tracker — public analytics writes (unauthenticated)', () => {
  const DATE = '2026-03-08';
  const SLUG = 'shop-golden-girls';
  const SESSION_ID = 'sess-abc123';
  const VISITOR_ID = 'vis-xyz789';

  it('pageViews: push page view data', async () => {
    const db = unauthedDb();
    await assertSucceeds(
      db.ref('pageViews/' + DATE + '/' + SLUG).push().set({
        url: 'https://magnetmomentsco.us/shop/golden-girls/',
        path: '/shop/golden-girls/',
        title: 'Golden Girls Magnet Set',
        referrer: null,
        timestamp: new Date().toISOString(),
        sessionId: SESSION_ID,
        visitorId: VISITOR_ID,
        device: 'desktop',
        utm: { source: null, medium: null, campaign: null, content: null, term: null },
        source: 'direct',
      })
    );
  });

  it('pageViews: rejects invalid date key', async () => {
    const db = unauthedDb();
    await assertFails(
      db.ref('pageViews/not-a-date/' + SLUG).push().set({
        timestamp: new Date().toISOString(),
        visitorId: VISITOR_ID,
      })
    );
  });

  it('productViewCounts: increment counter', async () => {
    const db = unauthedDb();
    await assertSucceeds(
      db.ref('productViewCounts/' + DATE + '/' + SLUG).set(1)
    );
  });

  it('clicks: push click data', async () => {
    const db = unauthedDb();
    await assertSucceeds(
      db.ref('clicks/' + DATE + '/' + SLUG).push().set({
        x: 45.23, y: 67.89, tag: 'a', cls: 'product-link',
        id: null, text: 'Buy Now', ts: new Date().toISOString(),
      })
    );
  });

  it('rageClicks: push rage click data', async () => {
    const db = unauthedDb();
    await assertSucceeds(
      db.ref('rageClicks/' + DATE + '/' + SLUG).push().set({
        x: 100, y: 200, count: 4, ts: new Date().toISOString(),
      })
    );
  });

  it('scrollDepth: increment threshold counter', async () => {
    const db = unauthedDb();
    await assertSucceeds(
      db.ref('scrollDepth/' + DATE + '/' + SLUG + '/75').set(1)
    );
  });

  it('funnel: increment funnel event', async () => {
    const db = unauthedDb();
    await assertSucceeds(
      db.ref('funnel/' + DATE + '/product-view/golden-girls').set(1)
    );
  });

  it('newsletter: increment popup event', async () => {
    const db = unauthedDb();
    await assertSucceeds(
      db.ref('newsletter/' + DATE + '/popup_shown').set(1)
    );
  });

  it('newsletter: push dismiss details', async () => {
    const db = unauthedDb();
    await assertSucceeds(
      db.ref('newsletter/' + DATE + '/dismiss_details').push().set({
        method: 'close-button', ts: new Date().toISOString(),
      })
    );
  });

  it('performance: push web vitals data', async () => {
    const db = unauthedDb();
    await assertSucceeds(
      db.ref('performance/' + DATE + '/' + SLUG).push().set({
        pageLoad: 1200, domContentLoaded: 800, ttfb: 150,
        fcp: 500, lcp: 900, cls: 0.05, fid: 12,
        device: 'mobile', connection: '4g',
        timestamp: new Date().toISOString(), url: '/shop/golden-girls/',
      })
    );
  });

  it('cart: push cart event', async () => {
    const db = unauthedDb();
    await assertSucceeds(
      db.ref('cart/' + DATE).push().set({
        action: 'add', items: 2, total: 19.99,
        visitorId: VISITOR_ID, sessionId: SESSION_ID,
        timestamp: new Date().toISOString(),
      })
    );
  });

  it('errors: push runtime error', async () => {
    const db = unauthedDb();
    await assertSucceeds(
      db.ref('errors/' + DATE).push().set({
        kind: 'runtime', message: 'TypeError: x is not a function',
        source: 'main.js', line: 42, col: 10,
        stack: 'TypeError: x is not a function\n    at main.js:42:10',
        page: '/', timestamp: new Date().toISOString(),
      })
    );
  });

  it('presence: set visitor presence', async () => {
    const db = unauthedDb();
    await assertSucceeds(
      db.ref('presence/' + VISITOR_ID).set({
        page: '/shop/', slug: 'shop', device: 'mobile',
        tz: 'America/Chicago', lang: 'en-US', timestamp: Date.now(),
      })
    );
  });

  it('presence: rejects unknown fields', async () => {
    const db = unauthedDb();
    await assertFails(
      db.ref('presence/' + VISITOR_ID).set({
        page: '/shop/', timestamp: Date.now(),
        hackerField: 'injected',
      })
    );
  });

  it('abTests: increment variant views', async () => {
    const db = unauthedDb();
    await assertSucceeds(
      db.ref('abTests/hero-banner/A/views').set(1)
    );
  });

  it('sessions: write session data', async () => {
    const db = unauthedDb();
    await assertSucceeds(
      db.ref('sessions/' + DATE + '/' + SESSION_ID).set({
        visitorId: VISITOR_ID, duration: 120, pages: 5,
        device: 'desktop', endedAt: new Date().toISOString(),
      })
    );
  });

  it('visitors: set intent score', async () => {
    const db = unauthedDb();
    await assertSucceeds(
      db.ref('visitors/' + VISITOR_ID + '/intent').set({
        score: 12, level: 'high', updatedAt: new Date().toISOString(),
      })
    );
  });

  it('visitors: rejects invalid intent level', async () => {
    const db = unauthedDb();
    await assertFails(
      db.ref('visitors/' + VISITOR_ID + '/intent').set({
        score: 5, level: 'invalid-level', updatedAt: new Date().toISOString(),
      })
    );
  });

  it('tracker-events: push custom tracker event', async () => {
    const db = unauthedDb();
    await assertSucceeds(
      db.ref('tracker-events/' + DATE + '/custom-event').push().set({
        visitorId: VISITOR_ID, sessionId: SESSION_ID,
        page: '/shop/', timestamp: new Date().toISOString(),
        customData: 'test',
      })
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 2. WEBAPP WRITES — market mode (unauthenticated customer)
// ─────────────────────────────────────────────────────────────────────────
describe('Webapp — market mode writes (unauthenticated)', () => {
  const DATE = '2026-03-08';

  it('orders: create new order (first write allowed)', async () => {
    const db = unauthedDb();
    const orderRef = db.ref('orders').push();
    await assertSucceeds(
      orderRef.set({
        orderId: 'ord-test-001',
        sessionDate: DATE,
        size: '2x3',
        quantity: 6,
        subtotal: 22.00,
        tax: 1.82,
        total: 23.82,
        paymentMethod: 'venmo',
        paymentStatus: 'pending',
        photoCount: 3,
        driveFileIds: ['file-id-1', 'file-id-2', 'file-id-3'],
        id: orderRef.key,
        timestamp: Date.now(),
      })
    );
  });

  it('orders: CANNOT overwrite existing order without auth', async () => {
    // First, seed an order with admin
    const adminDb = authedDb();
    const orderRef = adminDb.ref('orders/existing-order');
    await orderRef.set({
      orderId: 'existing-order',
      sessionDate: DATE,
      size: '2x2',
      quantity: 3,
      subtotal: 12.00,
      tax: 0.99,
      total: 12.99,
      paymentMethod: 'cash-tap',
      paymentStatus: 'pending',
      photoCount: 1,
      id: 'existing-order',
      timestamp: Date.now(),
    });

    // Now try overwriting as unauthenticated — should fail
    const db = unauthedDb();
    await assertFails(
      db.ref('orders/existing-order').set({
        orderId: 'existing-order',
        sessionDate: DATE,
        size: '2x3',
        quantity: 9,
        subtotal: 32.00,
        tax: 2.64,
        total: 34.64,
        paymentMethod: 'paypal',
        paymentStatus: 'confirmed',
        photoCount: 5,
        id: 'existing-order',
        timestamp: Date.now(),
      })
    );
  });

  it('orders: rejects invalid payment method', async () => {
    const db = unauthedDb();
    await assertFails(
      db.ref('orders').push().set({
        orderId: 'ord-bad',
        sessionDate: DATE,
        size: '2x2',
        quantity: 1,
        subtotal: 4.00,
        tax: 0.33,
        total: 4.33,
        paymentMethod: 'bitcoin',
        paymentStatus: 'pending',
        photoCount: 1,
        id: 'ord-bad',
        timestamp: Date.now(),
      })
    );
  });

  it('orders: rejects extra fields', async () => {
    const db = unauthedDb();
    await assertFails(
      db.ref('orders').push().set({
        orderId: 'ord-extra',
        sessionDate: DATE,
        size: '2x2',
        quantity: 1,
        subtotal: 4.00,
        tax: 0.33,
        total: 4.33,
        paymentMethod: 'venmo',
        paymentStatus: 'pending',
        photoCount: 1,
        id: 'ord-extra',
        timestamp: Date.now(),
        maliciousField: 'INJECTED',
      })
    );
  });

  it('market-sessions: update session stats', async () => {
    const db = unauthedDb();
    await assertSucceeds(
      db.ref('market-sessions/' + DATE).set({
        orderCount: 5,
        revenue: { total: 100.50, tax: 8.29 },
        paymentBreakdown: { venmo: 3, paypal: 1, 'cash-tap': 1 },
      })
    );
  });

  it('market-sessions: rejects invalid date key', async () => {
    const db = unauthedDb();
    await assertFails(
      db.ref('market-sessions/invalid').set({ orderCount: 1 })
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 3. WEBAPP WRITES — event mode (authenticated for event creation)
// ─────────────────────────────────────────────────────────────────────────
describe('Webapp — event management (authenticated)', () => {
  it('events: create event with valid schema', async () => {
    const db = authedDb();
    await assertSucceeds(
      db.ref('events/evt-001').set({
        name: 'Birthday Party',
        date: '2026-04-15',
        type: 'event',
        active: true,
        createdAt: Date.now(),
        driveFolderId: 'folder-abc123',
      })
    );
  });

  it('events: CANNOT create event without auth', async () => {
    const db = unauthedDb();
    await assertFails(
      db.ref('events/evt-002').set({
        name: 'Unauthorized Event',
        date: '2026-04-15',
        type: 'event',
        active: true,
        createdAt: Date.now(),
      })
    );
  });

  it('events: rejects invalid type', async () => {
    const db = authedDb();
    await assertFails(
      db.ref('events/evt-003').set({
        name: 'Bad Type Event',
        date: '2026-04-15',
        type: 'invalid-type',
        active: true,
        createdAt: Date.now(),
      })
    );
  });

  it('events: photoCount can be incremented without auth', async () => {
    // First create an event with auth
    const adminDb = authedDb();
    await adminDb.ref('events/evt-photo').set({
      name: 'Photo Event',
      date: '2026-04-15',
      type: 'event',
      active: true,
      createdAt: Date.now(),
      photoCount: 0,
    });

    // Guest can increment photoCount (has its own .write: true)
    const db = unauthedDb();
    await assertSucceeds(
      db.ref('events/evt-photo/photoCount').set(1)
    );
  });

  it('webapp-config: write requires auth', async () => {
    await assertFails(
      unauthedDb().ref('webapp-config/test').set({ value: true })
    );
    await assertSucceeds(
      authedDb().ref('webapp-config/test').set({ value: true })
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 4. ADMIN READS — authenticated
// ─────────────────────────────────────────────────────────────────────────
describe('Admin dashboard — authenticated reads', () => {
  it('pageViews: readable by anyone', async () => {
    await assertSucceeds(
      authedDb().ref('pageViews').once('value')
    );
  });

  it('clicks: readable by anyone', async () => {
    await assertSucceeds(
      authedDb().ref('clicks').once('value')
    );
  });

  it('errors: readable by anyone', async () => {
    await assertSucceeds(
      authedDb().ref('errors').once('value')
    );
  });

  it('presence: readable by anyone', async () => {
    await assertSucceeds(
      authedDb().ref('presence').once('value')
    );
  });

  it('events: readable by anyone', async () => {
    await assertSucceeds(
      authedDb().ref('events').once('value')
    );
  });

  it('productViewCounts: readable by anyone', async () => {
    await assertSucceeds(
      authedDb().ref('productViewCounts').once('value')
    );
  });

  it('orders: readable by authenticated user', async () => {
    await assertSucceeds(
      authedDb().ref('orders').once('value')
    );
  });

  it('market-sessions: readable by authenticated user', async () => {
    await assertSucceeds(
      authedDb().ref('market-sessions').once('value')
    );
  });

  it('sessions: readable by authenticated user', async () => {
    await assertSucceeds(
      authedDb().ref('sessions').once('value')
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 5. SECURITY — unauthorized reads MUST fail
// ─────────────────────────────────────────────────────────────────────────
describe('Security — unauthorized reads MUST be denied', () => {
  it('orders: DENIED to unauthenticated users', async () => {
    const db = unauthedDb();
    await assertFails(db.ref('orders').once('value'));
  });

  it('market-sessions: DENIED to unauthenticated users', async () => {
    const db = unauthedDb();
    await assertFails(db.ref('market-sessions').once('value'));
  });

  it('sessions: DENIED to unauthenticated users', async () => {
    const db = unauthedDb();
    await assertFails(db.ref('sessions').once('value'));
  });

  it('events: CANNOT write without auth', async () => {
    const db = unauthedDb();
    await assertFails(
      db.ref('events/unauthorized-event').set({
        name: 'Hack Event',
        date: '2026-01-01',
        type: 'event',
        active: true,
        createdAt: Date.now(),
      })
    );
  });

  it('webapp-config: CANNOT write without auth', async () => {
    const db = unauthedDb();
    await assertFails(
      db.ref('webapp-config/hack').set({ malicious: true })
    );
  });

  it('root: CANNOT read entire database', async () => {
    const db = unauthedDb();
    await assertFails(db.ref('/').once('value'));
  });

  it('root: CANNOT write to undefined paths', async () => {
    const db = unauthedDb();
    await assertFails(
      db.ref('some-random-path').set({ data: 'test' })
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 6. RULES SYNTAX — structural validation
// ─────────────────────────────────────────────────────────────────────────
describe('Rules file — structural validation', () => {
  it('firebase-rules.json is valid JSON', () => {
    const raw = readFileSync(RULES_PATH, 'utf8');
    const rules = JSON.parse(raw);
    if (!rules.rules) throw new Error('Missing top-level "rules" key');
  });

  it('all tracker write paths have corresponding rules', () => {
    const raw = readFileSync(RULES_PATH, 'utf8');
    const rules = JSON.parse(raw).rules;
    const requiredPaths = [
      'pageViews', 'clicks', 'rageClicks', 'errors', 'presence',
      'scrollDepth', 'funnel', 'newsletter', 'performance', 'cart',
      'visitors', 'abTests', 'sessions', 'productViewCounts',
      'tracker-events',
    ];
    const missing = requiredPaths.filter(p => !rules[p]);
    if (missing.length > 0) {
      throw new Error('Missing rules for tracker paths: ' + missing.join(', '));
    }
  });

  it('all webapp paths have corresponding rules', () => {
    const raw = readFileSync(RULES_PATH, 'utf8');
    const rules = JSON.parse(raw).rules;
    const requiredPaths = ['events', 'orders', 'market-sessions', 'webapp-config'];
    const missing = requiredPaths.filter(p => !rules[p]);
    if (missing.length > 0) {
      throw new Error('Missing rules for webapp paths: ' + missing.join(', '));
    }
  });

  it('auth-protected paths require authentication for reads', () => {
    const raw = readFileSync(RULES_PATH, 'utf8');
    const rules = JSON.parse(raw).rules;
    const authRequiredReads = ['orders', 'market-sessions', 'sessions'];
    const broken = authRequiredReads.filter(p => {
      const readRule = rules[p] && rules[p]['.read'];
      return readRule === true || readRule === 'true';
    });
    if (broken.length > 0) {
      throw new Error('These paths should require auth for reads but are public: ' + broken.join(', '));
    }
  });
});
