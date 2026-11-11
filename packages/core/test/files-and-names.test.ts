import fs from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { indexProject, type SkillDiagnostic } from '../src/index.js';
import { makeProject, skillMd, type Tree } from './helpers.js';

// The checks that matter for skills written by an agent: it names files it
// never created (`missing-path`), creates files it never names
// (`orphan-file`), and writes a second skill instead of updating the first
// (`duplicate-name`). See docs/diagnostics.md.

const created: string[] = [];
async function project(tree: Tree): Promise<string> {
  const dir = await makeProject(tree);
  created.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of created.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

const pdf = (body: string, extra: Tree = {}): Tree => ({
  skills: { pdf: { 'SKILL.md': skillMd('pdf', 'Does pdf things. Use for pdf.', body), ...extra } },
});

/** Diagnostics with `code` of the skill at `sourcePath` (default: the only `pdf` skill). */
async function found(root: string, code: string, sourcePath = 'skills/pdf', options: { ignore?: string[] } = {}): Promise<SkillDiagnostic[]> {
  const { catalog } = await indexProject({ root, ...options });
  return catalog.skills.find((s) => s.sourcePath === sourcePath)!.diagnostics.filter((d) => d.code === code);
}

/** The path each diagnostic is about: the first thing in backticks in its message. */
const targets = (diagnostics: SkillDiagnostic[]) => diagnostics.map((d) => `${d.file}: ${/`([^`]+)`/.exec(d.message)?.[1]}`);

describe('missing-path', () => {
  it('reports a script that is named in the text but does not exist, as a warning', async () => {
    const root = await project(pdf('Run scripts/extract.py on the input.'));
    expect(await found(root, 'missing-path')).toEqual([
      {
        severity: 'warning',
        code: 'missing-path',
        message: 'SKILL.md names `scripts/extract.py`, which does not exist.',
        file: 'SKILL.md',
      },
    ]);
  });

  it('looks inside code too, where commands are written', async () => {
    const body = ['Use `python scripts/inline.py input.pdf`.', '', '```bash', './scripts/fenced.sh --all', '```'].join('\n');
    const root = await project(pdf(body));
    expect(targets(await found(root, 'missing-path'))).toEqual(['SKILL.md: scripts/inline.py', 'SKILL.md: scripts/fenced.sh']);
  });

  it('accepts a path that exists, in the catalog or only on disk', async () => {
    const root = await project(
      pdf('Run scripts/run.py, read references/guide.md, then scripts/draft.py.', {
        scripts: { 'run.py': '', 'draft.py': '' },
        references: { 'guide.md': 'Back to scripts/run.py.' },
      }),
    );
    expect(await found(root, 'missing-path', 'skills/pdf', { ignore: ['draft.py'] })).toEqual([]);
  });

  it('only checks files under scripts/ and references/ of this skill', async () => {
    const root = await project(
      pdf(
        'src/app.ts output/report.pdf https://example.com/assets/logo.png ../other/scripts/run.py ' +
          'tools/scripts/run.py my-scripts/a.py assets/bgm.mp3 assets/fonts/x.woff2',
      ),
    );
    expect(await found(root, 'missing-path')).toEqual([]);
  });

  it('does not take folders, patterns or placeholders for files', async () => {
    const root = await project(
      pdf('Put helpers in scripts/ and notes in references/drafts. Run scripts/*.py. Write scripts/<name>.py or references/{id}.md.'),
    );
    expect(await found(root, 'missing-path')).toEqual([]);
  });

  it('looks for the path from any folder above the document, up to the skill', async () => {
    const root = await project(
      pdf('See [forms](references/forms/overview.md).', {
        references: {
          forms: {
            'overview.md': 'Read `references/fields.md`, run scripts/check.py, then references/gone.md.',
            references: { 'fields.md': '# fields' },
            scripts: { 'check.py': '' },
          },
        },
      }),
    );
    expect(targets(await found(root, 'missing-path'))).toEqual(['references/forms/overview.md: references/gone.md']);
  });

  it('leaves out the punctuation that follows a path', async () => {
    const root = await project(pdf('See references/guide.md. Then (scripts/run.py), then "references/a.json": done.'));
    expect(targets(await found(root, 'missing-path'))).toEqual([
      'SKILL.md: references/guide.md',
      'SKILL.md: scripts/run.py',
      'SKILL.md: references/a.json',
    ]);
  });

  it('reports a path once per document, and names the document', async () => {
    const root = await project(
      pdf('scripts/gone.py and again scripts/gone.py. See [guide](references/guide.md).', {
        references: { 'guide.md': 'Also scripts/gone.py and references/gone.json.' },
      }),
    );
    expect(targets(await found(root, 'missing-path'))).toEqual([
      'references/guide.md: scripts/gone.py',
      'references/guide.md: references/gone.json',
      'SKILL.md: scripts/gone.py',
    ]);
  });

  it('takes a path that exists in another skill to mean that skill', async () => {
    const root = await project({
      skills: {
        pdf: { 'SKILL.md': skillMd('pdf', 'd', 'Follow the forms skill, references/fields.md, then references/nowhere.md.') },
        forms: { 'SKILL.md': skillMd('forms', 'd', 'See [fields](references/fields.md).'), references: { 'fields.md': '# fields' } },
      },
    });
    expect(targets(await found(root, 'missing-path'))).toEqual(['SKILL.md: references/nowhere.md']);
  });

  it('leaves a path that is also a broken link to broken-link', async () => {
    const root = await project(pdf('Read [the guide](references/guide.md), that is references/guide.md.'));
    expect(await found(root, 'missing-path')).toEqual([]);
    expect(targets(await found(root, 'broken-link'))).toEqual(['SKILL.md: references/guide.md']);
  });
});

describe('orphan-file', () => {
  it('reports a file that nothing refers to, as a warning', async () => {
    const root = await project(pdf('Nothing to see.', { assets: { 'template.json': '{}' } }));
    expect(await found(root, 'orphan-file')).toEqual([
      {
        severity: 'warning',
        code: 'orphan-file',
        message: '`assets/template.json` is never referenced from SKILL.md or the files it leads to, so an agent will not find it.',
        file: 'assets/template.json',
      },
    ]);
  });

  it('follows references through documents and scripts, however many steps', async () => {
    const root = await project(
      pdf('Start with [the guide](references/guide.md).', {
        references: { 'guide.md': 'Then run scripts/fill.py.' },
        scripts: { 'fill.py': 'open("../assets/template.json")\n' },
        assets: { 'template.json': '{}' },
      }),
    );
    expect(await found(root, 'orphan-file')).toEqual([]);
  });

  it('accepts a file that is named only by its file name', async () => {
    const root = await project(
      pdf('Run scripts/fill.py, then check against checklist.md.', {
        scripts: { 'fill.py': 'path = os.path.join(here, "template.json")\n' },
        assets: { 'template.json': '{}' },
        references: { 'checklist.md': '# Checklist' },
      }),
    );
    expect(await found(root, 'orphan-file')).toEqual([]);
  });

  it('reaches every file of a folder that is linked to, or named with a trailing slash', async () => {
    const root = await project(
      pdf('Forms are in [references/forms/](references/forms/). Templates live in assets/templates/ too.', {
        references: { forms: { 'overview.md': '# forms', deep: { 'fields.md': '# fields' } }, other: { 'x.md': 'x' } },
        assets: { templates: { 'a.json': '{}' }, 'loose.json': '{}' },
      }),
    );
    expect(targets(await found(root, 'orphan-file'))).toEqual([
      'assets/loose.json: assets/loose.json',
      'references/other/x.md: references/other/x.md',
    ]);
  });

  it('does not count a reference made by a file that is itself unreachable', async () => {
    const root = await project(
      pdf('Nothing to see.', {
        scripts: { 'fill.py': 'open("assets/template.json")\n' },
        assets: { 'template.json': '{}' },
      }),
    );
    expect(targets(await found(root, 'orphan-file'))).toEqual(['assets/template.json: assets/template.json', 'scripts/fill.py: scripts/fill.py']);
  });

  it('only reports documents and the files directly inside scripts/, references/ and assets/', async () => {
    const root = await project(
      pdf('Nothing to see.', {
        scripts: { 'run.py': '', office: { schemas: { 'chart.xsd': '<x/>' }, 'helper.py': '' } },
        assets: { 'template.json': '{}', fonts: { 'a.woff2': Buffer.from([0, 1, 2]) } },
        references: { deep: { 'guide.md': '# guide', 'data.csv': 'a,b' } },
        examples: { 'demo.html': '<p>', 'notes.md': '# notes' },
        'data.csv': 'a,b',
      }),
    );
    expect(targets(await found(root, 'orphan-file'))).toEqual([
      'assets/template.json: assets/template.json',
      'examples/notes.md: examples/notes.md',
      'references/deep/guide.md: references/deep/guide.md',
      'scripts/run.py: scripts/run.py',
    ]);
  });

  it('never reports test files and __init__.py', async () => {
    const root = await project(
      pdf('Nothing to see.', {
        scripts: { 'cli.test.mjs': '', 'cli.spec.ts': '', 'test_run.py': '', 'run_test.py': '', '__init__.py': '', 'run.py': '' },
      }),
    );
    expect(targets(await found(root, 'orphan-file'))).toEqual(['scripts/run.py: scripts/run.py']);
  });

  it('lets a script reach a module it names without the extension', async () => {
    const root = await project(
      pdf('Run scripts/main.py.', {
        scripts: { 'main.py': 'from helpers import fill\nimport report_writer\n', 'helpers.py': '', 'report_writer.py': '', 'unused.py': '' },
      }),
    );
    expect(targets(await found(root, 'orphan-file'))).toEqual(['scripts/unused.py: scripts/unused.py']);
  });

  it('never reports LICENSE, NOTICE, README and CHANGELOG files', async () => {
    const root = await project(pdf('Nothing to see.', { 'LICENSE.txt': 'MIT', LICENSE: 'MIT', 'README.md': '# readme', 'NOTICE.md': 'n', 'CHANGELOG.md': 'c', 'notes.md': 'x' }));
    expect(targets(await found(root, 'orphan-file'))).toEqual(['notes.md: notes.md']);
  });

  it('lists at most ten files, then counts the rest', async () => {
    const assets: Tree = {};
    for (let i = 1; i <= 12; i++) assets[`file-${String(i).padStart(2, '0')}.txt`] = 'x';
    const root = await project(pdf('Nothing to see.', { assets }));
    const diagnostics = await found(root, 'orphan-file');
    expect(diagnostics).toHaveLength(11);
    expect(diagnostics[9]!.file).toBe('assets/file-10.txt');
    expect(diagnostics[10]).toEqual({
      severity: 'warning',
      code: 'orphan-file',
      message: '2 more files are never referenced.',
    });
  });

  it('reports nothing for a skill without files, or one whose files are all used', async () => {
    const root = await project({
      skills: {
        plain: { 'SKILL.md': skillMd('plain') },
        pdf: {
          'SKILL.md': skillMd('pdf', 'd', 'See [guide](references/guide.md), run scripts/run.py, show ![layout](assets/layout.png).'),
          references: { 'guide.md': '# guide' },
          scripts: { 'run.py': '' },
          assets: { 'layout.png': Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
        },
      },
    });
    const { catalog } = await indexProject({ root });
    expect(catalog.skills.flatMap((s) => s.diagnostics)).toEqual([]);
  });

  it('says nothing when SKILL.md itself could not be loaded', async () => {
    const root = await project({ skills: { pdf: { 'SKILL.md': 'x'.repeat(1024 * 1024 + 1), 'notes.md': 'x' } } });
    const { catalog } = await indexProject({ root });
    expect(catalog.skills[0]!.diagnostics.map((d) => d.code)).toEqual(['skill-file-too-large']);
  });
});

describe('duplicate-name', () => {
  const twin = (extra: Tree = {}, description?: string): Tree => ({ 'SKILL.md': skillMd('pdf', description), ...extra });

  it('says nothing about identical copies kept in two agent folders', async () => {
    const files: Tree = { scripts: { 'run.py': 'print(1)\n' } };
    const body = skillMd('pdf', 'd', 'Run scripts/run.py.');
    const root = await project({
      skills: { pdf: { 'SKILL.md': body, ...files } },
      '.claude': { skills: { pdf: { 'SKILL.md': body, ...files } } },
    });
    const { catalog } = await indexProject({ root });
    expect(catalog.skills).toHaveLength(2);
    expect(catalog.skills.flatMap((s) => s.diagnostics)).toEqual([]);
  });

  it('is an error on both skills when their SKILL.md differs, each naming the other', async () => {
    const root = await project({
      skills: { pdf: twin() },
      '.claude': { skills: { pdf: twin({}, 'An older description. Use for pdf.') } },
    });
    expect(await found(root, 'duplicate-name', 'skills/pdf')).toEqual([
      {
        severity: 'error',
        code: 'duplicate-name',
        message: 'The name "pdf" is also used by `.claude/skills/pdf`, with different content.',
        file: 'SKILL.md',
      },
    ]);
    expect((await found(root, 'duplicate-name', '.claude/skills/pdf'))[0]!.message).toBe(
      'The name "pdf" is also used by `skills/pdf`, with different content.',
    );
  });

  it('compares the files too: a changed file or an extra file is a difference', async () => {
    const changed = await project({
      skills: { pdf: twin({ 'notes.md': 'one' }) },
      '.claude': { skills: { pdf: twin({ 'notes.md': 'two' }) } },
    });
    expect(await found(changed, 'duplicate-name')).toHaveLength(1);

    const extra = await project({
      skills: { pdf: twin() },
      '.claude': { skills: { pdf: twin({ 'notes.md': 'one' }) } },
    });
    expect(await found(extra, 'duplicate-name')).toHaveLength(1);
  });

  it('with three skills, names only the ones that differ from each', async () => {
    const root = await project({
      skills: { pdf: twin() },
      '.claude': { skills: { pdf: twin() } },
      '.agents': { skills: { pdf: twin({}, 'Another description. Use for pdf.') } },
    });
    const message = async (sourcePath: string) => (await found(root, 'duplicate-name', sourcePath))[0]!.message;
    expect(await message('skills/pdf')).toBe('The name "pdf" is also used by `.agents/skills/pdf`, with different content.');
    expect(await message('.claude/skills/pdf')).toBe('The name "pdf" is also used by `.agents/skills/pdf`, with different content.');
    expect(await message('.agents/skills/pdf')).toBe(
      'The name "pdf" is also used by `.claude/skills/pdf`, `skills/pdf`, with different content.',
    );
  });

  it('only compares names that were written in the frontmatter', async () => {
    // Two folders called `pdf` whose SKILL.md is broken share a fallback name, not a declared one.
    const root = await project({
      skills: { pdf: { 'SKILL.md': '# one' } },
      '.claude': { skills: { pdf: { 'SKILL.md': '# two' } } },
    });
    const { catalog } = await indexProject({ root });
    expect(catalog.skills.flatMap((s) => s.diagnostics.map((d) => d.code))).toEqual(['missing-frontmatter', 'missing-frontmatter']);
  });

  it('gives the same result on every run', async () => {
    const root = await project({
      skills: { pdf: twin({ 'a.md': 'x' }) },
      '.claude': { skills: { pdf: twin({ 'b.md': 'x' }) } },
    });
    const first = JSON.stringify((await indexProject({ root })).catalog);
    expect(JSON.stringify((await indexProject({ root })).catalog)).toBe(first);
  });
});
