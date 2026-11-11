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
/** Space between blocks without links. */
const ALONE_GAP = { x: 30, y: 12 };

export interface Block {
  id: string;
  width: number;
  height: number;
}

interface Group {
  at: Map<string, Point>;
  width: number;
  height: number;
}

/** Lay out one group of linked blocks left to right, following its links. */
function flow(blocks: Block[], links: Link[]): Group {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: 'LR', nodesep: 18, ranksep: 110, marginx: 0, marginy: 0 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const block of blocks) graph.setNode(block.id, { width: block.width, height: block.height });
  for (const link of links) graph.setEdge(link.source, link.target);
  dagre.layout(graph);

  const at = new Map<string, Point>();
  let width = 0;
  let height = 0;
  for (const block of blocks) {
    const node = graph.node(block.id);
    const point = { x: Math.round(node.x - block.width / 2), y: Math.round(node.y - block.height / 2) };
    at.set(block.id, point);
    width = Math.max(width, point.x + block.width);
    height = Math.max(height, point.y + block.height);
  }
  return { at, width, height };
}

/**
 * Positions (top-left corners) for the blocks of a graph. A block is a skill,
 * alone or with its files under it.
 *
 * Blocks joined by links form groups. Each group is laid out left to right
 * along its links, so a line runs from a skill to the next column instead of
 * across the whole graph; groups are then packed in rows. Blocks with no link
 * at all are set apart in columns underneath, where no line passes.
 * The result depends only on the order of `blocks` and `links`.
 */
export function layoutBlocks(blocks: Block[], links: Link[]): Map<string, Point> {
  const byId = new Map(blocks.map((block) => [block.id, block]));
  const ids = blocks.map((block) => block.id);
  const usable = links.filter((l) => l.source !== l.target && byId.has(l.source) && byId.has(l.target));

  // Connected components, in the order their first block appears.
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };
  for (const link of usable) parent.set(find(link.source), find(link.target));
  const members = new Map<string, Block[]>();
  for (const block of blocks) {
    const root = find(block.id);
    members.set(root, [...(members.get(root) ?? []), block]);
  }

  const alone: Block[] = [];
  const groups: Group[] = [];
  for (const group of members.values()) {
    if (group.length === 1) alone.push(group[0]!);
    else {
      const inside = new Set(group.map((block) => block.id));
      groups.push(flow(group, usable.filter((l) => inside.has(l.source))));
    }
  }
  // Tallest first, so each row is filled with groups of similar height.
  groups.sort((a, b) => b.height - a.height || b.width - a.width);

  const cellWidth = Math.max(SKILL_WIDTH, ...alone.map((block) => block.width)) + ALONE_GAP.x;
  const area =
    groups.reduce((sum, g) => sum + (g.width + GROUP_GAP.x) * (g.height + GROUP_GAP.y), 0) +
    alone.reduce((sum, block) => sum + cellWidth * (block.height + ALONE_GAP.y), 0);
  const rowWidth = Math.max(Math.sqrt(SCREEN_RATIO * area), ...groups.map((g) => g.width), cellWidth);

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

  // Unlinked blocks fill columns, each going to the column that is shortest so far.
  const top = groups.length > 0 ? y + rowHeight + GROUP_GAP.y + 20 : 0;
  const columns = new Array<number>(Math.max(1, Math.floor((rowWidth + ALONE_GAP.x) / cellWidth))).fill(top);
  for (const block of alone) {
    const column = columns.indexOf(Math.min(...columns));
    out.set(block.id, { x: column * cellWidth, y: columns[column]! });
    columns[column]! += block.height + ALONE_GAP.y;
  }
  return out;
}

/** `layoutBlocks` for a graph that shows only skills. */
export function layoutSkills(ids: string[], links: Link[]): Map<string, Point> {
  return layoutBlocks(ids.map((id) => ({ id, width: SKILL_WIDTH, height: SKILL_HEIGHT })), links);
}
