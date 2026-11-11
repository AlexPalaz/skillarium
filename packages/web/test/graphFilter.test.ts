import type { GraphEdge, GraphNode, SkillGraph } from '@skillarium/core/model';
import { describe, expect, it } from 'vitest';
import { filterGraph } from '../src/lib/graphFilter';

// The filter above the architecture graph narrows a large catalog down to the
// skills someone is looking for.

const skill = (id: string): GraphNode => ({ id: `skill:${id}`, type: 'skill', label: id, skillId: id });
const file = (id: string, path: string): GraphNode => ({
  id: `file:${id}:${path}`,
  type: 'script',
  label: path.slice(path.lastIndexOf('/') + 1),
  skillId: id,
  path,
});
const edge = (source: string, target: string, kind: GraphEdge['kind'] = 'contains'): GraphEdge => ({
  id: `${kind}:${source}->${target}`,
  source,
  target,
  kind,
  evidence: 'test',
});

const graph: SkillGraph = {
  nodes: [
    skill('pdf-processing'),
    file('pdf-processing', 'scripts/extract_text.py'),
    file('pdf-processing', 'references/FORMS.md'),
    skill('code-review'),
    file('code-review', 'references/checklist.md'),
    skill('incident-triage'),
  ],
  edges: [
    edge('skill:pdf-processing', 'file:pdf-processing:scripts/extract_text.py'),
    edge('skill:pdf-processing', 'file:pdf-processing:references/FORMS.md'),
    edge('skill:code-review', 'file:code-review:references/checklist.md'),
    edge('skill:pdf-processing', 'skill:code-review', 'links-to-skill'),
  ],
};
const skills = (query: string) =>
  filterGraph(graph, query)
    .nodes.filter((n) => n.type === 'skill')
    .map((n) => n.skillId);

describe('filterGraph', () => {
  it('returns the same graph for an empty or blank filter', () => {
    expect(filterGraph(graph, '')).toBe(graph);
    expect(filterGraph(graph, '   ')).toBe(graph);
  });

  it('matches part of a skill name, ignoring case', () => {
    expect(skills('pdf')).toEqual(['pdf-processing']);
    expect(skills('REVIEW')).toEqual(['code-review']);
    expect(skills('e')).toEqual(['pdf-processing', 'code-review', 'incident-triage']);
  });

  it('matches a skill through the path of one of its files', () => {
    expect(skills('checklist')).toEqual(['code-review']);
    expect(skills('scripts/')).toEqual(['pdf-processing']);
    expect(skills('forms.md')).toEqual(['pdf-processing']);
  });

  it('requires every word, each anywhere in the skill', () => {
    expect(skills('pdf extract')).toEqual(['pdf-processing']); // name + file
    expect(skills('pdf checklist')).toEqual([]); // words in two different skills
  });

  it('keeps a matching skill whole and drops lines that lost an end', () => {
    const result = filterGraph(graph, 'pdf');
    expect(result.nodes.map((n) => n.id)).toEqual([
      'skill:pdf-processing',
      'file:pdf-processing:scripts/extract_text.py',
      'file:pdf-processing:references/FORMS.md',
    ]);
    // Both containment lines stay; the link to code-review goes with code-review.
    expect(result.edges.map((e) => e.kind)).toEqual(['contains', 'contains']);
  });

  it('keeps the link between two skills that both match', () => {
    const result = filterGraph(graph, 'r'); // every skill name contains an r
    expect(result.edges.some((e) => e.kind === 'links-to-skill')).toBe(true);
  });

  it('returns an empty graph when nothing matches, and does not treat the query as a pattern', () => {
    expect(filterGraph(graph, 'kubernetes')).toEqual({ nodes: [], edges: [] });
    expect(filterGraph(graph, '.*')).toEqual({ nodes: [], edges: [] });
    expect(() => filterGraph(graph, '(')).not.toThrow();
  });
});
