import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const root = path.dirname(fileURLToPath(import.meta.url));
const cli = `node ${JSON.stringify(path.join(root, 'packages/cli/bin/skillarium.js'))}`;
const site = path.join(root, 'e2e/.tmp/site');

export const STATIC_URL = 'http://127.0.0.1:4611/demo/';
export const HOSTILE_URL = 'http://127.0.0.1:4612/';
export const EMPTY_URL = 'http://127.0.0.1:4613/';
export const LARGE_URL = 'http://127.0.0.1:4614/';

// Requires `pnpm build` first: the tests drive the built CLI and viewer.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { ...devices['Desktop Chrome'], trace: 'retain-on-failure' },
  webServer: [
    {
      // The published form of the product: a static build under a sub-path,
      // served by a plain static server.
      command: `${cli} build --root examples/sample-project --base /demo/ --out-dir ${JSON.stringify(site)} && ${cli} preview --root examples/sample-project --out-dir ${JSON.stringify(site)} --port 4611`,
      url: STATIC_URL,
      reuseExistingServer: false,
    },
    {
      // Runs against a scratch copy, because the live-reload test edits files.
      command: `node e2e/prepare.mjs && ${cli} dev --root e2e/.tmp/hostile --port 4612 --no-open`,
      url: `${HOSTILE_URL}data/catalog.json`,
      reuseExistingServer: false,
    },
    {
      // A generated catalog of 153 skills, for what only shows at scale.
      command: `node scripts/make-playground.mjs 150 e2e/.tmp/large && ${cli} dev --root e2e/.tmp/large --port 4614 --no-open`,
      url: `${LARGE_URL}data/catalog.json`,
      reuseExistingServer: false,
    },
    {
      command: `${cli} dev --root e2e/fixtures/empty --port 4613 --no-open`,
      url: `${EMPTY_URL}data/catalog.json`,
      reuseExistingServer: false,
    },
  ],
});
