export interface FocusEdge {
  id: string;
  source: string;
  target: string;
  /** True for a link from one skill to another. */
  chain: boolean;
}

export interface Focus {
  nodes: Set<string>;
  edges: Set<string>;
}

/**
 * What stays in focus while `start` is hovered:
 *
 * - `start` and everything one line away from it (its files, the documents
 *   that mention it, the skills it links to or is linked from);
 * - the whole chain of skill links through it: every skill it leads to, and
 *   every skill that leads to it, however many steps away.
 *
 * Chains are followed in one direction at a time, so a skill that merely
 * shares an ancestor with `start` is not included.
 */
export function focusOn(start: string, edges: FocusEdge[]): Focus {
  const nodes = new Set([start]);
  const lit = new Set<string>();

  for (const edge of edges) {
    if (edge.source === start || edge.target === start) {
      nodes.add(edge.source);
      nodes.add(edge.target);
      lit.add(edge.id);
    }
  }

  const follow = (from: 'source' | 'target', to: 'source' | 'target') => {
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length > 0) {
      const current = queue.pop()!;
      for (const edge of edges) {
        if (!edge.chain || edge[from] !== current) continue;
        lit.add(edge.id);
        nodes.add(edge[to]);
        if (!seen.has(edge[to])) {
          seen.add(edge[to]);
          queue.push(edge[to]);
        }
      }
    }
  };
  follow('source', 'target'); // what it leads to
  follow('target', 'source'); // what leads to it

  return { nodes, edges: lit };
}
