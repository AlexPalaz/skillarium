import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { isInside, type IndexResult } from '@skillarium/core';
import chokidar, { type FSWatcher } from 'chokidar';
import { normalizeBase } from './config.js';
import { indexWith, type Project } from './project.js';
import { CONTENT_SECURITY_POLICY, mimeType, renderShell, webDir } from './shell.js';

export const DEFAULT_PORT = 4400;
export const DEFAULT_HOST = '127.0.0.1';

export interface RunningServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

const SECURITY_HEADERS = {
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

function send(
  res: http.ServerResponse,
  status: number,
  body: string | Buffer,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...SECURITY_HEADERS,
    ...headers,
  });
  res.end(body);
}

function streamFile(req: http.IncomingMessage, res: http.ServerResponse, file: string, headers: Record<string, string>, status = 200): void {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...headers });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(file)
    .on('error', () => res.destroy())
    .pipe(res);
}

/**
 * When bound to a loopback address, only answer requests addressed to a
 * loopback host name. This stops DNS-rebinding pages from reading local
 * skill content through the browser.
 */
function hostAllowed(req: http.IncomingMessage, boundHost: string): boolean {
  const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'];
  if (!loopback.includes(boundHost)) return true; // the user chose to expose the server
  const header = req.headers.host ?? '';
  const name = header.startsWith('[') ? header.slice(0, header.indexOf(']') + 1) : header.split(':')[0]!;
  return loopback.includes(name.toLowerCase());
}

/** Decode and validate a request path; returns null when it is malformed. */
function requestPath(req: http.IncomingMessage): string | null {
  try {
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    return pathname.includes('\0') ? null : pathname;
  } catch {
    return null;
  }
}

function listen(server: http.Server, host: string, port: number, strict: boolean): Promise<number> {
  return new Promise((resolve, reject) => {
    let attempt = port;
    const onError = (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE' && !strict && attempt < port + 20) {
        attempt++;
        server.listen(attempt, host);
      } else {
        server.off('error', onError);
        reject(
          error.code === 'EADDRINUSE'
            ? new Error(`Port ${port} is already in use. Choose another with --port.`)
            : error,
        );
      }
    };
    server.on('error', onError);
    server.once('listening', () => {
      server.off('error', onError);
      resolve((server.address() as { port: number }).port);
    });
    server.listen(attempt, host);
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

function displayUrl(host: string, port: number, base: string): string {
  const name = host.includes(':') ? `[${host}]` : host === '0.0.0.0' ? 'localhost' : host;
  return `http://${name}:${port}${base}`;
}

// ---------------------------------------------------------------------------
// Development server
// ---------------------------------------------------------------------------

export interface DevServerOptions {
  project: Project;
  port?: number;
  /** When true, fail instead of trying the next free port. */
  strictPort?: boolean;
  host?: string;
  /** Called after every (re)index. */
  onIndex?: (result: IndexResult, reason: 'start' | 'change') => void;
}

export interface DevServer extends RunningServer {
  /** The most recent index. */
  current(): IndexResult;
}

export async function startDevServer(options: DevServerOptions): Promise<DevServer> {
  const { project } = options;
  const host = options.host ?? DEFAULT_HOST;
  const base = normalizeBase(project.config.base);
  const assets = webDir();
  const template = await fsp.readFile(path.join(assets, 'index.html'), 'utf8');
  const shell = renderShell(template, { base });

  let index = await indexWith(project, 'dev');
  options.onIndex?.(index, 'start');

  const clients = new Set<http.ServerResponse>();
  const heartbeat = setInterval(() => {
    for (const client of clients) client.write(': ping\n\n');
  }, 25_000);
  heartbeat.unref();

  const server = http.createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) send(res, 500, 'Internal error');
      else res.destroy();
    });
  });

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!hostAllowed(req, host)) return send(res, 403, 'Forbidden: unexpected Host header.');
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });

    const pathname = requestPath(req);
    if (pathname === null) return send(res, 400, 'Bad request');
    if (pathname === '/' && base !== '/') return send(res, 302, '', { Location: base });
    if (pathname + '/' === base) return send(res, 302, '', { Location: base });
    if (!pathname.startsWith(base)) return send(res, 404, 'Not found');
    const rel = pathname.slice(base.length);

    if (rel === 'data/catalog.json') {
      return send(res, 200, JSON.stringify(index.catalog), { 'Content-Type': 'application/json; charset=utf-8' });
    }

    if (rel === '__skillarium/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        ...SECURITY_HEADERS,
      });
      res.write(': connected\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    // Skill files: only what the indexer explicitly published, nothing else.
    if (rel.startsWith('files/')) {
      const entry = index.files.get(rel);
      if (!entry) return send(res, 404, 'Not found');
      try {
        // The file may have been swapped for a symlink since it was indexed.
        if (!isInside(entry.realRoot, await fsp.realpath(entry.absPath))) return send(res, 404, 'Not found');
      } catch {
        return send(res, 404, 'Not found');
      }
      return streamFile(req, res, entry.absPath, { 'Content-Type': entry.contentType });
    }

    // Viewer assets (always have an extension), then the page shell for routes.
    if (path.extname(rel) !== '') {
      const file = path.resolve(assets, rel);
      if (isInside(assets, file) && rel !== 'index.html' && fs.existsSync(file) && fs.statSync(file).isFile()) {
        const immutable = rel.startsWith('assets/');
        return streamFile(req, res, file, {
          'Content-Type': mimeType(file),
          'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-store',
        });
      }
      return send(res, 404, 'Not found');
    }
    return send(res, 200, shell, { 'Content-Type': 'text/html; charset=utf-8' });
  }

  // --- file watching -------------------------------------------------------

  let watcher: FSWatcher | undefined;
  let watched = '';
  let timer: NodeJS.Timeout | undefined;
  let running = false;
  let pending = false;
  let closed = false;

  /**
   * Watch skill roots deeply, plus the places where a missing root could
   * appear. Resolves to true when the watcher was (re)created.
   */
  async function syncWatcher(): Promise<boolean> {
    const deep = [...index.watchPaths];
    const shallow = new Set<string>([project.root]);
    for (const searched of index.catalog.searched) {
      const abs = path.resolve(project.root, searched);
      // The project root itself (searched when the usual locations are empty) is already in `shallow`.
      if (deep.includes(abs) || abs === project.root) continue;
      let dir = path.dirname(abs);
      while (!fs.existsSync(dir) && isInside(project.root, dir) && dir !== project.root) dir = path.dirname(dir);
      if (fs.existsSync(dir)) shallow.add(dir);
    }
    if (project.configFile) deep.push(project.configFile);
    const signature = JSON.stringify([deep, [...shallow]]);
    if (signature === watched) return false;
    watched = signature;
    await watcher?.close();
    if (closed) return false;

    const deepSet = deep;
    watcher = chokidar.watch([...deep, ...shallow], {
      ignoreInitial: true,
      ignored: (candidate) => {
        const name = path.basename(candidate);
        if (name === 'node_modules' || name === '.git') return true;
        // Outside the skill roots only direct children matter (a root appearing).
        if (deepSet.some((root) => isInside(root, candidate))) return false;
        return ![...shallow].some((dir) => candidate === dir || path.dirname(candidate) === dir);
      },
    });
    watcher.on('all', schedule);
    watcher.on('error', () => {
      /* a vanished directory is handled by the next reindex */
    });
    // Changes made before the initial scan completes would go unnoticed, so
    // the server is not "ready" until the watcher is.
    const current = watcher;
    await new Promise<void>((resolve) => current.once('ready', () => resolve()));
    return true;
  }

  function schedule(): void {
    clearTimeout(timer);
    timer = setTimeout(() => void reindex(), 120);
  }

  async function reindex(): Promise<void> {
    if (closed) return;
    if (running) {
      pending = true;
      return;
    }
    running = true;
    try {
      index = await indexWith(project, 'dev');
      options.onIndex?.(index, 'change');
      for (const client of clients) client.write('event: reload\ndata: {}\n\n');
      // The set of watched directories changed (a root appeared or vanished).
      // Anything written while the watcher was being replaced was not seen,
      // so index once more.
      if (await syncWatcher()) pending = true;
    } catch {
      // Keep serving the last good index; the next change retries.
    } finally {
      running = false;
      if (pending) {
        pending = false;
        schedule();
      }
    }
  }

  await syncWatcher();
  const port = await listen(server, host, options.port ?? project.config.port ?? DEFAULT_PORT, options.strictPort ?? false);

  return {
    url: displayUrl(host, port, base),
    port,
    current: () => index,
    async close() {
      closed = true;
      clearTimeout(timer);
      clearInterval(heartbeat);
      for (const client of clients) client.end();
      clients.clear();
      await watcher?.close();
      await closeServer(server);
    },
  };
}

// ---------------------------------------------------------------------------
// Static preview server
// ---------------------------------------------------------------------------

export interface PreviewServerOptions {
  dir: string;
  base: string;
  port?: number;
  strictPort?: boolean;
  host?: string;
}

/**
 * Serve a built site the way a plain static host does: files are served as
 * they are, directories serve their `index.html`, and anything else gets
 * `404.html`. There is deliberately no single-page-app fallback.
 */
export async function startPreviewServer(options: PreviewServerOptions): Promise<RunningServer> {
  const host = options.host ?? DEFAULT_HOST;
  const base = normalizeBase(options.base);
  const dir = await fsp.realpath(options.dir);

  const notFound = (req: http.IncomingMessage, res: http.ServerResponse) => {
    const page = path.join(dir, '404.html');
    if (fs.existsSync(page)) return streamFile(req, res, page, { 'Content-Type': 'text/html; charset=utf-8' }, 404);
    send(res, 404, 'Not found');
  };

  const server = http.createServer((req, res) => {
    try {
      if (!hostAllowed(req, host)) return send(res, 403, 'Forbidden: unexpected Host header.');
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
      const pathname = requestPath(req);
      if (pathname === null) return send(res, 400, 'Bad request');
      if ((pathname === '/' && base !== '/') || pathname + '/' === base) return send(res, 302, '', { Location: base });
      if (!pathname.startsWith(base)) return notFound(req, res);

      const rel = pathname.slice(base.length);
      let file = path.resolve(dir, rel);
      if (!isInside(dir, file) || rel.split('/').some((segment) => segment.startsWith('.'))) return notFound(req, res);
      if (!fs.existsSync(file)) return notFound(req, res);
      // Never leave the output directory through a symlink.
      if (!isInside(dir, fs.realpathSync(file))) return notFound(req, res);

      if (fs.statSync(file).isDirectory()) {
        if (!pathname.endsWith('/')) {
          const query = (req.url ?? '').includes('?') ? req.url!.slice(req.url!.indexOf('?')) : '';
          return send(res, 301, '', { Location: `${encodeURI(pathname)}/${query}` });
        }
        file = path.join(file, 'index.html');
        if (!fs.existsSync(file)) return notFound(req, res);
      }
      streamFile(req, res, file, { 'Content-Type': mimeType(file) });
    } catch {
      if (!res.headersSent) send(res, 500, 'Internal error');
      else res.destroy();
    }
  });

  const port = await listen(server, host, options.port ?? DEFAULT_PORT + 100, options.strictPort ?? false);
  return { url: displayUrl(host, port, base), port, close: () => closeServer(server) };
}
