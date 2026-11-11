import type { Catalog, SkillDefinition } from '@skillarium/core/model';
import MiniSearch from 'minisearch';

export interface SearchHit {
  skill: SkillDefinition;
  /** Query terms that matched, for highlighting. */
  terms: string[];
  /** A short excerpt around the first match in the description or body. */
  snippet: string;
  /** Resource paths whose name matched. */
  files: string[];
}

interface IndexedSkill {
  id: string;
  name: string;
  description: string;
  metadata: string;
  body: string;
  files: string;
}

function flatten(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return Object.entries(value).map(([k, v]) => `${k} ${flatten(v)}`).join(' ');
  return String(value);
}

export interface SkillSearch {
  search(query: string): SearchHit[];
}

export function createSearch(catalog: Catalog): SkillSearch {
  const index = new MiniSearch<IndexedSkill>({
    fields: ['name', 'description', 'metadata', 'body', 'files'],
    storeFields: [],
    // Split on path separators too, so `extract_text.py` is found by `extract`.
    tokenize: (text) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean),
    searchOptions: {
      boost: { name: 5, description: 2, files: 1.5 },
      prefix: true,
      fuzzy: (term) => (term.length > 4 ? 0.2 : false),
      combineWith: 'AND',
    },
  });
  const byId = new Map(catalog.skills.map((s) => [s.id, s]));
  index.addAll(
    catalog.skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      metadata: flatten(skill.metadata),
      body: skill.content,
      files: skill.resources.map((r) => r.path).join(' '),
    })),
  );

  return {
    search(query) {
      const trimmed = query.trim();
      if (!trimmed) return [];
      return index.search(trimmed).flatMap((result) => {
        const skill = byId.get(String(result.id));
        if (!skill) return [];
        const queryTerms = trimmed.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
        const terms = [...new Set([...queryTerms, ...result.terms])];
        const files = skill.resources
          .map((r) => r.path)
          .filter((p) => queryTerms.some((t) => p.toLowerCase().includes(t)))
          .slice(0, 3);
        return [{ skill, terms, snippet: makeSnippet(skill, terms), files }];
      });
    },
  };
}

function makeSnippet(skill: SkillDefinition, terms: string[]): string {
  const sources = [skill.description, skill.content.replace(/\s+/g, ' ')];
  for (const text of sources) {
    const lower = text.toLowerCase();
    let first = -1;
    for (const term of terms) {
      const at = lower.indexOf(term);
      if (at !== -1 && (first === -1 || at < first)) first = at;
    }
    if (first !== -1) {
      const start = Math.max(0, first - 40);
      const end = Math.min(text.length, first + 110);
      return (start > 0 ? '…' : '') + text.slice(start, end).trim() + (end < text.length ? '…' : '');
    }
  }
  return skill.description.slice(0, 140);
}

/** Split `text` into alternating plain / matched segments for <mark> rendering. */
export function highlightSegments(text: string, terms: string[]): { text: string; match: boolean }[] {
  const usable = terms.filter((t) => t.length > 0).sort((a, b) => b.length - a.length);
  if (usable.length === 0) return [{ text, match: false }];
  const pattern = new RegExp(`(${usable.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  // `split` with one capture group alternates plain, matched, plain, …; the
  // parity must be read before empty parts are dropped.
  return text
    .split(pattern)
    .map((part, i) => ({ text: part, match: i % 2 === 1 }))
    .filter((segment) => segment.text !== '');
}
