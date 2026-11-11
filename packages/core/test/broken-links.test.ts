import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { indexProject } from '../src/index.js';
import { makeProject, skillMd, type Tree } from './helpers.js';

// A skill that tells its reader to open a file that is not there fails in
// use, and nothing else in the catalog shows it. `broken-link` reports that.
// It is an error, so the check must stay precise: a correct skill must never
// be blocked. Most
// of these tests are about what must NOT be reported.

const created: string[] = [];
async function project(tree: Tree): Promise<string> {
  const dir = await makeProject(tree);
  created.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of created.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

/** `broken-link` diagnostics of the skill named `name`, as `file: target`. */
async function broken(root: string, name = 'pdf', options: { ignore?: string[] } = {}): Promise<string[]> {
  const { catalog } = await indexProject({ root, ...options });
  const skill = catalog.skills.find((s) => s.name === name)!;
  return skill.diagnostics
    .filter((d) => d.code === 'broken-link')
    .map((d) => `${d.file}: ${/`([^`]+)`/.exec(d.message)![1]}`);
}

const pdf = (body: string, extra: Tree = {}): Tree => ({
  skills: { pdf: { 'SKILL.md': skillMd('pdf', 'Does pdf things. Use for pdf.', body), ...extra } },
});

describe('broken-link', () => {
  it('reports a link from SKILL.md to a file that does not exist', async () => {
    const root = await project(pdf('Read [the guide](references/guide.md) first.'));
    const { catalog } = await indexProject({ root });
    expect(catalog.skills[0]!.diagnostics).toEqual([
      {
        severity: 'error',
        code: 'broken-link',
        message: 'SKILL.md links to `references/guide.md`, which does not exist.',
        file: 'SKILL.md',
      },
    ]);
  });

  it('reports a missing image the same way', async () => {
    const root = await project(pdf('![Layout](assets/layout.png)'));
    expect(await broken(root)).toEqual(['SKILL.md: assets/layout.png']);
  });

  it('reports a broken link inside a reference document, naming that document', async () => {
    const root = await project(
      pdf('See [guide](references/guide.md).', {
        references: { 'guide.md': 'Then read [the details](details.md) and [the index](../INDEX.md).' },
      }),
    );
    expect(await broken(root)).toEqual(['references/guide.md: details.md', 'references/guide.md: ../INDEX.md']);
  });

  it('accepts a link that resolves from the document or from the skill root', async () => {
    const root = await project(
      pdf('[a](references/guide.md) [b](./scripts/run.py) [c](SKILL.md) [d](references/guide.md#top) [e](scripts/run.py?raw=1)', {
        scripts: { 'run.py': '' },
        references: {
          // sibling, parent-relative, root-relative (allowed by the specification), and back to SKILL.md
          'guide.md': '[1](other.md) [2](../scripts/run.py) [3](scripts/run.py) [4](../SKILL.md)',
          'other.md': '# other',
        },
      }),
    );
    expect(await broken(root)).toEqual([]);
  });

  it('decodes percent-encoding before looking for the file', async () => {
    const root = await project(pdf('[ok](my%20notes.md) [missing](other%20notes.md)', { 'my notes.md': '# n' }));
    expect(await broken(root)).toEqual(['SKILL.md: other notes.md']);
  });

  it('does not check web links, mail links, anchors, other schemes or absolute paths', async () => {
    const root = await project(
      pdf(
        '[a](https://example.com/missing.md) [b](mailto:a@example.com) [c](#section) [d](//cdn.example/x.js) ' +
          '[e](file:///etc/passwd) [f](javascript:alert(1)) [g](/docs/guide.md)',
      ),
    );
    expect(await broken(root)).toEqual([]);
  });

  it('does not judge a target that is not written like a file', async () => {
    // Placeholders in prose: an error must be a fact, and these are not paths.
    const root = await project(
      pdf('Cite as [Source](URL). Say "I added it to [Team roster](its link)". But [real](notes.md) and [dir](docs/x) are paths.'),
    );
    expect(await broken(root)).toEqual(['SKILL.md: notes.md', 'SKILL.md: docs/x']);
  });

  it('resolves a link from any folder above the document, up to the skill', async () => {
    // A skill made of self-contained parts writes paths from the part's folder.
    const root = await project(
      pdf('See [forms](references/forms/overview.md).', {
        references: {
          forms: {
            'overview.md': '[fields](references/fields.md)',
            references: { 'fields.md': 'Back to [overview](overview.md), or [gone](references/gone.md).' },
          },
        },
      }),
    );
    expect(await broken(root)).toEqual(['references/forms/references/fields.md: references/gone.md']);
  });

  it('accepts a link to a folder', async () => {
    const root = await project(pdf('All of them are in [references](references/).', { references: { 'a.md': '' } }));
    expect(await broken(root)).toEqual([]);
  });

  it('accepts a file that exists but is not part of the catalog', async () => {
    // Hidden, ignored and oversized-count files are left out of the catalog on
    // purpose. They exist, so linking to them is not a mistake of the author.
    const root = await project(
      pdf('[hidden](.internal/notes.md) [ignored](drafts/wip.md) [gone](drafts/missing.md)', {
        '.internal': { 'notes.md': '' },
        drafts: { 'wip.md': '' },
      }),
    );
    expect(await broken(root, 'pdf', { ignore: ['drafts/'] })).toEqual(['SKILL.md: drafts/missing.md']);
  });

  it('follows a link into another skill, and into the rest of the project', async () => {
    const root = await project({
      'README.md': '# project',
      skills: {
        pdf: {
          'SKILL.md': skillMd(
            'pdf',
            'd',
            '[skill](../review/SKILL.md) [file](../review/notes.md) [readme](../../README.md) ' +
              '[no skill](../ghost/SKILL.md) [no file](../review/missing.md) [no doc](../../CONTRIBUTING.md)',
          ),
        },
        review: { 'SKILL.md': skillMd('review'), 'notes.md': '' },
      },
    });
    expect(await broken(root)).toEqual([
      'SKILL.md: ../ghost/SKILL.md',
      'SKILL.md: ../review/missing.md',
      'SKILL.md: ../../CONTRIBUTING.md',
    ]);
  });

  it('never looks outside the project, so a link that leaves it is not judged', async () => {
    // One level above the project there is a real file and a missing one.
    // Neither is reported: the indexer does not touch anything out there.
    const root = await project(pdf('[real](../../../outside.md) [missing](../../../nothing.md)'));
    const outside = path.join(root, '..', 'outside.md');
    await fs.writeFile(outside, 'x');
    try {
      expect(await broken(root)).toEqual([]);
    } finally {
      await fs.rm(outside, { force: true });
    }
  });

  it('ignores links written inside code, which are examples', async () => {
    const body = [
      'Write links like `[text](missing-inline.md)`.',
      '',
      '```markdown',
      '[text](missing-fenced.md)',
      '```',
      '',
      '~~~',
      '![img](missing-tilde.png)',
      '~~~',
      '',
      'But [this one](missing-real.md) is real.',
    ].join('\n');
    const root = await project(pdf(body));
    expect(await broken(root)).toEqual(['SKILL.md: missing-real.md']);
  });

  it('reports the same target once per document, and each document separately', async () => {
    const root = await project(
      pdf('[a](gone.md) [again](gone.md) [b](also-gone.md) [guide](references/guide.md)', {
        references: { 'guide.md': '[a](../gone.md)' },
      }),
    );
    expect(await broken(root)).toEqual(['references/guide.md: ../gone.md', 'SKILL.md: gone.md', 'SKILL.md: also-gone.md']);
  });

  it('is an error on the skill that has it, and other skills are unaffected', async () => {
    const root = await project({
      skills: {
        pdf: { 'SKILL.md': skillMd('pdf', 'd', '[x](gone.md)') },
        review: { 'SKILL.md': skillMd('review') },
      },
    });
    const { catalog } = await indexProject({ root });
    const all = catalog.skills.flatMap((s) => s.diagnostics);
    expect(all.map((d) => [d.severity, d.code])).toEqual([['error', 'broken-link']]);
    expect(catalog.skills.find((s) => s.name === 'review')!.diagnostics).toEqual([]);
    expect(catalog.diagnostics).toEqual([]);
  });

  it('gives the same result on every run', async () => {
    const root = await project(pdf('[b](b.md) [a](a.md) [c](c.md)'));
    const first = JSON.stringify((await indexProject({ root })).catalog);
    expect(JSON.stringify((await indexProject({ root })).catalog)).toBe(first);
    expect(await broken(root)).toEqual(['SKILL.md: b.md', 'SKILL.md: a.md', 'SKILL.md: c.md']); // document order
  });

  it('reports nothing for a skill whose links all work', async () => {
    const root = await project(
      pdf('[guide](references/guide.md) and ![layout](assets/layout.png)', {
        references: { 'guide.md': '# guide' },
        assets: { 'layout.png': Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
      }),
    );
    expect(await broken(root)).toEqual([]);
  });
});
