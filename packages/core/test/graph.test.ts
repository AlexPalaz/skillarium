import { describe, expect, it } from 'vitest';
import { buildGraph, type GraphDocument } from '../src/graph.js';
import type { SkillDefinition, SkillResource } from '../src/model.js';

// The architecture view promises that every line is a fact. These tests feed
// `buildGraph` small hand-written inputs and check exactly which edges come
// out, so a looser matching rule cannot slip in unnoticed.

function skill(id: string, sourcePath: string, files: string[]): SkillDefinition {
  return {
    id,
    name: id,
    description: '',
    sourcePath,
    sourceId: 'skills',
    metadata: {},
    content: '',
    resources: files.map((path) => ({ path, kind: 'other', size: 1, preview: 'text' }) as SkillResource),
    diagnostics: [],
  } as SkillDefinition;
}

const doc = (skillId: string, text: string, path = 'SKILL.md'): GraphDocument => ({ skillId, path, text });

/** Explicit edges only, as `source -> target [kind]`, sorted. */
function explicit(skills: SkillDefinition[], documents: GraphDocument[]): string[] {
  return buildGraph(skills, documents)
    .edges.filter((edge) => edge.kind !== 'contains')
    .map((edge) => `${edge.source} -> ${edge.target} [${edge.kind}]`)
    .sort();
}

describe('buildGraph', () => {
  const pdf = skill('pdf', 'skills/pdf', ['scripts/run.py', 'references/guide.md', 'LICENSE', 'a.b']);
  const RUN = ['skill:pdf -> file:pdf:scripts/run.py [references]'];

  it('always links a skill to each of its files, and to nothing else, without documents', () => {
    const graph = buildGraph([pdf, skill('empty', 'skills/empty', [])], []);
    expect(graph.nodes.map((n) => n.id)).toEqual([
      'skill:pdf',
      'file:pdf:scripts/run.py',
      'file:pdf:references/guide.md',
      'file:pdf:LICENSE',
      'file:pdf:a.b',
      'skill:empty',
    ]);
    expect(graph.edges.map((e) => e.kind)).toEqual(['contains', 'contains', 'contains', 'contains']);
    expect(graph.nodes.find((n) => n.id === 'file:pdf:scripts/run.py')?.label).toBe('run.py');
  });

  it('recognises a path written as a standalone token', () => {
    for (const text of [
      'Run scripts/run.py first.',
      'Run `scripts/run.py`.',
      'Run ./scripts/run.py',
      'python scripts/run.py --flag',
      '(scripts/run.py)',
      'scripts/run.py', // the whole document
      'See scripts/run.py, then stop.',
    ]) {
      expect(explicit([pdf], [doc('pdf', text)]), text).toEqual(RUN);
    }
  });

  it('does not match a path that is only part of a longer path or word', () => {
    for (const text of [
      'Run myscripts/run.py',
      'Run old/scripts/run.py',
      'Run scripts/run.pyc',
      'Run scripts/run.py-old',
      'Run scripts/run.py/extra',
      'Run ../scripts/run.py',
      'Run scripts/run',
      'run.py is in scripts',
      'https://example.com/scripts/run.py',
    ]) {
      expect(explicit([pdf], [doc('pdf', text)]), text).toEqual([]);
    }
  });

  it('never treats a bare word as a path, but follows a link to the same file', () => {
    // LICENSE has no dot or slash: as a mention it is just a word.
    expect(explicit([pdf], [doc('pdf', 'See the LICENSE for terms.')])).toEqual([]);
    expect(explicit([pdf], [doc('pdf', 'See the [license](LICENSE).')])).toEqual([
      'skill:pdf -> file:pdf:LICENSE [references]',
    ]);
  });

  it('reports one edge when a file is both linked and mentioned', () => {
    const text = 'See [the runner](scripts/run.py). Then run scripts/run.py again, and scripts/run.py once more.';
    const edges = buildGraph([pdf], [doc('pdf', text)]).edges.filter((e) => e.kind === 'references');
    expect(edges).toHaveLength(1);
    expect(edges[0]?.evidence).toBe('Markdown link in SKILL.md'); // the link is the stronger evidence
  });

  it('starts the edge at the document that contains the reference', () => {
    const edges = explicit([pdf], [doc('pdf', 'Run [it](../scripts/run.py).', 'references/guide.md')]);
    expect(edges).toEqual(['file:pdf:references/guide.md -> file:pdf:scripts/run.py [references]']);
  });

  it('does not let a document reference itself', () => {
    const text = 'This is references/guide.md. See [above](guide.md) and [top](#top).';
    expect(explicit([pdf], [doc('pdf', text, 'references/guide.md')])).toEqual([]);
  });

  it('links two skills only through a Markdown link that resolves into the other', () => {
    const review = skill('review', 'skills/review', ['notes.md']);
    const both = [pdf, review];
    expect(explicit(both, [doc('pdf', 'See [review](../review/SKILL.md).')])).toEqual([
      'skill:pdf -> skill:review [links-to-skill]',
    ]);
    expect(explicit(both, [doc('pdf', 'See [notes](../review/notes.md).')])).toEqual([
      'skill:pdf -> skill:review [links-to-skill]',
    ]);
    // Naming the other skill, or its path, in prose is not a link.
    expect(explicit(both, [doc('pdf', 'Works well with the review skill in skills/review.')])).toEqual([]);
    // A link that leaves the skill but lands on no skill, or back on itself.
    expect(explicit(both, [doc('pdf', '[a](../../README.md) [b](../missing/SKILL.md) [c](../pdf/SKILL.md)')])).toEqual([]);
  });

  it('ignores links with a scheme, anchors, and documents of unknown skills', () => {
    const text = '[a](https://x.test/scripts/run.py) [b](mailto:a@b.c) [c](#scripts/run.py) [d](//x.test/scripts/run.py)';
    expect(explicit([pdf], [doc('pdf', text)])).toEqual([]);
    expect(explicit([pdf], [doc('ghost', 'Run scripts/run.py')])).toEqual([]);
  });

  it('gives every edge a unique id and a non-empty evidence', () => {
    const { edges } = buildGraph([pdf], [doc('pdf', 'Run scripts/run.py and read [guide](references/guide.md).')]);
    expect(new Set(edges.map((e) => e.id)).size).toBe(edges.length);
    expect(edges.every((e) => e.evidence.trim().length > 0)).toBe(true);
  });
});
