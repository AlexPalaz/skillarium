import type { GraphEdge, GraphNode, GraphNodeType, ResourceKind, SkillGraph } from '@skillarium/core/model';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Info, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { skillPath } from '../lib/base';
import { useCatalog } from '../lib/catalog';
import { filterGraph } from '../lib/graphFilter';
import { focusOn } from '../lib/graphFocus';
import { layoutBlocks, SKILL_HEIGHT, SKILL_WIDTH } from '../lib/graphLayout';
import { useTheme } from '../lib/theme';
import { Page } from '../components/Layout';
import { NoSkills } from './Overview';

const KINDS: { kind: ResourceKind; label: string }[] = [
  { kind: 'script', label: 'Scripts' },
  { kind: 'reference', label: 'References' },
  { kind: 'asset', label: 'Assets' },
  { kind: 'other', label: 'Other files' },
];

const COLOR: Record<GraphNodeType, string> = {
  skill: 'var(--mark)',
  script: 'var(--script)',
  reference: 'var(--reference)',
  asset: 'var(--asset)',
  other: 'var(--faint)',
};

type FlowData = { node: GraphNode };
type FlowNode = Node<FlowData>;

function GraphNodeView({ data }: NodeProps<FlowNode>) {
  const { node } = data;
  const isSkill = node.type === 'skill';
  return (
    <div
      title={isSkill ? `Skill: ${node.label}` : `${node.type}: ${node.path}`}
      className={`flex cursor-pointer items-center gap-2 rounded-md border bg-surface px-3 text-[13px] transition-colors hover:border-fg ${
        isSkill ? 'h-11 w-[200px] border-line-strong text-sm font-medium' : 'h-8 w-[230px] border-line font-mono'
      }`}
      style={isSkill ? undefined : { borderLeft: `2px solid ${COLOR[node.type]}` }}
    >
      {isSkill && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: COLOR.skill }} />}
      <span className="truncate">{node.label}</span>
      <Handle type="target" position={Position.Left} id="in" />
      <Handle type="source" position={Position.Right} id="out" />
      <Handle type="target" position={Position.Right} id="in-right" />
      <Handle type="source" position={Position.Left} id="out-left" />
      <Handle type="target" position={Position.Left} id="in-left" />
      <Handle type="source" position={Position.Bottom} id="out-bottom" style={{ left: 12 }} />
    </div>
  );
}

const nodeTypes = { item: GraphNodeView };
const FIT = { padding: 0.18, maxZoom: 1.1 };

// Rendered sizes of the two kinds of node, so that nodes off screen can be
// left out without being measured first.
const SKILL_SIZE = { initialWidth: 200, initialHeight: 44 };
const FILE_SIZE = { initialWidth: 230, initialHeight: 32 };

const ROW = 40;
const BLOCK_GAP = 36;
const BLOCK_WIDTH = 640;
const SKILL_ONLY_WIDTH = 250;
const SKILL_ONLY_HEIGHT = 56;
const SCREEN_RATIO = 1.6;
/** Above this many skills the graph opens with files hidden. */
const LARGE_CATALOG = 30;
/** A skill with its files underneath: indent, row height and total width. */
const TREE_INDENT = 24;
const TREE_ROW = 36;
const TREE_WIDTH = TREE_INDENT + 230;
const HELP_KEY = 'skillarium-graph-help';
/** Above this many nodes only the ones on screen are rendered. */
const VIRTUALIZE_ABOVE = 100;
/** How long the hover focus is kept after the pointer leaves a node. */
const FOCUS_RELEASE_MS = 260;
const KIND_ORDER: ResourceKind[] = ['script', 'reference', 'asset', 'other'];

/**
 * Deterministic layout: one block per skill, the skill on the left and its
 * files in a single column on the right, grouped by kind. Nothing sits
 * between a skill and its files, so no line ever runs through a node:
 * file-to-file references loop around the right side, skill-to-skill links
 * around the left.
 */
function layout(
  graph: SkillGraph,
  visible: Set<ResourceKind>,
  large: boolean,
): { nodes: FlowNode[]; edges: Edge[] } {
  const skills = graph.nodes.filter((n) => n.type === 'skill');
  const blocks = skills.map((skill) => {
    const files = graph.nodes
      .filter((n) => n.skillId === skill.skillId && n.type !== 'skill' && visible.has(n.type as ResourceKind))
      .sort((a, b) => KIND_ORDER.indexOf(a.type as ResourceKind) - KIND_ORDER.indexOf(b.type as ResourceKind));
    return { skill, files, height: files.length > 0 ? files.length * ROW + BLOCK_GAP : SKILL_ONLY_HEIGHT };
  });

  // Blocks wrap into as many columns as it takes for the whole graph to have
  // roughly the proportions of a screen, so that fitting it keeps it legible.
  const blockWidth = blocks.some((b) => b.files.length > 0) ? BLOCK_WIDTH : SKILL_ONLY_WIDTH;
  const total = blocks.reduce((sum, b) => sum + b.height, 0);
  const columnCount = Math.max(1, Math.round(Math.sqrt((SCREEN_RATIO * total) / blockWidth)));
  const target = total / columnCount;

  const nodes: FlowNode[] = [];
  const shown = new Set<string>();

  // Along the links: used when only skills are shown, and for large catalogs
  // whatever is shown. Each skill carries its files underneath it, like a
  // folder, so a block is one narrow column and the links between skills run
  // through the space between columns.
  const flow = large || blocks.every((b) => b.files.length === 0);
  if (flow) {
    const links = graph.edges.filter((edge) => edge.kind === 'links-to-skill');
    const at = layoutBlocks(
      blocks.map((b) => ({
        id: b.skill.id,
        width: b.files.length > 0 ? TREE_WIDTH : SKILL_WIDTH,
        height: SKILL_HEIGHT + (b.files.length > 0 ? 6 + b.files.length * TREE_ROW : 0),
      })),
      links,
    );
    for (const block of blocks) {
      const origin = at.get(block.skill.id) ?? { x: 0, y: 0 };
      shown.add(block.skill.id);
      nodes.push({ id: block.skill.id, type: 'item', position: origin, data: { node: block.skill }, ...SKILL_SIZE });
      block.files.forEach((node, row) => {
        shown.add(node.id);
        nodes.push({
          id: node.id,
          type: 'item',
          position: { x: origin.x + TREE_INDENT, y: origin.y + SKILL_HEIGHT + 6 + row * TREE_ROW },
          data: { node },
          ...FILE_SIZE,
        });
      });
    }
  }

  let column = 0;
  let y = 0;
  for (const block of flow ? [] : blocks) {
    if (y > 0 && y + block.height / 2 > target && column < columnCount - 1) {
      column++;
      y = 0;
    }
    const x = column * blockWidth;
    shown.add(block.skill.id);
    nodes.push({ id: block.skill.id, type: 'item', position: { x, y }, data: { node: block.skill }, ...SKILL_SIZE });
    block.files.forEach((node, row) => {
      shown.add(node.id);
      nodes.push({ id: node.id, type: 'item', position: { x: x + 300, y: y + row * ROW + 6 }, data: { node }, ...FILE_SIZE });
    });
    y += block.height;
  }

  const edges: Edge[] = graph.edges
    .filter((edge) => shown.has(edge.source) && shown.has(edge.target))
    .map((edge) => {
      const explicit = edge.kind !== 'contains';
      const fromFile = edge.source.startsWith('file:');
      const skillToSkill = edge.kind === 'links-to-skill';
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        // Between blocks a skill link loops around the left; along the flow
        // layout it runs from one column to the next, and a skill reaches its
        // files with an elbow down its left edge.
        sourceHandle: flow ? (skillToSkill || fromFile ? 'out' : 'out-bottom') : skillToSkill ? 'out-left' : 'out',
        targetHandle: skillToSkill && !flow ? 'in-left' : fromFile ? 'in-right' : 'in',
        type: flow && !skillToSkill && !fromFile ? 'smoothstep' : undefined,
        data: { edge },
        animated: explicit, // a pulse runs along explicit references
        interactionWidth: 14,
        style: explicit
          ? { stroke: 'var(--mark)', strokeWidth: 1.5 }
          : { stroke: 'var(--line-strong)', strokeWidth: 1 },
        markerEnd: explicit ? { type: MarkerType.ArrowClosed, color: 'var(--mark)', width: 16, height: 16 } : undefined,
      } satisfies Edge;
    });

  return { nodes, edges };
}

export function Architecture() {
  const { catalog } = useCatalog();
  const navigate = useNavigate();
  const theme = useTheme();
  const large = catalog.skills.length > LARGE_CATALOG;
  const [visible, setVisible] = useState<Set<ResourceKind>>(
    () => new Set(large ? [] : KINDS.map((k) => k.kind)),
  );
  const [selected, setSelected] = useState<GraphEdge | null>(null);
  // The help note can be put away as an icon; the choice is remembered.
  const [helpHidden, setHelpHiddenState] = useState(() => {
    try {
      return localStorage.getItem(HELP_KEY) === 'hidden';
    } catch {
      return false;
    }
  });
  const setHelpHidden = (hidden: boolean) => {
    setHelpHiddenState(hidden);
    try {
      localStorage.setItem(HELP_KEY, hidden ? 'hidden' : 'shown');
    } catch {
      // storage unavailable: the choice lasts for this page only
    }
  };

  useEffect(() => {
    document.title = `Architecture · ${catalog.project.title}`;
  }, [catalog.project.title]);

  const [query, setQuery] = useState('');
  const graph = useMemo(() => filterGraph(catalog.graph, query), [catalog.graph, query]);
  const matching = useMemo(() => graph.nodes.filter((n) => n.type === 'skill').length, [graph]);
  const laidOut = useMemo(() => layout(graph, visible, large), [graph, visible, large]);

  // When the filter or the visible file types change, the graph is laid out
  // again: bring the new arrangement into view.
  const flowRef = useRef<ReactFlowInstance<FlowNode, Edge> | null>(null);
  const firstLayout = useRef(true);
  useEffect(() => {
    if (firstLayout.current) {
      firstLayout.current = false;
      return;
    }
    const frame = requestAnimationFrame(() => void flowRef.current?.fitView(FIT));
    return () => cancelAnimationFrame(frame);
  }, [laidOut]);

  // Hovering a node keeps it, everything one line away from it and the whole
  // chain of skill links through it in focus, and dims the rest.
  const [hovered, setHovered] = useState<string | null>(null);
  // The focus is let go a moment after the pointer leaves a node, so that
  // crossing the gap to a neighbour (a few pixels when zoomed out) does not
  // make the graph flash.
  const release = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(release.current), []);
  const focus = (id: string) => {
    window.clearTimeout(release.current);
    setHovered(id);
  };
  const unfocus = () => {
    window.clearTimeout(release.current);
    release.current = window.setTimeout(() => setHovered(null), FOCUS_RELEASE_MS);
  };
  const { nodes, edges } = useMemo(() => {
    if (hovered === null || !laidOut.nodes.some((node) => node.id === hovered)) return laidOut;
    const focus = focusOn(
      hovered,
      laidOut.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        chain: (edge.data as { edge: GraphEdge } | undefined)?.edge.kind === 'links-to-skill',
      })),
    );
    return {
      nodes: laidOut.nodes.map((node) => (focus.nodes.has(node.id) ? node : { ...node, className: 'dimmed' })),
      edges: laidOut.edges.map((edge) => (focus.edges.has(edge.id) ? edge : { ...edge, className: 'dimmed' })),
    };
  }, [laidOut, hovered]);
  const explicit = catalog.graph.edges.filter((e) => e.kind !== 'contains').length;

  if (catalog.skills.length === 0) {
    return (
      <Page>
        <h1 className="mb-6 text-2xl font-medium tracking-tight">Architecture</h1>
        <NoSkills />
      </Page>
    );
  }

  const toggle = (kind: ResourceKind) =>
    setVisible((prev) => {
      const next = new Set(prev);
      if (!next.delete(kind)) next.add(kind);
      return next;
    });

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-5 py-3">
        <h1 className="text-xl font-medium tracking-tight">Architecture</h1>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by resource type">
          {KINDS.map(({ kind, label }) => {
            const count = catalog.graph.nodes.filter((n) => n.type === kind).length;
            const on = visible.has(kind);
            return (
              <button
                key={kind}
                type="button"
                aria-pressed={on}
                disabled={count === 0}
                onClick={() => toggle(kind)}
                className={`btn-step inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[13px] font-medium disabled:opacity-40 ${
                  on ? 'border-line-strong text-fg' : 'border-line text-faint line-through'
                }`}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: COLOR[kind] }} />
                {label} <span className="tabular-nums text-faint">{count}</span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => event.key === 'Escape' && setQuery('')}
            placeholder="Filter skills and files"
            aria-label="Filter the graph"
            autoComplete="off"
            spellCheck={false}
            className="w-56 rounded-md border border-line bg-bg px-2.5 py-1 text-sm placeholder:text-faint focus:border-accent focus:outline-none"
          />
          <span className="text-[13px] tabular-nums text-muted" role="status" aria-label="Skills shown">
            {query.trim() ? `${matching} of ${catalog.skills.length} skills` : `${catalog.skills.length} skills`}
          </span>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted" aria-label="Legend">
          <span className="inline-flex items-center gap-1.5">
            <svg width="26" height="6" aria-hidden="true"><line x1="0" y1="3" x2="26" y2="3" stroke="var(--line-strong)" strokeWidth="1.5" /></svg>
            contains (file is in the skill folder)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <svg width="26" height="6" aria-hidden="true"><line x1="0" y1="3" x2="26" y2="3" stroke="var(--mark)" strokeWidth="2" strokeDasharray="5 4" /></svg>
            explicit link or path in a document ({explicit})
          </span>
        </div>
      </div>

      <div className="relative min-h-0 flex-1" data-testid="graph">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          colorMode={theme}
          fitView
          fitViewOptions={FIT}
          onInit={(instance) => (flowRef.current = instance)}
          onlyRenderVisibleElements={nodes.length > VIRTUALIZE_ABOVE}
          minZoom={0.1}
          maxZoom={2}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          onNodeClick={(_event, node) => {
            const { skillId, path } = (node.data as FlowData).node;
            navigate(skillPath(skillId, path));
          }}
          onNodeMouseEnter={(_event, node) => focus(node.id)}
          onNodeMouseLeave={unfocus}
          onEdgeClick={(_event, edge) => setSelected((edge.data as { edge: GraphEdge }).edge)}
          onPaneClick={() => setSelected(null)}
          proOptions={{ hideAttribution: false }}
        >
          <Background gap={24} size={1} color="var(--line)" />
          <Controls showInteractive={false} position="bottom-right" />
        </ReactFlow>
        {matching === 0 || selected || !helpHidden ? (
          <div
            className="absolute bottom-3 left-3 flex max-w-[min(560px,calc(100%-5rem))] items-start gap-2 rounded-md border border-line bg-bg py-2 pl-3 pr-2 text-[13px]"
            role="status"
          >
            <div className="min-w-0 flex-1">
              {matching === 0 ? (
                <span>
                  No skill or file name contains “{query.trim()}”.{' '}
                  <span className="text-muted">Press Escape in the filter to clear it.</span>
                </span>
              ) : selected ? (
                <>
                  <span className="font-medium">{selected.kind}</span>
                  <span className="text-muted"> — {selected.evidence}</span>
                </>
              ) : (
                <span className="text-muted">
                  Every line is a fact from the file system or an explicit reference. Click a line to see its
                  evidence, a node to open it.
                  {large && visible.size === 0 && ' Files are hidden in a catalog this size: turn a file type on to see them.'}
                </span>
              )}
            </div>
            {matching > 0 && (
              <button
                type="button"
                aria-label={selected ? 'Close evidence' : 'Hide graph help'}
                title={selected ? 'Close evidence' : 'Hide graph help'}
                onClick={() => (selected ? setSelected(null) : setHelpHidden(true))}
                className="-mt-0.5 shrink-0 rounded-md p-1 text-faint hover:bg-sunken hover:text-fg"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>
        ) : (
          <button
            type="button"
            aria-label="Show graph help"
            title="Show graph help"
            onClick={() => setHelpHidden(false)}
            className="btn-step absolute bottom-3 left-3 rounded-md border border-line bg-bg p-1.5 text-muted hover:border-line-strong hover:text-fg"
          >
            <Info className="h-[18px] w-[18px]" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
