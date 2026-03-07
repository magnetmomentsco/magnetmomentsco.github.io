// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:8083',
    headless: true,
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: {
        browserName: 'chromium',
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: 'mobile-375',
      use: {
        browserName: 'chromium',
        viewport: { width: 375, height: 812 },
      },
    },
    {
      name: 'mobile-320',
      use: {
        browserName: 'chromium',
        viewport: { width: 320, height: 568 },
      },
    },
  ],
  webServer: {
    command: 'python3 -m http.server 8083 --directory .',
    port: 8083,
    reuseExistingServer: true,
  },
});
