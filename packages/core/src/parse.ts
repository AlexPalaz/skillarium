import { parse as parseYaml } from 'yaml';
import type { SkillDiagnostic } from './model.js';

export interface ParsedSkillFile {
  /** Parsed frontmatter mapping; empty when missing or invalid. */
  frontmatter: Record<string, unknown>;
  /** Markdown body with the frontmatter block removed. */
  body: string;
  diagnostics: SkillDiagnostic[];
}

const FRONTMATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n?---[ \t]*(?:\r?\n|$)/;
const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Make arbitrary YAML output safe to serialize (no Dates, BigInts, cycles). */
function toJsonSafe(value: unknown): unknown {
  try {
    return JSON.parse(
      JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
    );
  } catch {
    return {};
  }
}

const TOP_LEVEL_KEY = /^([A-Za-z_][\w-]*):(?:[ \t]+(.*))?$/;

/**
 * Fallback for frontmatter that is not valid YAML only because a plain value
 * contains `: ` or ` #` — common in hand-written descriptions, and accepted by
 * agent tools. Reads top-level `key: value` lines as plain strings and
 * returns null when the block uses anything else (quotes, lists, flow or block
 * syntax, nesting), so genuinely broken YAML is still reported as an error.
 */
function readLeniently(block: string): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  for (const line of block.split(/\r?\n/)) {
    if (line.trim() === '' || /^\s*#/.test(line)) continue;
    const entry = TOP_LEVEL_KEY.exec(line);
    if (!entry) return null;
    const value = (entry[2] ?? '').trim();
    if (value === '' || /^[\[{"'|>&*!%@`#]/.test(value)) return null;
    out[entry[1]!] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Split a SKILL.md into frontmatter and body. Never throws: every problem is
 * reported as a diagnostic so a malformed skill can still be displayed.
 */
export function parseSkillFile(raw: string): ParsedSkillFile {
  const diagnostics: SkillDiagnostic[] = [];
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const match = FRONTMATTER.exec(text);

  if (!match) {
    diagnostics.push({
      severity: 'error',
      code: 'missing-frontmatter',
      message: 'SKILL.md does not start with a YAML frontmatter block (--- … ---).',
      file: 'SKILL.md',
    });
    return { frontmatter: {}, body: text, diagnostics };
  }

  const body = text.slice(match[0].length);
  let frontmatter: Record<string, unknown> = {};
  try {
    // `maxAliasCount` bounds alias expansion ("billion laughs").
    const parsed: unknown = parseYaml(match[1] ?? '', { maxAliasCount: 50 });
    if (parsed === null || parsed === undefined) {
      frontmatter = {};
    } else if (isPlainObject(parsed)) {
      const safe = toJsonSafe(parsed);
      frontmatter = isPlainObject(safe) ? safe : {};
    } else {
      diagnostics.push({
        severity: 'error',
        code: 'invalid-frontmatter',
        message: 'Frontmatter must be a YAML mapping of keys to values.',
        file: 'SKILL.md',
      });
    }
  } catch (error) {
    // The YAML library counts lines inside the block; the file has one more above it.
    const reason = (error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error))
      .replace(/\bline (\d+)/, (_match, line: string) => `line ${Number(line) + 1}`)
      .replace(/[:\s]+$/, '');
    const lenient = readLeniently(match[1] ?? '');
    if (lenient) {
      frontmatter = lenient;
      diagnostics.push({
        severity: 'warning',
        code: 'lenient-yaml',
        message: `Frontmatter is not strict YAML (${reason}). It was read line by line instead; quote values that contain ": " or " #".`,
        file: 'SKILL.md',
      });
    } else {
      diagnostics.push({
        severity: 'error',
        code: 'invalid-yaml',
        message: `Frontmatter is not valid YAML: ${reason}`,
        file: 'SKILL.md',
      });
    }
  }

  return { frontmatter, body, diagnostics };
}

/**
 * Check frontmatter against the Agent Skills specification
 * (https://agentskills.io/specification). Only `name` and `description` are
 * required; everything else is optional and unknown fields are allowed.
 */
export function validateFrontmatter(
  frontmatter: Record<string, unknown>,
  directoryName: string,
): SkillDiagnostic[] {
  const out: SkillDiagnostic[] = [];
  const add = (severity: SkillDiagnostic['severity'], code: string, message: string) =>
    out.push({ severity, code, message, file: 'SKILL.md' });

  const { name, description, compatibility, metadata } = frontmatter;

  if (typeof name !== 'string' || name.trim() === '') {
    add('error', 'missing-name', 'Required field `name` is missing or empty.');
  } else {
    if (name.length > 64 || !NAME_PATTERN.test(name)) {
      add(
        'warning',
        'invalid-name',
        '`name` should be 1–64 characters of lowercase letters, numbers and single hyphens, not starting or ending with a hyphen.',
      );
    }
    if (name !== directoryName) {
      add(
        'warning',
        'name-mismatch',
        `\`name\` ("${name}") does not match the directory name ("${directoryName}").`,
      );
    }
  }

  if (typeof description !== 'string' || description.trim() === '') {
    add('error', 'missing-description', 'Required field `description` is missing or empty.');
  } else if (description.length > 1024) {
    add(
      'warning',
      'description-too-long',
      `\`description\` is ${description.length} characters; the specification allows at most 1024.`,
    );
  }

  if (compatibility !== undefined) {
    if (typeof compatibility !== 'string' || compatibility.length === 0) {
      add('warning', 'invalid-compatibility', '`compatibility` should be a non-empty string.');
    } else if (compatibility.length > 500) {
      add('warning', 'compatibility-too-long', '`compatibility` exceeds 500 characters.');
    }
  }

  if (metadata !== undefined && !isPlainObject(metadata)) {
    add('warning', 'invalid-metadata', '`metadata` should be a mapping of string keys to values.');
  }

  return out;
}
