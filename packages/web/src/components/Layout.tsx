import { ExternalLink, Menu, Moon, Sun, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import { useCatalog } from '../lib/catalog';
import { setTheme, useTheme } from '../lib/theme';
import { Sidebar } from './Sidebar';
import { Logo } from './ui';

const NAV = [
  { to: '/', label: 'Overview', end: true },
  { to: '/skills/', label: 'Skills', end: false },
  { to: '/architecture/', label: 'Architecture', end: false },
];

const NAV_LINK =
  'top-link flex h-14 items-center px-2.5 text-[15px] font-medium text-muted transition-colors hover:text-fg aria-[current=page]:text-fg';

export function Layout({ children }: { children: ReactNode }) {
  const { catalog } = useCatalog();
  const theme = useTheme();
  const location = useLocation();
  const [drawer, setDrawer] = useState(false);

  useEffect(() => setDrawer(false), [location.pathname, location.search]);
  useEffect(() => {
    if (!drawer) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setDrawer(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawer]);

  const repository = catalog.project.repository;
  const safeRepository = repository && /^https?:\/\//i.test(repository) ? repository : undefined;

  return (
    <div className="flex h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <header className="flex h-14 shrink-0 items-center gap-1 border-b border-line bg-bg px-4">
        <button
          type="button"
          className="mr-1 rounded-md p-1.5 text-muted hover:bg-sunken hover:text-fg md:hidden"
          aria-label={drawer ? 'Close navigation' : 'Open navigation'}
          aria-expanded={drawer}
          onClick={() => setDrawer((open) => !open)}
        >
          {drawer ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
        <Link to="/" className="mr-3 flex items-center gap-2.5 py-1 pr-1">
          <Logo />
          <span className="hidden text-xl font-medium tracking-tight sm:inline">Skillarium</span>
        </Link>
        <nav aria-label="Main" className="ml-auto flex items-center gap-0.5">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={NAV_LINK}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-1 flex items-center gap-0.5 border-l border-line pl-2">
          {safeRepository && (
            <a
              href={safeRepository}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden items-center gap-1 rounded-md px-2 py-1.5 text-sm font-medium text-muted hover:text-fg sm:inline-flex"
            >
              Repository <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          )}
          <button
            type="button"
            className="rounded-md p-1.5 text-muted hover:bg-sunken hover:text-fg"
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
          </button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <aside className="hidden w-[288px] shrink-0 border-r border-line bg-bg md:block">
          <Sidebar />
        </aside>
        {drawer && (
          <div className="absolute inset-0 z-40 md:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} aria-hidden="true" />
            <aside className="relative h-full w-[300px] max-w-[85vw] border-r border-line bg-bg">
              <Sidebar onNavigate={() => setDrawer(false)} />
            </aside>
          </div>
        )}
        <main id="main" tabIndex={-1} className="scroll-thin min-w-0 flex-1 overflow-y-auto focus:outline-none">
          {children}
        </main>
      </div>
    </div>
  );
}

export function Page({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return <div className={`mx-auto px-5 py-10 sm:px-10 sm:py-12 ${wide ? 'max-w-[1200px]' : 'max-w-[960px]'}`}>{children}</div>;
}
