import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export type Tree = { [name: string]: string | Buffer | Tree };

async function write(dir: string, tree: Tree): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  for (const [name, value] of Object.entries(tree)) {
    const target = path.join(dir, name);
    if (typeof value === 'string' || Buffer.isBuffer(value)) {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, value);
    } else {
      await write(target, value);
    }
  }
}

/** Create a temporary project; returns its real path. */
export async function makeProject(tree: Tree): Promise<string> {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'skillarium-')));
  await write(dir, tree);
  return dir;
}

export function skillMd(name: string, description = `Does ${name}. Use when needed.`, body = `# ${name}\n`): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}`;
}
