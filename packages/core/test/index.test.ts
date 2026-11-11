import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { indexProject, MAX_TEXT_BYTES } from '../src/index.js';
import { makeProject, skillMd, type Tree } from './helpers.js';

const created: string[] = [];
async function project(tree: Tree): Promise<string> {
  const dir = await makeProject(tree);
  created.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of created.splice(0)) {
    await fs.chmod(dir, 0o755).catch(() => {});
    await fs.rm(dir, { recursive: true, force: true });
  }
});

const names = (r: Awaited<ReturnType<typeof indexProject>>) => r.catalog.skills.map((s) => s.name);

describe('discovery', () => {
  it('finds skills in the well-known locations without configuration', async () => {
    const root = await project({
      skills: { pdf: { 'SKILL.md': skillMd('pdf') } },
      '.claude': { skills: { review: { 'SKILL.md': skillMd('review') } } },
      '.agents': { skills: { deploy: { 'SKILL.md': skillMd('deploy') } } },
      src: { 'SKILL.md': skillMd('not-a-skill-root') },
    });
    const result = await indexProject({ root });
    expect(names(result).sort()).toEqual(['deploy', 'pdf', 'review']);
    expect(result.catalog.sources.map((s) => s.path)).toEqual([
      '.agents/skills',
      '.claude/skills',
      'skills',
    ]);
  });

  it('finds nested skills and keeps them out of the parent resources', async () => {
    const root = await project({
      skills: {
        documents: {
          pdf: {
            'SKILL.md': skillMd('pdf'),
            'notes.md': '# notes',
            inner: { 'SKILL.md': skillMd('inner'), 'inner.txt': 'x' },
          },
        },
      },
    });
    const result = await indexProject({ root });
    expect(names(result)).toEqual(['inner', 'pdf']);
    const pdf = result.catalog.skills.find((s) => s.name === 'pdf')!;
    expect(pdf.sourcePath).toBe('skills/documents/pdf');
    expect(pdf.resources.map((r) => r.path)).toEqual(['notes.md']);
  });

  it('supports explicit roots, including a root that is itself a skill', async () => {
    const root = await project({
      custom: { a: { 'SKILL.md': skillMd('a') } },
      single: { 'SKILL.md': skillMd('single') },
      skills: { ignored: { 'SKILL.md': skillMd('ignored-default') } },
    });
    const result = await indexProject({ root, skills: ['./custom', 'single', './missing'] });
    expect(names(result)).toEqual(['a', 'single']);
    expect(result.catalog.diagnostics.map((d) => d.code)).toEqual(['root-not-found']);
  });

  it('does not index the same directory twice through overlapping roots', async () => {
    const root = await project({ skills: { group: { pdf: { 'SKILL.md': skillMd('pdf') } } } });
    const result = await indexProject({ root, skills: ['skills', 'skills/group', './skills/'] });
    expect(names(result)).toEqual(['pdf']);
  });

  it('gives duplicate names distinct, path-derived, stable ids', async () => {
    const root = await project({
      skills: { pdf: { 'SKILL.md': skillMd('pdf') } },
      '.claude': { skills: { pdf: { 'SKILL.md': skillMd('pdf') } } },
    });
    const ids = (await indexProject({ root })).catalog.skills.map((s) => s.id);
    expect(ids).toEqual(['claude-skills-pdf', 'skills-pdf']);
    expect((await indexProject({ root })).catalog.skills.map((s) => s.id)).toEqual(ids);
  });

  it('respects ignore patterns from options and .skillariumignore', async () => {
    const root = await project({
      '.skillariumignore': 'skills/drafts/\n*.bak\n',
      skills: {
        drafts: { wip: { 'SKILL.md': skillMd('wip') } },
        legacy: { 'SKILL.md': skillMd('legacy') },
        pdf: { 'SKILL.md': skillMd('pdf'), 'old.bak': 'x', 'keep.txt': 'x' },
      },
    });
    const result = await indexProject({ root, ignore: ['skills/legacy'] });
    expect(names(result)).toEqual(['pdf']);
    expect(result.catalog.skills[0]!.resources.map((r) => r.path)).toEqual(['keep.txt']);
  });

  it('skips hidden directories and node_modules', async () => {
    const root = await project({
      skills: {
        pdf: {
          'SKILL.md': skillMd('pdf'),
          node_modules: { dep: { 'SKILL.md': skillMd('dep'), 'index.js': '' } },
          '.git': { config: 'secret' },
          '.env': 'TOKEN=abc',
        },
      },
    });
    const result = await indexProject({ root });
    expect(names(result)).toEqual(['pdf']);
    expect(result.catalog.skills[0]!.resources).toEqual([]);
  });

  it('keeps malformed skills visible with diagnostics', async () => {
    const root = await project({
      skills: {
        broken: { 'SKILL.md': '---\nname: [oops\n---\nStill readable' },
        bare: { 'SKILL.md': '# No frontmatter' },
        empty: { 'SKILL.md': '---\nname: empty\ndescription: ""\n---\n' },
        good: { 'SKILL.md': skillMd('good') },
      },
    });
    const { catalog } = await indexProject({ root });
    const byName = Object.fromEntries(catalog.skills.map((s) => [s.name, s]));
    expect(byName.broken!.diagnostics[0]!.code).toBe('invalid-yaml');
    expect(byName.broken!.content).toBe('Still readable');
    expect(byName.bare!.diagnostics[0]!.code).toBe('missing-frontmatter');
    expect(byName.empty!.diagnostics.map((d) => d.code)).toEqual(['missing-description']);
    expect(byName.good!.diagnostics).toEqual([]);
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'reports unreadable directories instead of failing',
    async () => {
      const root = await project({
        skills: { pdf: { 'SKILL.md': skillMd('pdf') }, locked: { 'SKILL.md': skillMd('locked') } },
      });
      const locked = path.join(root, 'skills', 'locked');
      await fs.chmod(locked, 0o000);
      try {
        const result = await indexProject({ root });
        expect(names(result)).toEqual(['pdf']);
        expect(result.catalog.diagnostics.map((d) => d.code)).toContain('unreadable-directory');
      } finally {
        await fs.chmod(locked, 0o755);
      }
    },
  );

  it('returns an empty catalog for a project without skills', async () => {
    const root = await project({ 'README.md': '# nothing' });
    const { catalog, files } = await indexProject({ root });
    expect(catalog.skills).toEqual([]);
    expect(catalog.searched).toContain('.claude/skills');
    expect(files.size).toBe(0);
  });
});

describe('resources', () => {
  it('classifies files by convention and content', async () => {
    const root = await project({
      skills: {
        pdf: {
          'SKILL.md': skillMd('pdf'),
          'FORMS.md': '# forms',
          scripts: { 'run.py': 'print(1)', tool: '#!/bin/sh\necho hi\n' },
          references: { 'guide.md': '# guide' },
          assets: {
            'logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]),
            'icon.svg': '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
            'data.bin': Buffer.from([0, 1, 2, 3, 0, 255]),
          },
        },
      },
    });
    const { catalog, files } = await indexProject({ root });
    const byPath = Object.fromEntries(catalog.skills[0]!.resources.map((r) => [r.path, r]));

    expect(byPath['scripts/run.py']).toMatchObject({ kind: 'script', preview: 'text', language: 'python' });
    expect(byPath['scripts/tool']).toMatchObject({ kind: 'script', preview: 'text', language: 'plaintext' });
    expect(byPath['references/guide.md']).toMatchObject({ kind: 'reference', preview: 'markdown' });
    expect(byPath['FORMS.md']).toMatchObject({ kind: 'other', preview: 'markdown' });
    expect(byPath['assets/logo.png']).toMatchObject({ kind: 'asset', preview: 'image', url: 'files/pdf/assets/logo.png' });
    expect(byPath['assets/data.bin']).toMatchObject({ preview: 'none', omitted: 'unsupported' });
    expect(byPath['assets/data.bin']!.url).toBeUndefined();

    // SVG and every other text file is published as text/plain with a .txt suffix.
    expect(byPath['assets/icon.svg']).toMatchObject({ preview: 'text', url: 'files/pdf/assets/icon.svg.txt' });
    expect(files.get('files/pdf/assets/icon.svg.txt')!.contentType).toBe('text/plain; charset=utf-8');
    expect(files.get('files/pdf/scripts/run.py.txt')).toBeDefined();
    expect(files.has('files/pdf/assets/data.bin')).toBe(false);
  });

  it('lists oversized files without publishing their content', async () => {
    const root = await project({
      skills: { pdf: { 'SKILL.md': skillMd('pdf'), 'big.txt': 'a'.repeat(MAX_TEXT_BYTES + 1) } },
    });
    const { catalog, files } = await indexProject({ root });
    const big = catalog.skills[0]!.resources[0]!;
    expect(big).toMatchObject({ path: 'big.txt', omitted: 'too-large' });
    expect(big.url).toBeUndefined();
    expect(files.size).toBe(0);
  });

  it('excludes key and credential files', async () => {
    const root = await project({
      skills: {
        pdf: { 'SKILL.md': skillMd('pdf', 'd', 'See ok.txt.'), 'server.pem': 'KEY', id_rsa: 'KEY', 'ok.txt': 'fine' },
      },
    });
    const { catalog, files } = await indexProject({ root });
    const skill = catalog.skills[0]!;
    expect(skill.resources.map((r) => r.path)).toEqual(['ok.txt']);
    expect(skill.diagnostics.map((d) => d.code)).toEqual(['secret-files-excluded']);
    expect([...files.keys()]).toEqual(['files/pdf/ok.txt.txt']);
  });
});

describe('filesystem safety', () => {
  it.skipIf(process.platform === 'win32')(
    'never follows symlinks that leave the skill root',
    async () => {
      const outside = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'skillarium-out-')));
      created.push(outside);
      await fs.writeFile(path.join(outside, 'secret.txt'), 'TOP SECRET');
      await fs.mkdir(path.join(outside, 'evil'));
      await fs.writeFile(path.join(outside, 'evil', 'SKILL.md'), skillMd('evil'));

      const root = await project({
        'private.txt': 'project secret',
        skills: { pdf: { 'SKILL.md': skillMd('pdf'), real: { 'a.txt': 'a' } } },
      });
      const skill = path.join(root, 'skills', 'pdf');
      await fs.symlink(path.join(outside, 'secret.txt'), path.join(skill, 'leak.txt'));
      await fs.symlink(path.join(root, 'private.txt'), path.join(skill, 'project-leak.txt'));
      await fs.symlink(outside, path.join(skill, 'outside-dir'));
      await fs.symlink(path.join(outside, 'evil'), path.join(root, 'skills', 'evil'));
      await fs.symlink(skill, path.join(skill, 'real', 'loop')); // cycle
      await fs.symlink(path.join(skill, 'real', 'a.txt'), path.join(skill, 'inside-link.txt'));

      const { catalog, files } = await indexProject({ root });
      expect(catalog.skills.map((s) => s.name)).toEqual(['pdf']);
      expect(catalog.skills[0]!.resources.map((r) => r.path)).toEqual([
        'inside-link.txt',
        'real/a.txt',
      ]);
      expect(catalog.diagnostics.filter((d) => d.code === 'symlink-escape')).toHaveLength(4);
      for (const file of files.values()) {
        expect(file.absPath.startsWith(path.join(root, 'skills'))).toBe(true);
      }
    },
  );

  it('never puts absolute paths or the project location into the catalog', async () => {
    const root = await project({
      skills: { pdf: { 'SKILL.md': skillMd('pdf'), scripts: { 'a.sh': 'echo' } } },
    });
    const { catalog } = await indexProject({ root, project: { title: 'Test' } });
    const json = JSON.stringify(catalog);
    expect(json).not.toContain(root);
    expect(json).not.toContain(os.homedir());
    expect(json).not.toContain(os.tmpdir());
  });

  it('produces identical output for identical input', async () => {
    const root = await project({
      skills: {
        b: { 'SKILL.md': skillMd('b'), 'z.txt': '1', 'a.txt': '2' },
        a: { 'SKILL.md': skillMd('a') },
      },
    });
    const first = JSON.stringify((await indexProject({ root })).catalog);
    const second = JSON.stringify((await indexProject({ root })).catalog);
    expect(second).toBe(first);
    expect(JSON.parse(first).skills.map((s: { name: string }) => s.name)).toEqual(['a', 'b']);
  });
});

describe('graph', () => {
  it('contains only filesystem and explicitly referenced relationships', async () => {
    const root = await project({
      skills: {
        pdf: {
          'SKILL.md': skillMd(
            'pdf',
            'd',
            'See [forms](references/FORMS.md).\nRun scripts/extract.py now.\nThe word extract alone is not a reference.\nSee the [review skill](../review/SKILL.md) and [site](https://example.com/scripts/unused.py).\n',
          ),
          scripts: { 'extract.py': '', 'unused.py': '' },
          references: { 'FORMS.md': 'Compare with [layout](layout.md).', 'layout.md': '# l' },
        },
        review: { 'SKILL.md': skillMd('review', 'd', 'Works well with pdf skills in general.') },
      },
    });
    const { graph } = (await indexProject({ root })).catalog;
    const edges = graph.edges.filter((e) => e.kind !== 'contains').map((e) => `${e.source} -> ${e.target} [${e.kind}]`);
    expect(edges.sort()).toEqual([
      'file:pdf:references/FORMS.md -> file:pdf:references/layout.md [references]',
      'skill:pdf -> file:pdf:references/FORMS.md [references]',
      'skill:pdf -> file:pdf:scripts/extract.py [references]',
      'skill:pdf -> skill:review [links-to-skill]',
    ]);
    expect(graph.edges.filter((e) => e.kind === 'contains')).toHaveLength(4);
    expect(graph.nodes.filter((n) => n.type === 'skill')).toHaveLength(2);
    expect(graph.edges.every((e) => e.evidence.length > 0)).toBe(true);
  });
});
