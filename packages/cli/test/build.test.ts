import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Catalog } from '@skillarium/core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildSite } from '../src/build.js';
import { loadConfig, normalizeBase, UsageError } from '../src/config.js';
import { openProject } from '../src/project.js';
import { startPreviewServer, type RunningServer } from '../src/server.js';
import { cleanup, get, listFiles, makeProject, SAMPLE, skillMd } from './helpers.js';

afterAll(cleanup);

async function hashes(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const file of await listFiles(dir)) {
    out[file] = createHash('sha256').update(await fs.readFile(path.join(dir, file))).digest('hex');
  }
  return out;
}

describe('static build', () => {
  let root: string;
  let outDir: string;

  beforeAll(async () => {
    root = await makeProject(SAMPLE);
    const project = await openProject({ root });
    ({ outDir } = await buildSite({ project, base: '/docs/' }));
  });

  it('writes a page for every route, the catalog and the published files', async () => {
    const files = await listFiles(outDir);
    expect(files).toEqual(
      expect.arrayContaining([
        'index.html',
        '404.html',
        'skills/index.html',
        'skills/pdf/index.html',
        'skills/review/index.html',
        'architecture/index.html',
        'data/catalog.json',
        'files/pdf/scripts/run.py.txt',
        'files/pdf/references/guide.md.txt',
        'files/pdf/assets/logo.png',
        '.nojekyll',
      ]),
    );
    expect(files.some((f) => /^assets\/.+\.js$/.test(f))).toBe(true);
  });

  it('rewrites asset URLs and the base marker for the configured base path', async () => {
    const html = await fs.readFile(path.join(outDir, 'skills/pdf/index.html'), 'utf8');
    expect(html).toContain('<meta name="skillarium-base" content="/docs/" />');
    expect(html).toMatch(/src="\/docs\/assets\/[^"]+\.js"/);
    expect(html).toMatch(/href="\/docs\/assets\/[^"]+\.css"/);
    expect(html).not.toMatch(/(src|href)="\.\//);
    expect(html).toContain('Content-Security-Policy');
  });

  it('escapes untrusted skill text placed into HTML', async () => {
    const html = await fs.readFile(path.join(outDir, 'skills/pdf/index.html'), 'utf8');
    expect(html).toContain('<title>pdf · ');
    expect(html).toContain('content="Handles &lt;b&gt;PDF&lt;/b&gt; &quot;files&quot; &amp; forms."');
    expect(html).not.toContain('<b>PDF</b>');
  });

  it('contains nothing from outside the skills and no local paths', async () => {
    for (const file of await listFiles(outDir)) {
      const content = await fs.readFile(path.join(outDir, file), 'utf8');
      expect(content, file).not.toContain('SUPER_SECRET_VALUE');
      expect(content, file).not.toContain(root);
      expect(content, file).not.toContain(os.homedir());
    }
    const catalog = JSON.parse(await fs.readFile(path.join(outDir, 'data/catalog.json'), 'utf8')) as Catalog;
    expect(catalog.mode).toBe('static');
    expect(catalog.skills.map((s) => s.sourcePath)).toEqual(['skills/pdf', 'skills/review']);
  });

  it('is deterministic', async () => {
    const project = await openProject({ root });
    const first = await hashes(outDir);
    const second = await buildSite({ project, base: '/docs/', outDir: 'second-build' });
    expect(await hashes(second.outDir)).toEqual(first);
  });

  it('replaces its own previous output but never a foreign directory', async () => {
    const project = await openProject({ root });
    await fs.writeFile(path.join(outDir, 'stale.txt'), 'old');
    await buildSite({ project, base: '/docs/' });
    expect(await listFiles(outDir)).not.toContain('stale.txt');

    await fs.mkdir(path.join(root, 'precious'));
    await fs.writeFile(path.join(root, 'precious', 'thesis.txt'), 'important');
    await expect(buildSite({ project, outDir: 'precious' })).rejects.toThrow(UsageError);
    await expect(buildSite({ project, outDir: '.' })).rejects.toThrow(UsageError);
    expect(await fs.readFile(path.join(root, 'precious', 'thesis.txt'), 'utf8')).toBe('important');
  });

  it('builds an empty but valid site for a project without skills', async () => {
    const empty = await makeProject({ 'README.md': '# nothing here' });
    const result = await buildSite({ project: await openProject({ root: empty }) });
    expect(result.catalog.skills).toEqual([]);
    expect(await listFiles(result.outDir)).toEqual(expect.arrayContaining(['index.html', 'data/catalog.json']));
  });
});

describe('static preview (plain static host behaviour)', () => {
  let server: RunningServer;
  let outDir: string;

  beforeAll(async () => {
    const root = await makeProject(SAMPLE);
    ({ outDir } = await buildSite({ project: await openProject({ root }), base: '/docs/' }));
    server = await startPreviewServer({ dir: outDir, base: '/docs/', port: 0 });
  });
  afterAll(() => server.close());

  it('serves every route directly, without a single-page-app fallback', async () => {
    for (const route of ['/docs/', '/docs/skills/', '/docs/skills/pdf/', '/docs/skills/review/', '/docs/architecture/']) {
      const res = await get(server.port, route);
      expect(res.status, route).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.body).toContain('skillarium-base');
    }
    // A query string (file selection) on a refresh still hits the same page.
    expect((await get(server.port, '/docs/skills/pdf/?file=scripts%2Frun.py')).status).toBe(200);
  });

  it('redirects directory URLs without a trailing slash and the root to the base', async () => {
    const res = await get(server.port, '/docs/skills/pdf?file=a');
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe('/docs/skills/pdf/?file=a');
    expect((await get(server.port, '/')).headers.location).toBe('/docs/');
  });

  it('answers unknown routes with 404.html instead of the app', async () => {
    const res = await get(server.port, '/docs/skills/does-not-exist/');
    expect(res.status).toBe(404);
    expect(res.body).toContain('<title>Not found');
  });

  it('serves every resource URL listed in the catalog', async () => {
    const catalog = JSON.parse((await get(server.port, '/docs/data/catalog.json')).body) as Catalog;
    const urls = catalog.skills.flatMap((s) => s.resources.flatMap((r) => (r.url ? [r.url] : [])));
    expect(urls).toHaveLength(3);
    for (const url of urls) expect((await get(server.port, `/docs/${url}`)).status, url).toBe(200);
    const script = await get(server.port, '/docs/files/pdf/scripts/run.py.txt');
    expect(script.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(script.headers['x-content-type-options']).toBe('nosniff');
    expect(script.body).toBe('print("hello")\n');
  });

  it('cannot be used to read files outside the output directory', async () => {
    for (const attack of [
      '/docs/../private.txt',
      '/docs/..%2fprivate.txt',
      '/docs/%2e%2e/%2e%2e/private.txt',
      '/docs/files/../../skills/pdf/SKILL.md',
      '/docs//etc/passwd',
      '/docs/%00',
      '/etc/passwd',
    ]) {
      const res = await get(server.port, attack);
      expect([400, 404], attack).toContain(res.status);
      expect(res.body, attack).not.toContain('SUPER_SECRET_VALUE');
      expect(res.body, attack).not.toContain('name: pdf');
    }
  });

  it('rejects requests for a foreign Host (DNS rebinding)', async () => {
    expect((await get(server.port, '/docs/', { Host: 'evil.example' })).status).toBe(403);
    expect((await get(server.port, '/docs/', { Host: `localhost:${server.port}` })).status).toBe(200);
  });
});

describe('configuration', () => {
  afterEach(cleanup);

  it('is optional', async () => {
    const root = await makeProject({ skills: { a: { 'SKILL.md': skillMd('a') } } });
    expect(await loadConfig(root)).toEqual({ config: {} });
  });

  it('loads a typed TypeScript config that imports defineConfig', async () => {
    const root = await makeProject({
      'skillarium.config.ts':
        "import { defineConfig } from 'skillarium';\nconst dir: string = './custom';\nexport default defineConfig({ title: 'Team Skills', skills: [dir], base: '/team/' });\n",
      custom: { a: { 'SKILL.md': skillMd('a') } },
      skills: { ignored: { 'SKILL.md': skillMd('ignored') } },
    });
    const project = await openProject({ root });
    expect(project.config).toEqual({ title: 'Team Skills', skills: ['./custom'], base: '/team/' });
    const result = await buildSite({ project });
    expect(result.base).toBe('/team/');
    expect(result.catalog.project.title).toBe('Team Skills');
    expect(result.catalog.skills.map((s) => s.name)).toEqual(['a']);
  });

  it('loads JSON config and lets explicit options override it', async () => {
    const root = await makeProject({
      'skillarium.config.json': JSON.stringify({ outDir: 'site', base: '/from-config/' }),
      skills: { a: { 'SKILL.md': skillMd('a') } },
    });
    const project = await openProject({ root });
    const result = await buildSite({ project, base: '/override/' });
    expect(result.base).toBe('/override/');
    expect(path.basename(result.outDir)).toBe('site');
  });

  it('rejects invalid configuration with a clear message', async () => {
    const root = await makeProject({ 'skillarium.config.json': JSON.stringify({ skils: ['x'] }) });
    await expect(loadConfig(root)).rejects.toThrow(/unknown option "skils"/);
    const other = await makeProject({ 'skillarium.config.json': JSON.stringify({ skills: 'x' }) });
    await expect(loadConfig(other)).rejects.toThrow(/must be an array of strings/);
  });

  it('normalizes base paths and rejects unsafe ones', () => {
    expect(normalizeBase(undefined)).toBe('/');
    expect(normalizeBase('/')).toBe('/');
    expect(normalizeBase('my-repo')).toBe('/my-repo/');
    expect(normalizeBase('/a/b')).toBe('/a/b/');
    expect(() => normalizeBase('https://example.com/x/')).toThrow(UsageError);
    expect(() => normalizeBase('/a/"><script>')).toThrow(UsageError);
    expect(() => normalizeBase('/a/../b/')).toThrow(UsageError);
  });
});
