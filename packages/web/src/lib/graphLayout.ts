import dagre from '@dagrejs/dagre';

export interface Point {
  x: number;
  y: number;
}

export interface Link {
  source: string;
  target: string;
}

export const SKILL_WIDTH = 210;
export const SKILL_HEIGHT = 44;
const SCREEN_RATIO = 1.6;
/** Space between two groups of linked skills. */
const GROUP_GAP = { x: 110, y: 70 };
/** Cell of the grid that holds skills without links. */
const CELL = { x: SKILL_WIDTH + 30, y: SKILL_HEIGHT + 12 };

interface Group {
  ids: string[];
  at: Map<string, Point>;
  width: number;
  height: number;
}

/** Lay out one group of linked skills left to right, following its links. */
function flow(ids: string[], links: Link[]): Group {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: 'LR', nodesep: 14, ranksep: 110, marginx: 0, marginy: 0 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const id of ids) graph.setNode(id, { width: SKILL_WIDTH, height: SKILL_HEIGHT });
  for (const link of links) graph.setEdge(link.source, link.target);
  dagre.layout(graph);

  const at = new Map<string, Point>();
  let width = 0;
  let height = 0;
  for (const id of ids) {
    const node = graph.node(id);
    const point = { x: Math.round(node.x - SKILL_WIDTH / 2), y: Math.round(node.y - SKILL_HEIGHT / 2) };
    at.set(id, point);
    width = Math.max(width, point.x + SKILL_WIDTH);
    height = Math.max(height, point.y + SKILL_HEIGHT);
  }
  return { ids, at, width, height };
}

/**
 * Positions for a graph that shows only skills.
 *
 * Skills joined by links form groups. Each group is laid out left to right
 * along its links, so a line runs from a skill to the next column instead of
 * across the whole graph; groups are then packed in rows. Skills with no link
 * at all are set apart in a plain grid underneath, where no line passes.
 * The result depends only on the order of `ids` and `links`.
 */
export function layoutSkills(ids: string[], links: Link[]): Map<string, Point> {
  const known = new Set(ids);
  const usable = links.filter((l) => l.source !== l.target && known.has(l.source) && known.has(l.target));

  // Connected components, in the order their first skill appears.
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };
  for (const link of usable) parent.set(find(link.source), find(link.target));
  const members = new Map<string, string[]>();
  for (const id of ids) {
    const root = find(id);
    members.set(root, [...(members.get(root) ?? []), id]);
  }

  const alone: string[] = [];
  const groups: Group[] = [];
  for (const group of members.values()) {
    if (group.length === 1) alone.push(group[0]!);
    else {
      const inside = new Set(group);
      groups.push(flow(group, usable.filter((l) => inside.has(l.source))));
    }
  }
  // Tallest first, so each row is filled with groups of similar height.
  groups.sort((a, b) => b.height - a.height || b.width - a.width);

  const area =
    groups.reduce((sum, g) => sum + (g.width + GROUP_GAP.x) * (g.height + GROUP_GAP.y), 0) +
    alone.length * CELL.x * CELL.y;
  const rowWidth = Math.max(Math.sqrt(SCREEN_RATIO * area), ...groups.map((g) => g.width), CELL.x);

  const out = new Map<string, Point>();
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  for (const group of groups) {
    if (x > 0 && x + group.width > rowWidth) {
      x = 0;
      y += rowHeight + GROUP_GAP.y;
      rowHeight = 0;
    }
    for (const [id, point] of group.at) out.set(id, { x: x + point.x, y: y + point.y });
    x += group.width + GROUP_GAP.x;
    rowHeight = Math.max(rowHeight, group.height);
  }

  const top = groups.length > 0 ? y + rowHeight + GROUP_GAP.y + 20 : 0;
  const columns = Math.max(1, Math.floor((rowWidth + CELL.x - SKILL_WIDTH) / CELL.x));
  alone.forEach((id, index) => {
    out.set(id, { x: (index % columns) * CELL.x, y: top + Math.floor(index / columns) * CELL.y });
  });
  return out;
}
