import { lazy, StrictMode, Suspense, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes } from 'react-router';
import { Layout, Page } from './components/Layout';
import { EmptyState } from './components/ui';
import { ROUTER_BASENAME } from './lib/base';
import { CatalogProvider, useCatalog } from './lib/catalog';
import { initTheme } from './lib/theme';
import { Overview } from './pages/Overview';
import { Skill } from './pages/Skill';
import { Skills } from './pages/Skills';
import '@fontsource-variable/host-grotesk';
import '@fontsource-variable/jetbrains-mono';
import './styles.css';

// The graph library is only needed on one page; keep it out of the main bundle.
const Architecture = lazy(() => import('./pages/Architecture').then((m) => ({ default: m.Architecture })));

function Titled({ title, children }: { title?: string; children: React.ReactNode }) {
  const { catalog } = useCatalog();
  useEffect(() => {
    document.title = title ? `${title} · ${catalog.project.title}` : `${catalog.project.title} · Skillarium`;
  }, [title, catalog.project.title]);
  return children;
}

function NotFound() {
  return (
    <Page>
      <EmptyState title="Page not found">
        <p>
          This address does not match anything in the catalog.{' '}
          <Link to="/" className="text-accent underline">
            Go to the overview
          </Link>
          .
        </p>
      </EmptyState>
    </Page>
  );
}

initTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CatalogProvider>
      <BrowserRouter basename={ROUTER_BASENAME}>
        <Layout>
          <Suspense fallback={<div className="p-8 text-muted" role="status">Loading…</div>}>
            <Routes>
              <Route path="/" element={<Titled><Overview /></Titled>} />
              <Route path="/skills" element={<Titled title="Skills"><Skills /></Titled>} />
              <Route path="/skills/:id" element={<Skill />} />
              <Route path="/architecture" element={<Architecture />} />
              <Route path="*" element={<Titled title="Not found"><NotFound /></Titled>} />
            </Routes>
          </Suspense>
        </Layout>
      </BrowserRouter>
    </CatalogProvider>
  </StrictMode>,
);
