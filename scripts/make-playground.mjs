#!/usr/bin/env node
// Generates a large, deterministic playground project to try Skillarium at
// scale: `node scripts/make-playground.mjs [count] [dir]`.
// The same count always produces the same files. The output is not committed.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const count = Number(process.argv[2] ?? 150);
const out = path.resolve(process.argv[3] ?? fileURLToPath(new URL('../playground', import.meta.url)));
if (!Number.isInteger(count) || count < 1 || count > 5000) {
  console.error('count must be a whole number between 1 and 5000');
  process.exit(2);
}

// Small seeded generator (mulberry32) so output is reproducible.
let seed = 0x5ca1ab1e;
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (list) => list[Math.floor(random() * list.length)];
const chance = (p) => random() < p;

const DOMAINS = {
  data: ['csv', 'parquet', 'spreadsheet', 'warehouse', 'dashboard', 'etl', 'schema'],
  docs: ['pdf', 'changelog', 'readme', 'api-reference', 'runbook', 'slides', 'translation'],
  infra: ['terraform', 'kubernetes', 'dns', 'cdn', 'secrets', 'cost', 'backup'],
  quality: ['code-review', 'lint', 'unit-test', 'e2e-test', 'accessibility', 'performance', 'security'],
  release: ['release-notes', 'version-bump', 'rollback', 'canary', 'feature-flag', 'hotfix'],
  support: ['incident', 'postmortem', 'ticket', 'on-call', 'status-page', 'escalation'],
  frontend: ['component', 'design-token', 'form', 'animation', 'i18n', 'bundle'],
  backend: ['endpoint', 'queue', 'cache', 'migration', 'webhook', 'rate-limit', 'auth'],
};
const VERBS = ['audit', 'build', 'check', 'draft', 'explain', 'fix', 'generate', 'migrate', 'plan', 'review', 'triage', 'validate'];
const TOOLS = ['Read', 'Grep', 'Glob', 'Bash(git:*)', 'Bash(npm:*)', 'Edit', 'Write'];
const AUTHORS = ['platform', 'data-eng', 'design-systems', 'sre', 'developer-experience'];
const LICENSES = ['MIT', 'Apache-2.0', 'Proprietary. See LICENSE.txt'];
const ROOTS = [
  { dir: 'skills', grouped: true, share: 0.6 },
  { dir: '.claude/skills', grouped: false, share: 0.25 },
  { dir: '.agents/skills', grouped: false, share: 0.15 },
];
// A valid 1×1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const sentence = (topic) =>
  pick([
    `Start from the smallest change that makes the ${topic} correct, then widen.`,
    `Never guess a ${topic} value: read it from the source of truth and quote it.`,
    `State what was checked for the ${topic} and what was not.`,
    `Prefer one clear finding about the ${topic} over a long list of maybes.`,
    `If the ${topic} cannot be verified, stop and say what is missing.`,
  ]);

const used = new Set();
const skills = [];
const domains = Object.keys(DOMAINS);
while (skills.length < count) {
  const domain = pick(domains);
  const topic = pick(DOMAINS[domain]);
  let name = `${topic}-${pick(VERBS)}`;
  if (used.has(name)) name = `${name}-${skills.length}`;
  used.add(name);
  const r = random();
  const root = r < ROOTS[0].share ? ROOTS[0] : r < ROOTS[0].share + ROOTS[1].share ? ROOTS[1] : ROOTS[2];
  const dir = root.grouped ? `${root.dir}/${domain}/${name}` : `${root.dir}/${name}`;
  skills.push({ name, domain, topic, dir });
}

async function write(file, content) {
  const target = path.join(out, file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
}

await fs.rm(out, { recursive: true, force: true });
let files = 0;
for (const [index, skill] of skills.entries()) {
  const { name, topic, dir } = skill;
  const verb = name.split('-').pop();
  const resources = [];
  const nScripts = chance(0.55) ? 1 + Math.floor(random() * 3) : 0;
  const nRefs = chance(0.7) ? 1 + Math.floor(random() * 4) : 0;
  for (let i = 0; i < nScripts; i++) {
    const file = `scripts/${pick(['run', 'check', 'collect', 'report', 'apply'])}_${topic.replace(/-/g, '_')}_${i}.${pick(['py', 'sh', 'mjs'])}`;
    resources.push(file);
    const body = file.endsWith('.py')
      ? `#!/usr/bin/env python3\n"""${name}: helper ${i}."""\nimport sys\n\n\ndef main(argv: list[str]) -> int:\n    print("checking", argv[1:])\n    return 0\n\n\nif __name__ == "__main__":\n    raise SystemExit(main(sys.argv))\n`
      : file.endsWith('.sh')
        ? `#!/usr/bin/env bash\nset -euo pipefail\n# ${name}: helper ${i}\necho "checking $*"\n`
        : `#!/usr/bin/env node\n// ${name}: helper ${i}\nconsole.log('checking', process.argv.slice(2));\n`;
    await write(`${dir}/${file}`, body);
  }
  const refs = [];
  for (let i = 0; i < nRefs; i++) {
    const file = `references/${pick(['checklist', 'examples', 'glossary', 'edge-cases', 'policy', 'format'])}-${i}.md`;
    refs.push(file);
    resources.push(file);
  }
  for (const [i, file] of refs.entries()) {
    const sibling = refs[(i + 1) % refs.length];
    const link = refs.length > 1 && chance(0.4) ? `\nSee also [the next reference](${path.posix.basename(sibling)}).\n` : '';
    await write(
      `${dir}/${file}`,
      `# ${path.posix.basename(file, '.md')} for ${topic}\n\n${sentence(topic)}\n\n| Case | Action |\n| --- | --- |\n| Missing input | Ask once, then stop |\n| Conflicting sources | Prefer the newest, say so |\n${link}`,
    );
  }
  if (chance(0.2)) {
    resources.push('assets/diagram.png');
    await write(`${dir}/assets/diagram.png`, PNG);
  }
  if (chance(0.12)) {
    resources.push('assets/template.json');
    await write(`${dir}/assets/template.json`, JSON.stringify({ skill: name, version: 1, fields: ['title', 'summary'] }, null, 2) + '\n');
  }

  // Deliberate problems in a few skills, to see how they are reported.
  const flaw = index % 37 === 5 ? 'no-description' : index % 41 === 7 ? 'bad-yaml' : index % 43 === 9 ? 'loose-yaml' : index % 47 === 11 ? 'name-mismatch' : null;

  const description = `${verb[0].toUpperCase()}${verb.slice(1)}s the ${topic.replace(/-/g, ' ')} for a change and reports what it found. Use when the user asks to ${verb} a ${topic.replace(/-/g, ' ')}, or when a task touches ${skill.domain} ${topic.replace(/-/g, ' ')} work${chance(0.3) ? ', including follow-ups after an incident, a failed check or a review comment' : ''}.`;
  const front = [`name: ${flaw === 'name-mismatch' ? `${name}-old` : name}`];
  if (flaw === 'bad-yaml') front.push('description: [unclosed list');
  else if (flaw === 'loose-yaml') front.push(`description: ${description} Note: read the policy first`);
  else if (flaw !== 'no-description') front.push(`description: ${description}`);
  if (chance(0.5)) front.push(`license: ${pick(LICENSES)}`);
  if (chance(0.35) && flaw !== 'loose-yaml') front.push(`allowed-tools: ${[...new Set([pick(TOOLS), pick(TOOLS), pick(TOOLS)])].join(' ')}`);
  if (chance(0.6) && flaw !== 'loose-yaml') front.push('metadata:', `  author: ${pick(AUTHORS)}`, `  version: "${1 + Math.floor(random() * 4)}.${Math.floor(random() * 10)}"`);

  const other = skills[(index * 7 + 3) % skills.length];
  const cross =
    other !== skill && chance(0.25)
      ? `\n## Related\n\nHand over to the [${other.name} skill](${path.posix.relative(dir, other.dir)}/SKILL.md) when the work goes beyond ${topic.replace(/-/g, ' ')}.\n`
      : '';
  const steps = resources
    .filter((file) => !file.startsWith('assets/'))
    .map((file, i) => (file.startsWith('scripts/') ? `${i + 1}. Run \`${file}\` and read its output.` : `${i + 1}. Follow [${path.posix.basename(file, '.md')}](${file}).`))
    .join('\n');
  const body = `# ${name}\n\n${sentence(topic)} ${sentence(topic)}\n\n## When to use\n\n- The user asks to ${verb} a ${topic.replace(/-/g, ' ')}.\n- A change touches ${skill.domain} code and nobody has looked at the ${topic.replace(/-/g, ' ')}.\n\n## Steps\n\n${steps || '1. Read the request twice.\n2. Answer in three sentences or fewer.'}\n\n## Output\n\n\`\`\`json\n{ "skill": "${name}", "status": "ok", "findings": [] }\n\`\`\`\n\n- [x] State what was checked\n- [ ] List what was not checked\n${resources.includes('assets/diagram.png') ? '\n![Flow](assets/diagram.png)\n' : ''}${cross}`;
  await write(`${dir}/SKILL.md`, flaw === 'no-description' && chance(0.5) ? body : `---\n${front.join('\n')}\n---\n\n${body}`);
  files += resources.length + 1;
}

// Two skills with the same name in different places, and one oversized file.
const twin = `---\nname: shared-style\ndescription: House style for written output. Use when drafting any user-facing text.\n---\n\n# shared-style\n\nShort sentences. No filler.\n`;
await write('skills/docs/shared-style/SKILL.md', twin);
await write('.claude/skills/shared-style/SKILL.md', twin);
await write('skills/data/big-reference/SKILL.md', `---\nname: big-reference\ndescription: Holds a reference too large to preview. Use to check how large files are listed.\n---\n\n# big-reference\n\nSee references/huge.md.\n`);
await write('skills/data/big-reference/references/huge.md', '# Huge\n\n' + 'All work and no play. '.repeat(40000));
await write('skillarium.config.ts', `import { defineConfig } from 'skillarium';\n\nexport default defineConfig({\n  title: 'Playground (${count + 3} skills)',\n  description: 'A generated project for trying Skillarium on a large catalog. Some skills are broken on purpose.',\n});\n`);
await write('README.md', `# Playground\n\nGenerated by \`scripts/make-playground.mjs\`. Do not edit; regenerate instead.\n`);

console.log(`Wrote ${skills.length + 3} skills (${files + 4} files) to ${out}`);
