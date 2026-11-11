import { expect, test, type Page } from '@playwright/test';
import { STATIC_URL } from '../playwright.config';

const url = (path = '') => STATIC_URL + path;

/** Fail the test if the page logs an error or talks to another origin. */
function watch(page: Page): { errors: string[]; foreign: string[] } {
  const seen = { errors: [] as string[], foreign: [] as string[] };
  page.on('pageerror', (error) => seen.errors.push(error.message));
  page.on('console', (message) => message.type() === 'error' && seen.errors.push(message.text()));
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:4611/') && !request.url().startsWith('data:') && !request.url().startsWith('blob:')) {
      seen.foreign.push(request.url());
    }
  });
  return seen;
}

test('overview lists the project and its skills, and the sidebar navigates', async ({ page }) => {
  const seen = watch(page);
  await page.goto(url());
  await expect(page.getByRole('heading', { level: 1, name: 'Acme Agent Skills' })).toBeVisible();
  await expect(page).toHaveTitle(/Acme Agent Skills/);

  const nav = page.getByRole('navigation', { name: 'Skills' });
  await expect(nav.getByRole('link')).toHaveCount(5);
  await expect(nav.getByText('.claude/skills')).toBeVisible();

  await nav.getByRole('link', { name: 'pdf-processing' }).click();
  await expect(page).toHaveURL(url('skills/pdf-processing/'));
  await expect(page.getByRole('heading', { level: 1, name: 'pdf-processing' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'pdf-processing' })).toHaveAttribute('aria-current', 'page');

  // Collapsible groups.
  await nav.getByRole('button', { name: /\.claude\/skills/ }).click();
  await expect(nav.getByRole('link', { name: 'release-notes' })).toBeHidden();

  expect(seen.errors).toEqual([]);
  expect(seen.foreign).toEqual([]); // works offline: nothing leaves the site
});

test('a skill URL works on direct navigation and survives a refresh', async ({ page }) => {
  const response = await page.goto(url('skills/code-review/'));
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: 'code-review' })).toBeVisible();
  await expect(page).toHaveTitle('code-review · Acme Agent Skills');

  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'code-review' })).toBeVisible();

  // Deep link to a file inside a skill, then refresh.
  await page.goto(url('skills/code-review/?file=references%2Fseverity.md'));
  await expect(page.getByRole('heading', { name: 'Severity scale' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Severity scale' })).toBeVisible();
});

test('renders metadata and GitHub-flavored Markdown', async ({ page }) => {
  await page.goto(url('skills/pdf-processing/'));

  const metadata = page.getByRole('region', { name: 'Metadata' }).or(page.locator('section[aria-labelledby="metadata-heading"]'));
  await expect(metadata.getByText('Apache-2.0')).toBeVisible();
  await expect(metadata.getByText('acme-platform')).toBeVisible();
  await expect(page.getByTitle('Source location')).toHaveText('skills/pdf-processing');

  const prose = page.locator('.prose');
  await expect(prose.getByRole('heading', { level: 2, name: 'Workflows' })).toBeVisible();
  await expect(prose.getByRole('table')).toBeVisible();
  await expect(prose.getByRole('cell', { name: 'Falls back to OCR when empty' })).toBeVisible();
  await expect(prose.locator('pre .hljs-keyword').first()).toBeVisible(); // syntax highlighting
  await expect(prose.getByRole('checkbox')).toHaveCount(3); // task list
  await expect(prose.getByRole('checkbox').first()).toBeChecked();

  // A relative image inside the skill is served from the published files.
  const image = prose.getByRole('img', { name: 'Page layout diagram' });
  await expect(image).toHaveAttribute('src', '/demo/files/pdf-processing/assets/page-layout.png');
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(320);

  // Table of contents jumps to headings.
  await page.getByRole('link', { name: 'Edge cases' }).click();
  await expect(page).toHaveURL(/#edge-cases$/);
  await expect(prose.getByRole('heading', { name: 'Edge cases' })).toBeInViewport();
});

test('code blocks can be copied', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(url('skills/pdf-processing/'));
  const block = page.locator('.codeblock').filter({ hasText: 'scripts/extract_text.py input.pdf' });
  await block.hover();
  await block.getByRole('button', { name: 'Copy code' }).click();
  await expect(block.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'python scripts/extract_text.py input.pdf --format markdown',
  );
});

test('internal links and the file tree open supporting files', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(url('skills/pdf-processing/'));

  // Markdown link in SKILL.md → rendered reference document.
  await page.locator('.prose').getByRole('link', { name: 'the form guide' }).click();
  await expect(page).toHaveURL(url('skills/pdf-processing/?file=references%2FFORMS.md'));
  await expect(page.getByRole('heading', { level: 1, name: 'Form guide' })).toBeVisible();

  // Link between two reference files, relative to the document.
  await page.locator('.prose').getByRole('link', { name: 'the layout reference' }).click();
  await expect(page).toHaveURL(url('skills/pdf-processing/?file=references%2Flayout.md'));
  await expect(page.getByRole('heading', { level: 1, name: 'Layout reference' })).toBeVisible();

  // File tree → script source with highlighting.
  const tree = page.getByRole('navigation', { name: 'Skill files' });
  await tree.getByRole('link', { name: 'extract_text.py' }).click();
  await expect(page.getByRole('heading', { name: 'scripts/extract_text.py' })).toBeVisible();
  await expect(page.locator('pre code')).toContainText('def extract(path: str, fmt: str) -> str:');
  await expect(page.locator('pre code .hljs-keyword').first()).toBeVisible();
  await expect(tree.getByRole('link', { name: 'extract_text.py' })).toHaveAttribute('aria-current', 'page');

  await page.getByRole('button', { name: 'Copy relative path', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('scripts/extract_text.py');

  // Image asset preview.
  await tree.getByRole('link', { name: 'page-layout.png' }).click();
  await expect(page.getByRole('img', { name: 'assets/page-layout.png' })).toBeVisible();

  // Folders collapse.
  await tree.getByRole('button', { name: /^scripts/ }).click();
  await expect(tree.getByRole('link', { name: 'fill_form.py' })).toBeHidden();

  await page.getByRole('link', { name: 'Back to instructions' }).click();
  await expect(page).toHaveURL(url('skills/pdf-processing/'));
});

test('a link into another skill navigates to that skill', async ({ page }) => {
  await page.goto(url('skills/database-migration/'));
  await page.locator('.prose').getByRole('link', { name: 'code-review skill' }).click();
  await expect(page).toHaveURL(url('skills/code-review/'));
});

test('search finds skills by content and file name, with the keyboard', async ({ page }) => {
  await page.goto(url());
  await page.keyboard.press('/');
  const search = page.getByRole('searchbox', { name: 'Search skills' });
  await expect(search).toBeFocused();

  await search.fill('concurrently');
  const results = page.getByRole('region', { name: 'Search results' });
  await expect(results.getByRole('link')).toHaveCount(1);
  await expect(results.getByRole('link', { name: /database-migration/ })).toBeVisible();
  await expect(results.locator('mark').first()).toHaveText(/concurrently/i);

  // File names are searchable and link straight to the file.
  await search.fill('checklist');
  await expect(results.getByRole('link', { name: 'references/checklist.md', exact: true })).toBeVisible();

  // Arrow keys move through results, Enter opens the focused one.
  await search.fill('pdf');
  await search.press('ArrowDown');
  await expect(results.getByRole('link').first()).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(url('skills/pdf-processing/'));

  await search.fill('zzzz-no-such-thing');
  await expect(results.getByText('No skills match')).toBeVisible();

  await search.press('Escape');
  await expect(search).toHaveValue('');
  await expect(page.getByRole('navigation', { name: 'Skills' })).toBeVisible();
});

test('architecture graph shows real structure, filters, and navigates', async ({ page }) => {
  await page.goto(url('architecture/'));
  const graph = page.getByTestId('graph');
  await expect(graph.locator('.react-flow__node')).toHaveCount(17); // 5 skills + 12 files
  await expect(graph.locator('.react-flow__node', { hasText: 'incident-triage' })).toBeVisible();

  // Filtering by resource type.
  await page.getByRole('button', { name: /Scripts/ }).click();
  await expect(graph.locator('.react-flow__node')).toHaveCount(13);
  await expect(graph.locator('.react-flow__node', { hasText: 'fill_form.py' })).toHaveCount(0);
  await page.getByRole('button', { name: /Scripts/ }).click();

  // Zoom controls exist; fit view keeps nodes on screen.
  await page.getByRole('button', { name: /zoom in/i }).click();
  await page.getByRole('button', { name: /fit view/i }).click();
  await expect(graph.locator('.react-flow__node', { hasText: 'pdf-processing' })).toBeInViewport();

  // Clicking a file node opens that file.
  await graph.locator('.react-flow__node', { hasText: 'FORMS.md' }).click();
  await expect(page).toHaveURL(url('skills/pdf-processing/?file=references%2FFORMS.md'));

  await page.goto(url('architecture/'));
  await page.getByTestId('graph').locator('.react-flow__node', { hasText: 'code-review' }).click();
  await expect(page).toHaveURL(url('skills/code-review/'));
});

test('the dark theme is the default; the toggle switches and is remembered', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' }); // the default does not follow the system
  await page.goto(url());
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('button', { name: 'Switch to dark theme' })).toBeVisible();
});

test('unknown skills and unknown pages show a helpful state', async ({ page }) => {
  await page.goto(url('skills/'));
  await page.evaluate(() => history.pushState({}, '', '/demo/skills/nope/'));
  await page.goBack();
  await page.goForward();
  await expect(page.getByRole('heading', { name: 'Skill not found' })).toBeVisible();

  // A URL that has no generated page gets the static 404 page, which still boots the viewer.
  const response = await page.goto(url('nothing/here/'));
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await page.getByRole('link', { name: 'Go to the overview' }).click();
  await expect(page).toHaveURL(url());
});

test('is usable on a phone-sized screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(url());
  await expect(page.getByRole('navigation', { name: 'Skills' })).toBeHidden();

  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('navigation', { name: 'Skills' }).getByRole('link', { name: 'release-notes' }).click();
  await expect(page).toHaveURL(url('skills/release-notes/'));
  await expect(page.getByRole('navigation', { name: 'Skills' })).toBeHidden(); // drawer closed
  await expect(page.getByRole('heading', { level: 1, name: 'release-notes' })).toBeVisible();

  // No horizontal overflow of the page itself.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
