import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  use: {
    baseURL: 'http://localhost:8080',
    headless: true,
    viewport: { width: 1280, height: 800 },
    actionTimeout: 15000,
  },
  timeout: 60000,
  reporter: [['list']]
});


