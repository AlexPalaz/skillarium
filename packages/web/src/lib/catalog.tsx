import type { Catalog, SkillDefinition } from '@skillarium/core/model';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { siteUrl } from './base';

interface CatalogState {
  catalog: Catalog;
  /** Increases on every live reload; use it to refetch file contents. */
  revision: number;
  skillsById: Map<string, SkillDefinition>;
}

const CatalogContext = createContext<CatalogState | null>(null);

export function useCatalog(): CatalogState {
  const value = useContext(CatalogContext);
  if (!value) throw new Error('useCatalog must be used inside <CatalogProvider>');
  return value;
}

async function fetchCatalog(): Promise<Catalog> {
  const response = await fetch(siteUrl('data/catalog.json'), { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Could not load the skill catalog (HTTP ${response.status}).`);
  return (await response.json()) as Catalog;
}

export function CatalogProvider({ children }: { children: ReactNode }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchCatalog().then(
      (data) => !cancelled && setCatalog(data),
      (reason: unknown) => !cancelled && setError(reason instanceof Error ? reason.message : String(reason)),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // Live reload: only the development server announces changes.
  const isDev = catalog?.mode === 'dev';
  useEffect(() => {
    if (!isDev) return;
    const events = new EventSource(siteUrl('__skillarium/events'));
    events.addEventListener('reload', () => {
      fetchCatalog().then(
        (data) => {
          setCatalog(data);
          setRevision((n) => n + 1);
        },
        () => {
          /* keep showing the last good catalog */
        },
      );
    });
    return () => events.close();
  }, [isDev]);

  const state = useMemo<CatalogState | null>(
    () =>
      catalog
        ? { catalog, revision, skillsById: new Map(catalog.skills.map((s) => [s.id, s])) }
        : null,
    [catalog, revision],
  );

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md text-center">
          <h1 className="text-lg font-medium">Catalog unavailable</h1>
          <p className="mt-2 text-muted">{error}</p>
        </div>
      </div>
    );
  }
  if (!state) {
    return (
      <div className="flex h-full items-center justify-center text-muted" role="status">
        Loading skills…
      </div>
    );
  }
  return <CatalogContext.Provider value={state}>{children}</CatalogContext.Provider>;
}
