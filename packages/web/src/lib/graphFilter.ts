import type { SkillGraph } from '@skillarium/core/model';

/** The words of a filter, lower-cased. An empty list means "no filter". */
export function filterTerms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * The part of the graph that matches a text filter.
 *
 * A skill matches when every word of the query appears in its name or in the
 * path of one of its files. A matching skill is kept whole, with all its
 * files, and a line is kept when both its ends are. An empty query returns
 * the graph unchanged.
 */
export function filterGraph(graph: SkillGraph, query: string): SkillGraph {
  const terms = filterTerms(query);
  if (terms.length === 0) return graph;

  const text = new Map<string, string>();
  for (const node of graph.nodes) {
    const own = (node.type === 'skill' ? node.label : (node.path ?? node.label)).toLowerCase();
    text.set(node.skillId, `${text.get(node.skillId) ?? ''}\n${own}`);
  }
  const keep = new Set<string>();
  for (const [skillId, haystack] of text) {
    if (terms.every((term) => haystack.includes(term))) keep.add(skillId);
  }

  const nodes = graph.nodes.filter((node) => keep.has(node.skillId));
  const ids = new Set(nodes.map((node) => node.id));
  return { nodes, edges: graph.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)) };
}
