import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { Catalog } from '@skillarium/core';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openProject } from '../src/project.js';
import { startDevServer, type DevServer } from '../src/server.js';
import { cleanup, get, listFiles, makeProject, SAMPLE, skillMd } from './helpers.js';

afterAll(cleanup);

async function catalog(port: number): Promise<Catalog> {
  return JSON.parse((await get(port, '/data/catalog.json')).body) as Catalog;
}

/**
 * Subscribe to the server's event stream. Resolves once the stream is open;
 * the returned `reload` promise settles on the next reload event.
 */
function subscribe(port: number, timeoutMs = 10_000): Promise<{ reload: Promise<void> }> {
  return new Promise((ready) => {
    let settle!: { resolve: () => void; reject: (error: Error) => void };
    const reload = new Promise<void>((resolve, reject) => (settle = { resolve, reject }));
    reload.catch(() => {}); // callers decide whether a timeout matters
    const req = http.get({ host: '127.0.0.1', port, path: '/__skillarium/events' }, (res) => {
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        if (chunk.includes(': connected')) ready({ reload });
        if (chunk.includes('event: reload')) {
          clearTimeout(timer);
          req.destroy();
          settle.resolve();
        }
      });
    });
    const timer = setTimeout(() => {
      req.destroy();
      settle.reject(new Error('no reload event received'));
    }, timeoutMs);
    req.on('error', () => {
      /* destroyed on purpose */
    });
  });
}

describe('development server', () => {
  let root: string;
  let server: DevServer;

  beforeEach(async () => {
    root = await makeProject(SAMPLE);
    server = await startDevServer({ project: await openProject({ root }), port: 0 });
  });
  afterEach(() => server.close());

  it('starts on the loopback interface and serves the viewer and the catalog', async () => {
    expect(server.url).toBe(`http://127.0.0.1:${server.port}/`);
    const data = await catalog(server.port);
    expect(data.mode).toBe('dev');
    expect(data.skills.map((s) => s.name)).toEqual(['pdf', 'review']);

    for (const route of ['/', '/skills/pdf/', '/architecture/']) {
      const page = await get(server.port, route);
      expect(page.status, route).toBe(200);
      expect(page.headers['content-type']).toContain('text/html');
      expect(page.headers['content-security-policy']).toContain("script-src 'self'");
    }
    const html = (await get(server.port, '/')).body;
    const script = /src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
    expect(script).toBeDefined();
    expect((await get(server.port, script!)).headers['content-type']).toContain('javascript');
  });

  it('serves only files the indexer published', async () => {
    const ok = await get(server.port, '/files/pdf/scripts/run.py.txt');
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(ok.body).toBe('print("hello")\n');

    for (const attack of [
      '/files/pdf/scripts/run.py', // the raw file is not a published URL
      '/files/pdf/SKILL.md',
      '/files/pdf/../../private.txt',
      '/files/pdf/..%2f..%2fprivate.txt',
      '/files/%2e%2e/%2e%2e/.env',
      '/files/pdf/scripts/../../../.env.txt',
      '/private.txt',
      '/.env',
      '/src/app.ts',
      '/../../../../etc/passwd',
      '/assets/../../../package.json',
    ]) {
      const res = await get(server.port, attack);
      // Either "not found", or (for extensionless paths, which are viewer
      // routes) the viewer page itself. Never the content of a local file.
      if (res.status === 200) expect(res.body, attack).toContain('<div id="root">');
      else expect(res.status, attack).toBe(404);
      expect(res.body, attack).not.toContain('SUPER_SECRET_VALUE');
      expect(res.body, attack).not.toContain('print("hello")');
    }
  });

  it('rejects other methods and foreign Host headers', async () => {
    expect((await get(server.port, '/data/catalog.json', { Host: 'attacker.example' })).status).toBe(403);
    const post = await fetch(`http://127.0.0.1:${server.port}/data/catalog.json`, { method: 'POST' });
    expect(post.status).toBe(405);
  });

  it('reindexes and notifies the viewer when a skill changes', async () => {
    const { reload } = await subscribe(server.port);
    await fs.writeFile(path.join(root, 'skills/pdf/SKILL.md'), skillMd('pdf', 'An updated description.'));
    await reload;
    const pdf = (await catalog(server.port)).skills.find((s) => s.name === 'pdf')!;
    expect(pdf.description).toBe('An updated description.');
  });

  it('picks up added and removed skills', async () => {
    let { reload } = await subscribe(server.port);
    await fs.mkdir(path.join(root, 'skills/deploy'));
    await fs.writeFile(path.join(root, 'skills/deploy/SKILL.md'), skillMd('deploy'));
    await reload;
    expect((await catalog(server.port)).skills.map((s) => s.name)).toEqual(['deploy', 'pdf', 'review']);

    ({ reload } = await subscribe(server.port));
    await fs.rm(path.join(root, 'skills/review'), { recursive: true });
    await reload;
    expect((await catalog(server.port)).skills.map((s) => s.name)).toEqual(['deploy', 'pdf']);
  });

  it('notices a skill root that did not exist at startup', async () => {
    const { reload } = await subscribe(server.port);
    await fs.mkdir(path.join(root, '.claude/skills/late'), { recursive: true });
    await fs.writeFile(path.join(root, '.claude/skills/late/SKILL.md'), skillMd('late'));
    await reload;
    expect((await catalog(server.port)).skills.map((s) => s.name)).toContain('late');
  });

  it('survives a malformed SKILL.md and reports it as a diagnostic', async () => {
    const { reload } = await subscribe(server.port);
    await fs.writeFile(path.join(root, 'skills/pdf/SKILL.md'), '---\nname: [broken\n---\nbody');
    await reload;
    const data = await catalog(server.port);
    expect(data.skills).toHaveLength(2);
    expect(data.skills.find((s) => s.sourcePath === 'skills/pdf')!.diagnostics[0]!.code).toBe('invalid-yaml');
    expect((await get(server.port, '/')).status).toBe(200);
  });
});

describe('shutdown', () => {
  it('closes the server, open event streams and the watcher', async () => {
    const root = await makeProject(SAMPLE);
    const server = await startDevServer({ project: await openProject({ root }), port: 0 });
    const { reload } = await subscribe(server.port, 1_500);
    const stream = reload.then(() => 'reloaded', (error: Error) => error.message);

    await server.close();
    await expect(get(server.port, '/')).rejects.toThrow();
    expect(await stream).toBe('no reload event received');
  });

  it('fails clearly when an explicitly requested port is taken', async () => {
    const root = await makeProject(SAMPLE);
    const project = await openProject({ root });
    const first = await startDevServer({ project, port: 0 });
    try {
      await expect(startDevServer({ project, port: first.port, strictPort: true })).rejects.toThrow(/already in use/);
    } finally {
      await first.close();
    }
  });
});

describe('command line', () => {
  const bin = fileURLToPath(new URL('../bin/skillarium.js', import.meta.url));
  const run = promisify(execFile);
  const cli = (args: string[]) =>
    run(process.execPath, [bin, ...args], { env: { ...process.env, NO_COLOR: '1' } }).then(
      (out) => ({ code: 0, ...out }),
      (error: { code: number; stdout: string; stderr: string }) => error,
    );

  it('lists skills as JSON', async () => {
    const root = await makeProject(SAMPLE);
    const { code, stdout } = await cli(['list', '--json', '--root', root]);
    expect(code).toBe(0);
    const rows = JSON.parse(stdout) as { id: string; path: string; files: number }[];
    expect(rows.map((r) => [r.id, r.path, r.files])).toEqual([
      ['pdf', 'skills/pdf', 3],
      ['review', 'skills/review', 0],
    ]);
  });

  it('inspects one skill and fails with a usage error for an unknown one', async () => {
    const root = await makeProject(SAMPLE);
    const found = await cli(['inspect', 'pdf', '--root', root]);
    expect(found.code).toBe(0);
    expect(found.stdout).toContain('scripts/run.py');
    expect(found.stdout).toContain('Markdown link in SKILL.md');

    const missing = await cli(['inspect', 'nope', '--root', root]);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain('No skill named "nope"');
  });

  it('prints a broken link as a warning and does not fail a --strict build for it', async () => {
    const root = await makeProject({
      skills: { pdf: { 'SKILL.md': skillMd('pdf', 'Does pdf. Use for pdf.', 'See [guide](references/guide.md).') } },
    });

    const listed = await cli(['list', '--root', root]);
    expect(listed.code).toBe(0);
    expect(listed.stdout).toContain('1 warning'); // `list` counts; `inspect` and `build` give the detail

    const json = JSON.parse((await cli(['list', '--json', '--root', root])).stdout) as {
      diagnostics: { severity: string; code: string; file: string }[];
    }[];
    expect(json[0]!.diagnostics).toMatchObject([{ severity: 'warning', code: 'broken-link', file: 'SKILL.md' }]);

    const inspected = await cli(['inspect', 'pdf', '--root', root]);
    expect(inspected.stdout).toContain('SKILL.md links to `references/guide.md`, which does not exist.');
    expect(inspected.stdout).toContain('broken-link');

    // A warning is something to fix, not a reason to stop a release.
    const strict = await cli(['build', '--root', root, '--strict', '--out-dir', path.join(root, 'out')]);
    expect(strict.code).toBe(0);
    expect(strict.stderr).toContain('which does not exist');
  });

  it('uses exit code 2 for usage errors and supports --strict builds', async () => {
    expect((await cli(['frobnicate'])).code).toBe(2);
    expect((await cli(['--port', 'abc'])).code).toBe(2); // no command means `dev`, which validates the port
    expect((await cli(['build', '--root', '/definitely/not/here'])).code).toBe(2);

    const root = await makeProject({ skills: { bad: { 'SKILL.md': '# no frontmatter' } } });
    expect((await cli(['build', '--root', root])).code).toBe(0);
    const strict = await cli(['build', '--root', root, '--strict']);
    expect(strict.code).toBe(1);
    expect(strict.stderr).toContain('--strict');
  });

  describe('check', () => {
    interface Report {
      ok: boolean;
      skills: number;
      errors: number;
      warnings: number;
      diagnostics: { severity: string; code: string; message: string; skill?: string; path: string; file?: string }[];
    }
    const BROKEN_LINK = skillMd('pdf', 'Does pdf. Use for pdf.', 'See [guide](references/guide.md).');
    const report = async (args: string[]) => {
      const result = await cli(['check', '--json', ...args]);
      return { code: result.code, report: JSON.parse(result.stdout) as Report };
    };

    it('passes a project without problems and writes nothing', async () => {
      const root = await makeProject({ skills: { pdf: { 'SKILL.md': skillMd('pdf') }, review: { 'SKILL.md': skillMd('review') } } });
      const before = await listFiles(root);
      const { code, stdout } = await cli(['check', '--root', root]);
      expect(code).toBe(0);
      expect(stdout).toContain('2 skills');
      expect(await listFiles(root)).toEqual(before);
    });

    it('fails with exit code 1 on an error, naming the skill, the problem and its code', async () => {
      const root = await makeProject({
        skills: { bad: { 'SKILL.md': '# no frontmatter' }, review: { 'SKILL.md': skillMd('review') } },
      });
      const before = await listFiles(root);
      const { code, stdout } = await cli(['check', '--root', root]);
      expect(code).toBe(1);
      expect(stdout).toContain('skills/bad');
      expect(stdout).toContain('does not start with a YAML frontmatter block');
      expect(stdout).toContain('missing-frontmatter');
      expect(stdout).toContain('1 error');
      expect(await listFiles(root)).toEqual(before);
    });

    it('prints warnings but only fails for them with --fail-on warning', async () => {
      const root = await makeProject({ skills: { pdf: { 'SKILL.md': BROKEN_LINK } } });

      const lenient = await cli(['check', '--root', root]);
      expect(lenient.code).toBe(0);
      expect(lenient.stdout).toContain('which does not exist');
      expect(lenient.stdout).toContain('1 warning');
      expect((await cli(['check', '--root', root, '--fail-on', 'error'])).code).toBe(0);

      const strict = await cli(['check', '--root', root, '--fail-on', 'warning']);
      expect(strict.code).toBe(1);
      expect(strict.stdout).toContain('which does not exist');
    });

    it('treats an unknown --fail-on value as a usage error', async () => {
      const root = await makeProject({ skills: { pdf: { 'SKILL.md': skillMd('pdf') } } });
      const result = await cli(['check', '--root', root, '--fail-on', 'info']);
      expect(result.code).toBe(2);
      expect(result.stderr).toContain('--fail-on');
    });

    it('fails when no skill is found', async () => {
      const root = await makeProject({ 'README.md': '# nothing here' });
      const result = await cli(['check', '--root', root]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('No Agent Skills found');

      const json = await report(['--root', root]);
      expect(json.code).toBe(1);
      expect(json.report).toEqual({ ok: false, skills: 0, errors: 0, warnings: 0, diagnostics: [] });
    });

    it('reports counts and problems as JSON, project-level ones first', async () => {
      const root = await makeProject({
        'skillarium.config.json': JSON.stringify({ skills: ['./missing', './skills'] }),
        skills: { bad: { 'SKILL.md': '# no frontmatter' }, pdf: { 'SKILL.md': BROKEN_LINK } },
      });
      const { code, report: result } = await report(['--root', root]);
      expect(code).toBe(1);
      expect(result).toEqual({
        ok: false,
        skills: 2,
        errors: 1,
        warnings: 2,
        diagnostics: [
          { severity: 'warning', code: 'root-not-found', message: 'Configured skill root does not exist.', path: 'missing' },
          {
            severity: 'error',
            code: 'missing-frontmatter',
            message: 'SKILL.md does not start with a YAML frontmatter block (--- … ---).',
            skill: 'bad',
            path: 'skills/bad',
            file: 'SKILL.md',
          },
          {
            severity: 'warning',
            code: 'broken-link',
            message: 'SKILL.md links to `references/guide.md`, which does not exist.',
            skill: 'pdf',
            path: 'skills/pdf',
            file: 'SKILL.md',
          },
        ],
      });
      // The same project gives the same output, and it holds no local path.
      const again = await cli(['check', '--json', '--root', root]);
      expect(again.stdout).toBe((await cli(['check', '--json', '--root', root])).stdout);
      expect(again.stdout).not.toContain(root);
    });

    it('gives ok: true in JSON when only warnings are present, unless they are made to fail', async () => {
      const root = await makeProject({ skills: { pdf: { 'SKILL.md': BROKEN_LINK } } });
      const lenient = await report(['--root', root]);
      expect([lenient.code, lenient.report.ok, lenient.report.warnings]).toEqual([0, true, 1]);
      const strict = await report(['--root', root, '--fail-on', 'warning']);
      expect([strict.code, strict.report.ok, strict.report.warnings]).toEqual([1, false, 1]);
    });

    it('neither prints nor counts informational notes', async () => {
      const root = await makeProject({ skills: { pdf: { 'SKILL.md': skillMd('pdf'), id_rsa: 'not a real key' } } });
      const { code, report: result } = await report(['--root', root]);
      expect(code).toBe(0);
      expect(result).toEqual({ ok: true, skills: 1, errors: 0, warnings: 0, diagnostics: [] });
      expect((await cli(['check', '--root', root])).stdout).not.toContain('excluded');
    });
  });
});
