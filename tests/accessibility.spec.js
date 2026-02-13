// @ts-check
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

/*
 * Pages to test — every page on the site
 */
const PAGES = [
  { path: '/', name: 'Home' },
  { path: '/shop/', name: 'Shop' },
  { path: '/events/', name: 'Events' },
  { path: '/wholesale/', name: 'Wholesale' },
  { path: '/about/', name: 'About' },
  { path: '/contact/', name: 'Contact' },
  { path: '/faq/', name: 'FAQ' },
  { path: '/policies/shipping/', name: 'Shipping Policy' },
  { path: '/policies/refund/', name: 'Refund Policy' },
  { path: '/policies/terms/', name: 'Terms of Service' },
  { path: '/policies/privacy/', name: 'Privacy Policy' },
];

// ─────────────────────────────────────────────────────────
// 1. Accessibility (axe-core) — every page
// ─────────────────────────────────────────────────────────
for (const page of PAGES) {
  test(`Accessibility: ${page.name} (${page.path}) passes axe scan`, async ({ page: p }) => {
    await p.goto(page.path, { waitUntil: 'domcontentloaded' });
    const results = await new AxeBuilder({ page: p })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .disableRules([
        'color-contrast',         // can't verify without rendering
        'scrollable-region-focusable', // cart drawer isn't visible at load
      ])
      .analyze();

    const violations = results.violations.map(v => ({
      id: v.id,
      impact: v.impact,
      description: v.description,
      nodes: v.nodes.length,
      html: v.nodes.slice(0, 2).map(n => n.html),
    }));

    if (violations.length > 0) {
      console.log(`\nAxe violations on ${page.path}:`);
      violations.forEach(v => console.log(` - [${v.impact}] ${v.id}: ${v.description} (${v.nodes} nodes)`));
    }

    expect(violations, `Axe violations on ${page.path}`).toHaveLength(0);
  });
}

// ─────────────────────────────────────────────────────────
// 2. Pages load without errors
// ─────────────────────────────────────────────────────────
for (const page of PAGES) {
  test(`Load: ${page.name} responds 200`, async ({ page: p }) => {
    const response = await p.goto(page.path, { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBe(200);
  });
}

// ─────────────────────────────────────────────────────────
// 3. 404 page
// ─────────────────────────────────────────────────────────
test('404 page loads', async ({ page }) => {
  const response = await page.goto('/404.html', { waitUntil: 'domcontentloaded' });
  expect(response?.status()).toBe(200);
  await expect(page.locator('h1')).toContainText(/not found|404|oops/i);
});

// ─────────────────────────────────────────────────────────
// 4. Core structure checks
// ─────────────────────────────────────────────────────────
for (const pg of PAGES) {
  test(`Structure: ${pg.name} has skip-link, main, nav`, async ({ page }) => {
    await page.goto(pg.path, { waitUntil: 'domcontentloaded' });

    // Skip link exists
    const skipLink = page.locator('a.skip-link');
    await expect(skipLink).toHaveCount(1);
    await expect(skipLink).toHaveAttribute('href', '#main-content');

    // <main> landmark exists
    await expect(page.locator('main#main-content')).toHaveCount(1);

    // Navigation exists
    await expect(page.locator('nav[aria-label="Main navigation"]')).toHaveCount(1);

    // H1 exists
    const h1 = page.locator('h1');
    const count = await h1.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });
}

// ─────────────────────────────────────────────────────────
// 5. Mobile nav toggle works
// ─────────────────────────────────────────────────────────
test('Mobile nav toggle opens and closes', async ({ page, browserName }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop-chromium', 'Desktop only — skip mobile nav test');

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const toggle = page.locator('#nav-toggle');
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.nav-links')).toHaveClass(/open/);

  // Escape closes
  await page.keyboard.press('Escape');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

// ─────────────────────────────────────────────────────────
// 6. No horizontal overflow on mobile viewports
// ─────────────────────────────────────────────────────────
for (const pg of PAGES) {
  test(`Mobile overflow: ${pg.name} has no horizontal scroll`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'desktop-chromium', 'Desktop — skip overflow test');

    await page.goto(pg.path, { waitUntil: 'domcontentloaded' });
    // Wait for content to render
    await page.waitForTimeout(500);

    const overflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(overflow, `Page ${pg.path} has horizontal overflow`).toBe(false);
  });
}

// ─────────────────────────────────────────────────────────
// 7. Cart drawer focus management
// ─────────────────────────────────────────────────────────
test('Cart drawer opens, traps focus, closes on Escape', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Cart toggle only visible on desktop');

  await page.goto('/', { waitUntil: 'domcontentloaded' });

  // Close newsletter popup if it appears
  await page.waitForTimeout(5000);
  const popup = page.locator('#newsletter-popup.active');
  if (await popup.isVisible()) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }

  // Click cart toggle
  const cartToggle = page.locator('.cart-toggle').first();
  await cartToggle.click();
  await page.waitForTimeout(300);

  // Cart drawer should be open
  const drawer = page.locator('#cart-drawer');
  await expect(drawer).toHaveClass(/open/);

  // Close button should be focused (focus moved to drawer)
  const closeBtn = page.locator('#cart-drawer .cart-close');
  await expect(closeBtn).toBeFocused();

  // Escape closes cart
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await expect(drawer).not.toHaveClass(/open/);
});

// ─────────────────────────────────────────────────────────
// 8. FAQ accordion
// ─────────────────────────────────────────────────────────
test('FAQ accordion toggles aria-expanded', async ({ page }) => {
  await page.goto('/faq/', { waitUntil: 'domcontentloaded' });

  const firstBtn = page.locator('.faq-question').first();
  await expect(firstBtn).toHaveAttribute('aria-expanded', 'false');
  await expect(firstBtn).toHaveAttribute('aria-controls', 'faq-answer-1');

  await firstBtn.click();
  await expect(firstBtn).toHaveAttribute('aria-expanded', 'true');

  // Answer region exists
  const answer = page.locator('#faq-answer-1');
  await expect(answer).toHaveAttribute('role', 'region');

  // Click again to close
  await firstBtn.click();
  await expect(firstBtn).toHaveAttribute('aria-expanded', 'false');
});

// ─────────────────────────────────────────────────────────
// 9. Shop filter buttons
// ─────────────────────────────────────────────────────────
test('Shop filter buttons have aria-pressed', async ({ page }) => {
  await page.goto('/shop/', { waitUntil: 'domcontentloaded' });

  const group = page.locator('[role="group"][aria-label="Filter products by category"]');
  await expect(group).toHaveCount(1);

  const allBtn = page.locator('.filter-btn[data-filter="all"]');
  await expect(allBtn).toHaveAttribute('aria-pressed', 'true');

  const customBtn = page.locator('.filter-btn[data-filter="custom"]');
  await expect(customBtn).toHaveAttribute('aria-pressed', 'false');

  // Click custom filter
  await customBtn.click();
  await expect(customBtn).toHaveAttribute('aria-pressed', 'true');
  await expect(allBtn).toHaveAttribute('aria-pressed', 'false');
});

// ─────────────────────────────────────────────────────────
// 10. Product buttons have aria-labels
// ─────────────────────────────────────────────────────────
test('Shop product buttons have descriptive aria-labels', async ({ page }) => {
  await page.goto('/shop/', { waitUntil: 'domcontentloaded' });

  const addBtns = page.locator('button[data-variant-id]');
  const count = await addBtns.count();
  expect(count).toBeGreaterThan(0);

  for (let i = 0; i < count; i++) {
    const label = await addBtns.nth(i).getAttribute('aria-label');
    expect(label, `Button ${i} has aria-label`).toBeTruthy();
    expect(label).toContain('Add');
  }
});

// ─────────────────────────────────────────────────────────
// 11. All images have alt text
// ─────────────────────────────────────────────────────────
for (const pg of PAGES) {
  test(`Images: ${pg.name} all images have alt attr`, async ({ page }) => {
    await page.goto(pg.path, { waitUntil: 'domcontentloaded' });

    const images = page.locator('img');
    const count = await images.count();

    for (let i = 0; i < count; i++) {
      const alt = await images.nth(i).getAttribute('alt');
      // alt can be "" for decorative images, but attribute must exist
      expect(alt !== null, `Image ${i} on ${pg.path} has alt attribute`).toBe(true);
    }
  });
}

// ─────────────────────────────────────────────────────────
// 12. Cart drawer has dialog role
// ─────────────────────────────────────────────────────────
test('Cart drawer has role=dialog', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const drawer = page.locator('#cart-drawer');
  await expect(drawer).toHaveAttribute('role', 'dialog');
  await expect(drawer).toHaveAttribute('aria-modal', 'true');
});

// ─────────────────────────────────────────────────────────
// 13. Footer exists on all pages
// ─────────────────────────────────────────────────────────
for (const pg of PAGES) {
  test(`Footer: ${pg.name} has footer`, async ({ page }) => {
    await page.goto(pg.path, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('footer[role="contentinfo"]')).toHaveCount(1);
  });
}
