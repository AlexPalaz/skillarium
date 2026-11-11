import type { SkillDefinition, SkillResource } from '@skillarium/core/model';
import { BookOpen, ChevronDown, ChevronRight, File, FileCode, FileText, Folder, FolderOpen, Image } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { skillPath } from '../lib/base';
import { formatBytes } from '../lib/links';
import { CopyButton } from './ui';

interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[];
  resource?: SkillResource;
}

function buildTree(resources: SkillResource[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', children: [] };
  for (const resource of resources) {
    let node = root;
    const parts = resource.path.split('/');
    parts.forEach((part, index) => {
      const path = parts.slice(0, index + 1).join('/');
      let child = node.children.find((c) => c.name === part);
      if (!child) {
        child = { name: part, path, children: [] };
        node.children.push(child);
      }
      if (index === parts.length - 1) child.resource = resource;
      node = child;
    });
  }
  const sort = (nodes: TreeNode[]) => {
    // Folders first, then files, each alphabetically.
    nodes.sort((a, b) => Number(!!a.resource) - Number(!!b.resource) || a.name.localeCompare(b.name));
    nodes.forEach((n) => sort(n.children));
  };
  sort(root.children);
  return root.children;
}

const KIND_COLOR: Record<string, string> = {
  script: 'text-script',
  reference: 'text-reference',
  asset: 'text-asset',
  other: 'text-faint',
};

function FileIcon({ resource }: { resource: SkillResource }) {
  const className = `h-4 w-4 shrink-0 ${KIND_COLOR[resource.kind]}`;
  if (resource.preview === 'image') return <Image className={className} aria-hidden="true" />;
  if (resource.preview === 'markdown') return <FileText className={className} aria-hidden="true" />;
  if (resource.preview === 'text' && resource.language !== 'plaintext')
    return <FileCode className={className} aria-hidden="true" />;
  return <File className={className} aria-hidden="true" />;
}

const ROW = 'group flex w-full items-center gap-1.5 rounded-md py-1 pr-1 text-left text-sm transition-colors';

export function FileTree({ skill, selected }: { skill: SkillDefinition; selected?: string }) {
  const tree = useMemo(() => buildTree(skill.resources), [skill.resources]);
  const [closed, setClosed] = useState<Set<string>>(new Set());

  const toggle = (path: string) =>
    setClosed((prev) => {
      const next = new Set(prev);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  const renderNodes = (nodes: TreeNode[], depth: number) =>
    nodes.map((node) => {
      const indent = { paddingLeft: `${depth * 14 + 6}px` };
      if (!node.resource) {
        const open = !closed.has(node.path);
        return (
          <li key={node.path}>
            <button
              type="button"
              className={`${ROW} text-fg hover:bg-sunken`}
              style={indent}
              aria-expanded={open}
              onClick={() => toggle(node.path)}
            >
              {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-faint" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-faint" />}
              {open ? <FolderOpen className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" /> : <Folder className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />}
              <span className="truncate font-medium">{node.name}</span>
              <span className="ml-auto pr-1 text-[13px] text-faint">{countFiles(node)}</span>
            </button>
            {open && <ul>{renderNodes(node.children, depth + 1)}</ul>}
          </li>
        );
      }
      const active = selected === node.path;
      return (
        <li key={node.path} className="group relative">
          <Link
            to={skillPath(skill.id, node.path)}
            aria-current={active ? 'page' : undefined}
            title={`${node.path} · ${formatBytes(node.resource.size)}`}
            className={`${ROW} !pr-7 ${active ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-sunken hover:text-fg'}`}
            style={{ paddingLeft: `${depth * 14 + 25}px` }}
          >
            <FileIcon resource={node.resource} />
            <span className="truncate">{node.name}</span>
          </Link>
          <CopyButton
            text={node.path}
            label={`Copy relative path ${node.path}`}
            className="absolute right-1 top-1 !border-0 !bg-transparent !p-0.5 opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
          />
        </li>
      );
    });

  return (
    <nav aria-label="Skill files">
      <ul>
        <li>
          <Link
            to={skillPath(skill.id)}
            aria-current={selected === undefined ? 'page' : undefined}
            className={`${ROW} pl-1.5 ${selected === undefined ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-sunken hover:text-fg'}`}
          >
            <BookOpen className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate font-medium">SKILL.md</span>
          </Link>
        </li>
        {renderNodes(tree, 0)}
      </ul>
      {skill.resources.length === 0 && (
        <p className="mt-2 px-1.5 text-[13px] text-faint">This skill has no supporting files.</p>
      )}
    </nav>
  );
}

function countFiles(node: TreeNode): number {
  return node.resource ? 1 : node.children.reduce((sum, child) => sum + countFiles(child), 0);
}
