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
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { skillPath } from '../lib/base';
import { useCatalog } from '../lib/catalog';
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
      className={`lift flex cursor-pointer items-center gap-2 rounded-md border bg-surface px-3 text-[13px] ${
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
    </div>
  );
}

const nodeTypes = { item: GraphNodeView };

const ROW = 40;
const BLOCK_GAP = 36;
const BLOCK_WIDTH = 640;
const KIND_ORDER: ResourceKind[] = ['script', 'reference', 'asset', 'other'];

/**
 * Deterministic layout: one block per skill, the skill on the left and its
 * files in a single column on the right, grouped by kind. Nothing sits
 * between a skill and its files, so no line ever runs through a node:
 * file-to-file references loop around the right side, skill-to-skill links
 * around the left.
 */
function layout(graph: SkillGraph, visible: Set<ResourceKind>): { nodes: FlowNode[]; edges: Edge[] } {
  const skills = graph.nodes.filter((n) => n.type === 'skill');
  const blocks = skills.map((skill) => {
    const files = graph.nodes
      .filter((n) => n.skillId === skill.skillId && n.type !== 'skill' && visible.has(n.type as ResourceKind))
      .sort((a, b) => KIND_ORDER.indexOf(a.type as ResourceKind) - KIND_ORDER.indexOf(b.type as ResourceKind));
    return { skill, files, height: Math.max(1, files.length) * ROW + BLOCK_GAP };
  });

  // Larger catalogs wrap into several columns of roughly equal height.
  const columnCount = skills.length > 24 ? 3 : skills.length > 8 ? 2 : 1;
  const target = blocks.reduce((sum, b) => sum + b.height, 0) / columnCount;

  const nodes: FlowNode[] = [];
  const shown = new Set<string>();
  let column = 0;
  let y = 0;
  for (const block of blocks) {
    if (y > 0 && y + block.height / 2 > target && column < columnCount - 1) {
      column++;
      y = 0;
    }
    const x = column * BLOCK_WIDTH;
    shown.add(block.skill.id);
    nodes.push({ id: block.skill.id, type: 'item', position: { x, y }, data: { node: block.skill } });
    block.files.forEach((node, row) => {
      shown.add(node.id);
      nodes.push({ id: node.id, type: 'item', position: { x: x + 300, y: y + row * ROW + 6 }, data: { node } });
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
        sourceHandle: skillToSkill ? 'out-left' : 'out',
        targetHandle: skillToSkill ? 'in-left' : fromFile ? 'in-right' : 'in',
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
  const [visible, setVisible] = useState<Set<ResourceKind>>(new Set(KINDS.map((k) => k.kind)));
  const [selected, setSelected] = useState<GraphEdge | null>(null);

  useEffect(() => {
    document.title = `Architecture · ${catalog.project.title}`;
  }, [catalog.project.title]);

  const { nodes, edges } = useMemo(() => layout(catalog.graph, visible), [catalog.graph, visible]);
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
          fitViewOptions={{ padding: 0.18, maxZoom: 1.1 }}
          minZoom={0.1}
          maxZoom={2}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          onNodeClick={(_event, node) => {
            const { skillId, path } = (node.data as FlowData).node;
            navigate(skillPath(skillId, path));
          }}
          onEdgeClick={(_event, edge) => setSelected((edge.data as { edge: GraphEdge }).edge)}
          onPaneClick={() => setSelected(null)}
          proOptions={{ hideAttribution: false }}
        >
          <Background gap={24} size={1} color="var(--line)" />
          <Controls showInteractive={false} position="bottom-right" />
        </ReactFlow>
        <div className="pointer-events-none absolute bottom-3 left-3 max-w-[min(560px,calc(100%-5rem))] rounded-md border border-line bg-bg px-3 py-2 text-[13px]" role="status">
          {selected ? (
            <>
              <span className="font-medium">{selected.kind}</span>
              <span className="text-muted"> — {selected.evidence}</span>
            </>
          ) : (
            <span className="text-muted">
              Every line is a fact from the file system or an explicit reference. Click a line to see its evidence, a
              node to open it.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
