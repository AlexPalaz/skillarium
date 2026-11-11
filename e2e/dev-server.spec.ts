import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { EMPTY_URL, HOSTILE_URL } from '../playwright.config';

const scratch = path.join(path.dirname(fileURLToPath(import.meta.url)), '.tmp', 'hostile');

test.describe('untrusted skill content', () => {
  test('cannot run script, load remote resources, or produce dangerous links', async ({ page }) => {
    const foreign: string[] = [];
    page.on('request', (request) => {
      if (!request.url().startsWith(HOSTILE_URL)) foreign.push(request.url());
    });

    await page.goto(`${HOSTILE_URL}skills/hostile/`);
    const prose = page.locator('.prose');
    await expect(prose.getByRole('heading', { name: 'Hostile content' })).toBeVisible();
    // The instruction addressed to "the agent" is just displayed text.
    await expect(prose.getByText('Ignore all previous instructions')).toBeVisible();

    // Raw HTML is dropped entirely.
    await expect(prose.locator('script, iframe, img, object, embed')).toHaveCount(0);
    await expect(page.locator('main [onerror], main [onload], main [onclick]')).toHaveCount(0);

    // Links: only http(s) survives as a link; everything else is inert text.
    const hrefs = await prose.locator('a').evaluateAll((links) => links.map((a) => a.getAttribute('href')));
    expect(hrefs.filter((href) => /^(javascript|data|file|vbscript):/i.test(href ?? ''))).toEqual([]);
    await expect(prose.getByText('javascript link')).toBeVisible();
    await expect(prose.getByRole('link', { name: 'javascript link' })).toHaveCount(0);
    await expect(prose.getByRole('link', { name: 'file link' })).toHaveCount(0);
    await expect(prose.getByRole('link', { name: 'traversal link' })).toHaveCount(0);
    const external = prose.getByRole('link', { name: /safe external/ });
    await expect(external).toHaveAttribute('rel', /noopener/);
    await expect(external).toHaveAttribute('target', '_blank');

    // Remote images are replaced by a notice, never fetched.
    await expect(prose.getByText('Remote image not loaded: remote tracker')).toBeVisible();

    // HTML and SVG resources are shown as source text.
    await prose.getByRole('link', { name: 'page', exact: true }).click();
    await expect(page.locator('pre code')).toContainText("window.__pwned = 'html resource'");
    await page.getByRole('navigation', { name: 'Skill files' }).getByRole('link', { name: 'evil.svg' }).click();
    await expect(page.locator('pre code')).toContainText('<svg');
    await expect(page.locator('main svg[onload]')).toHaveCount(0);

    expect(await page.evaluate(() => (window as unknown as { __pwned?: string }).__pwned)).toBeUndefined();
    expect(foreign).toEqual([]);
  });

  test('published files are served as plain text, never as HTML or SVG', async ({ request }) => {
    for (const file of ['files/hostile/page.html.txt', 'files/hostile/assets/evil.svg.txt']) {
      const response = await request.get(HOSTILE_URL + file);
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toBe('text/plain; charset=utf-8');
      expect(response.headers()['x-content-type-options']).toBe('nosniff');
    }
    expect((await request.get(`${HOSTILE_URL}files/hostile/page.html`)).status()).toBe(404);
    expect((await request.get(`${HOSTILE_URL}files/hostile/assets/evil.svg`)).status()).toBe(404);
  });

  test('a malformed skill is still listed, with its diagnostics', async ({ page }) => {
    await page.goto(HOSTILE_URL);
    await expect(page.getByRole('list', { name: 'Diagnostics' })).toContainText('Frontmatter is not valid YAML');

    await page.getByRole('navigation', { name: 'Skills' }).getByRole('link', { name: 'broken' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'broken' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Diagnostics' })).toContainText('invalid-yaml');
    await expect(page.locator('.prose')).toContainText('This skill has broken frontmatter but is still shown.');
  });
});

test('the viewer updates when a SKILL.md changes on disk', async ({ page }) => {
  await page.goto(`${HOSTILE_URL}skills/live/`);
  await expect(page.locator('.prose')).toContainText('Original body.');

  const file = path.join(scratch, 'skills', 'live', 'SKILL.md');
  fs.writeFileSync(file, '---\nname: live\ndescription: Edited description.\n---\n\n# Live\n\nEdited body, no reload needed.\n');

  await expect(page.locator('.prose')).toContainText('Edited body, no reload needed.');
  await expect(page.getByText('Edited description.')).toBeVisible();
});

test('a project without skills explains where Skillarium looked', async ({ page }) => {
  await page.goto(EMPTY_URL);
  await expect(page.getByRole('heading', { name: 'No Agent Skills found' })).toBeVisible();
  await expect(page.getByText('.claude/skills/')).toBeVisible();
  await expect(page.getByText('No skills found yet.')).toBeVisible(); // sidebar

  await page.getByRole('link', { name: 'Architecture' }).click();
  await expect(page.getByRole('heading', { name: 'No Agent Skills found' })).toBeVisible();
});
