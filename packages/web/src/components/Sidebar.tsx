import type { SkillDefinition } from '@skillarium/core/model';
import { ChevronDown, ChevronRight, FileText, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link, NavLink, useNavigate } from 'react-router';
import { skillPath } from '../lib/base';
import { useCatalog } from '../lib/catalog';
import { createSearch, highlightSegments } from '../lib/search';
import { worstSeverity } from './Diagnostics';

function Highlight({ text, terms }: { text: string; terms: string[] }) {
  return (
    <>
      {highlightSegments(text, terms).map((segment, i) =>
        segment.match ? <mark key={i}>{segment.text}</mark> : <span key={i}>{segment.text}</span>,
      )}
    </>
  );
}

function SeverityDot({ skill }: { skill: SkillDefinition }) {
  const severity = worstSeverity(skill.diagnostics);
  if (!severity) return null;
  return (
    <span
      className={`ml-auto h-1.5 w-1.5 shrink-0 rounded-full ${severity === 'error' ? 'bg-danger' : 'bg-warn'}`}
      title={severity === 'error' ? 'Has errors' : 'Has warnings'}
      aria-label={severity === 'error' ? 'Has errors' : 'Has warnings'}
    />
  );
}

type Status = 'all' | 'error' | 'warning';

function hasSeverity(skill: SkillDefinition, severity: 'error' | 'warning'): boolean {
  return skill.diagnostics.some((diagnostic) => diagnostic.severity === severity);
}

const ITEM =
  'nav-current flex items-center gap-2 rounded-sm px-2.5 py-1.5 text-sm text-muted transition-colors hover:bg-sunken hover:text-fg aria-[current=page]:bg-accent-soft aria-[current=page]:font-medium aria-[current=page]:text-fg';

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { catalog } = useCatalog();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const search = useMemo(() => createSearch(catalog), [catalog]);
  // Show every skill, or only those with an error, or only those with a warning.
  const [status, setStatus] = useState<Status>('all');
  const counts = useMemo(
    () => ({
      error: catalog.skills.filter((skill) => hasSeverity(skill, 'error')).length,
      warning: catalog.skills.filter((skill) => hasSeverity(skill, 'warning')).length,
    }),
    [catalog],
  );
  // A filter whose skills have all been fixed falls back to showing everything.
  const active: Status = status !== 'all' && counts[status] === 0 ? 'all' : status;
  const passes = (skill: SkillDefinition) => active === 'all' || hasSeverity(skill, active);
  const hits = useMemo(
    () => search.search(query).filter((hit) => active === 'all' || hasSeverity(hit.skill, active)),
    [search, query, active],
  );
  const searching = query.trim() !== '';

  // "/" or Ctrl/Cmd+K focuses the search field from anywhere.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      const slash = event.key === '/' && !typing && !event.metaKey && !event.ctrlKey && !event.altKey;
      const commandK = event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey);
      if (slash || commandK) {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const items = () => Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-nav-item]') ?? []);

  const onInputKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      items()[0]?.focus();
    } else if (event.key === 'Enter' && searching && hits[0]) {
      event.preventDefault();
      navigate(skillPath(hits[0].skill.id));
      onNavigate?.();
    } else if (event.key === 'Escape' && query) {
      event.preventDefault();
      setQuery('');
    }
  };

  const onListKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
    const all = items();
    const index = all.indexOf(document.activeElement as HTMLElement);
    if (index === -1) return;
    event.preventDefault();
    if (event.key === 'ArrowUp' && index === 0) inputRef.current?.focus();
    else if (event.key === 'ArrowDown') all[Math.min(index + 1, all.length - 1)]?.focus();
    else if (event.key === 'ArrowUp') all[index - 1]?.focus();
    else if (event.key === 'Home') all[0]?.focus();
    else all[all.length - 1]?.focus();
  };

  const toggle = (id: string) =>
    setClosed((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line p-3">
        <Link to="/" onClick={onNavigate} className="block rounded-md px-1 py-0.5">
          <div className="label">Project</div>
          <div className="truncate text-[17px] font-medium tracking-tight">{catalog.project.title}</div>
        </Link>
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            role="searchbox"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onInputKey}
            placeholder="Search skills"
            aria-label="Search skills"
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-md border border-line bg-bg py-2 pl-8 pr-9 text-sm placeholder:text-faint focus:border-accent focus:outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          {query ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setQuery('');
                inputRef.current?.focus();
              }}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-faint hover:text-fg"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : (
            <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-line bg-sunken px-1.5 font-mono text-[13px] text-faint">
              /
            </kbd>
          )}
        </div>
        {(counts.error > 0 || counts.warning > 0) && (
          <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label="Filter skills by status">
            {(
              [
                ['all', 'All', catalog.skills.length],
                ['error', 'Errors', counts.error],
                ['warning', 'Warnings', counts.warning],
              ] as const
            ).map(
              ([value, label, count]) =>
                count > 0 && (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={active === value}
                    onClick={() => setStatus(value)}
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[13px] font-medium transition-colors ${
                      active === value
                        ? 'border-line-strong bg-accent-soft text-fg'
                        : 'border-line text-muted hover:border-line-strong hover:text-fg'
                    }`}
                  >
                    {value !== 'all' && (
                      <span className={`h-1.5 w-1.5 rounded-full ${value === 'error' ? 'bg-danger' : 'bg-warn'}`} aria-hidden="true" />
                    )}
                    {label} <span className="tabular-nums text-faint">{count}</span>
                  </button>
                ),
            )}
          </div>
        )}
      </div>

      <div ref={listRef} onKeyDown={onListKey} className="scroll-thin min-h-0 flex-1 overflow-y-auto p-2">
        {searching ? (
          <div role="region" aria-label="Search results" aria-live="polite">
            <div className="px-2 pb-1.5 pt-1 label">
              {hits.length} {hits.length === 1 ? 'result' : 'results'}
            </div>
            {hits.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-muted">
                No skills match “{query.trim()}”.
                <br />
                <span className="text-faint">Search covers names, descriptions, metadata, instructions and file names.</span>
              </p>
            ) : (
              <ul>
                {hits.map((hit) => (
                  <li key={hit.skill.id} className="mb-0.5">
                    <NavLink
                      to={skillPath(hit.skill.id)}
                      end
                      data-nav-item
                      onClick={onNavigate}
                      className="block rounded-md px-2 py-2 transition-colors hover:bg-sunken aria-[current=page]:bg-accent-soft"
                    >
                      <div className="truncate text-sm font-medium text-fg">
                        <Highlight text={hit.skill.name} terms={hit.terms} />
                      </div>
                      <div className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-muted">
                        <Highlight text={hit.snippet} terms={hit.terms} />
                      </div>
                    </NavLink>
                    {hit.files.map((file) => (
                      <Link
                        key={file}
                        to={skillPath(hit.skill.id, file)}
                        data-nav-item
                        onClick={onNavigate}
                        className="ml-2 flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[13px] text-muted hover:bg-sunken hover:text-fg"
                      >
                        <FileText className="h-3 w-3 shrink-0" aria-hidden="true" />
                        <span className="truncate">
                          <Highlight text={file} terms={hit.terms} />
                        </span>
                      </Link>
                    ))}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : catalog.skills.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted">No skills found yet.</p>
        ) : (
          <nav aria-label="Skills">
            {catalog.sources.map((source) => {
              const skills = catalog.skills.filter((s) => s.sourceId === source.id && passes(s));
              if (skills.length === 0 && active !== 'all') return null;
              const open = !closed.has(source.id);
              return (
                <div key={source.id} className="mb-1">
                  <button
                    type="button"
                    data-nav-item
                    aria-expanded={open}
                    onClick={() => toggle(source.id)}
                    className="flex w-full items-center gap-1 rounded-md px-1.5 py-1.5 text-left label hover:text-fg"
                  >
                    {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
                    <span className="truncate font-mono text-[13px]">{source.path}</span>
                    <span className="ml-auto font-normal tabular-nums">{skills.length}</span>
                  </button>
                  {open && (
                    <ul className="ml-[13px] border-l border-line pl-2">
                      {skills.map((skill) => (
                        <li key={skill.id}>
                          <NavLink to={skillPath(skill.id)} data-nav-item onClick={onNavigate} className={ITEM}>
                            <span className="truncate">{skill.name}</span>
                            <SeverityDot skill={skill} />
                          </NavLink>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </nav>
        )}
      </div>
    </div>
  );
}
