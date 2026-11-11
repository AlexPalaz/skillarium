import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

export type Tree = { [name: string]: string | Buffer | Tree };

async function write(dir: string, tree: Tree): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  for (const [name, value] of Object.entries(tree)) {
    const target = path.join(dir, name);
    if (typeof value === 'string' || Buffer.isBuffer(value)) await fs.writeFile(target, value);
    else await write(target, value);
  }
}

const created: string[] = [];

export async function makeProject(tree: Tree): Promise<string> {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'skillarium-cli-')));
  created.push(dir);
  await write(dir, tree);
  return dir;
}

export async function cleanup(): Promise<void> {
  for (const dir of created.splice(0)) await fs.rm(dir, { recursive: true, force: true });
}

export function skillMd(name: string, description = `Does ${name}. Use when needed.`, body = `# ${name}\n`): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}`;
}

export const SAMPLE: Tree = {
  '.env': 'API_KEY=SUPER_SECRET_VALUE',
  'private.txt': 'SUPER_SECRET_VALUE',
  src: { 'app.ts': 'export const secret = "SUPER_SECRET_VALUE";' },
  skills: {
    pdf: {
      'SKILL.md': skillMd('pdf', 'Handles <b>PDF</b> "files" & forms.', 'See [guide](references/guide.md) and run scripts/run.py.\n'),
      scripts: { 'run.py': 'print("hello")\n' },
      references: { 'guide.md': '# Guide\n' },
      assets: { 'logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
    },
    review: { 'SKILL.md': skillMd('review') },
  },
};

export interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** Raw GET that sends the path exactly as given (no `..` normalization). */
export function get(port: number, requestPath: string, headers: Record<string, string> = {}): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: requestPath, method: 'GET', headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }),
      );
    });
    req.on('error', reject);
    req.end();
  });
}

/** All files under `dir`, as sorted POSIX relative paths. */
export async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(current: string): Promise<void> {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out.push(path.relative(dir, full).split(path.sep).join('/'));
    }
  }
  await walk(dir);
  return out.sort();
}
