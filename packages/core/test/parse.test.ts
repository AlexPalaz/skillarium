import { describe, expect, it } from 'vitest';
import { parseSkillFile, validateFrontmatter } from '../src/index.js';

describe('parseSkillFile', () => {
  it('splits frontmatter and body', () => {
    const result = parseSkillFile('---\nname: pdf\ndescription: Handles PDFs.\n---\n\n# PDF\n');
    expect(result.frontmatter).toEqual({ name: 'pdf', description: 'Handles PDFs.' });
    expect(result.body.trim()).toBe('# PDF');
    expect(result.diagnostics).toEqual([]);
  });

  it('preserves unknown and nested metadata', () => {
    const result = parseSkillFile(
      '---\nname: x\ndescription: y\ncustom-field: [1, 2]\nmetadata:\n  owner: team-a\n  nested:\n    deep: true\n---\n',
    );
    expect(result.frontmatter['custom-field']).toEqual([1, 2]);
    expect(result.frontmatter.metadata).toEqual({ owner: 'team-a', nested: { deep: true } });
  });

  it('reports a missing frontmatter block and keeps the content', () => {
    const result = parseSkillFile('# Just markdown\n');
    expect(result.diagnostics.map((d) => d.code)).toEqual(['missing-frontmatter']);
    expect(result.body).toBe('# Just markdown\n');
  });

  it('reports malformed YAML without throwing', () => {
    const result = parseSkillFile('---\nname: [unclosed\ndescription: "x\n---\nBody\n');
    expect(result.diagnostics[0]?.code).toBe('invalid-yaml');
    expect(result.diagnostics[0]?.severity).toBe('error');
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe('Body\n');
  });

  it('reads a plain value containing ": " leniently, with a warning', () => {
    // Not valid YAML, but written like this in real skills and accepted by agent tools.
    const result = parseSkillFile(
      '---\nname: deploy\ndescription: Use before a release. Note: run the checks first # always\nlicense: MIT\n---\nBody\n',
    );
    expect(result.frontmatter).toEqual({
      name: 'deploy',
      description: 'Use before a release. Note: run the checks first # always',
      license: 'MIT',
    });
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({ severity: 'warning', code: 'lenient-yaml' });
    expect(result.diagnostics[0]?.message).toContain('line 3'); // counted from the top of SKILL.md
    expect(result.body).toBe('Body\n');
  });

  it('does not guess when broken YAML uses more than plain key: value lines', () => {
    for (const block of [
      'name: x\ndescription: a: b\nmetadata:\n  author: me', // nesting
      'name: x\ndescription: "unclosed: quote', // quoting
      'name: x\ndescription: a: b\n- stray', // not a mapping line
      'name: x\ndescription: a: b\ntags: [a, b', // flow syntax
    ]) {
      const result = parseSkillFile(`---\n${block}\n---\n`);
      expect(result.diagnostics.map((d) => d.code), block).toEqual(['invalid-yaml']);
      expect(result.frontmatter, block).toEqual({});
    }
  });

  it('rejects frontmatter that is not a mapping', () => {
    const result = parseSkillFile('---\n- a\n- b\n---\n');
    expect(result.diagnostics[0]?.code).toBe('invalid-frontmatter');
  });

  it('handles a BOM, CRLF line endings and unicode', () => {
    const result = parseSkillFile(
      '﻿---\r\nname: résumé\r\ndescription: 日本語の説明 ✅\r\n---\r\n\r\n# Título\r\n',
    );
    expect(result.frontmatter.description).toBe('日本語の説明 ✅');
    expect(result.body).toContain('# Título');
    expect(result.diagnostics).toEqual([]);
  });

  it('accepts an empty frontmatter block', () => {
    const result = parseSkillFile('---\n---\nBody');
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe('Body');
  });

  it('does not treat a later horizontal rule as frontmatter', () => {
    const result = parseSkillFile('---\nname: a\ndescription: b\n---\n\nText\n\n---\n\nMore\n');
    expect(result.body).toContain('---');
    expect(result.frontmatter.name).toBe('a');
  });

  it('bounds YAML alias expansion', () => {
    const bomb =
      '---\na: &a [x, x, x, x, x, x, x, x, x]\nb: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a]\nc: &c [*b, *b, *b, *b, *b, *b, *b, *b, *b]\nd: [*c, *c, *c, *c, *c, *c, *c, *c, *c]\n---\n';
    const result = parseSkillFile(bomb);
    expect(result.diagnostics[0]?.code).toBe('invalid-yaml');
  });
});

describe('validateFrontmatter', () => {
  const codes = (fm: Record<string, unknown>, dir = 'pdf') =>
    validateFrontmatter(fm, dir).map((d) => d.code);

  it('accepts a minimal valid skill', () => {
    expect(codes({ name: 'pdf', description: 'Handles PDFs.' })).toEqual([]);
  });

  it('requires name and description', () => {
    expect(codes({})).toEqual(['missing-name', 'missing-description']);
    expect(codes({ name: 'pdf', description: '   ' })).toEqual(['missing-description']);
  });

  it('flags names that break the specification', () => {
    expect(codes({ name: 'PDF-Tools', description: 'd' }, 'PDF-Tools')).toEqual(['invalid-name']);
    expect(codes({ name: 'a--b', description: 'd' }, 'a--b')).toEqual(['invalid-name']);
    expect(codes({ name: '-a', description: 'd' }, '-a')).toEqual(['invalid-name']);
  });

  it('flags a name that differs from the directory', () => {
    expect(codes({ name: 'pdf', description: 'd' }, 'pdf-tools')).toEqual(['name-mismatch']);
  });

  it('flags over-long fields as warnings, not errors', () => {
    const result = validateFrontmatter(
      { name: 'pdf', description: 'x'.repeat(1025), compatibility: 'y'.repeat(501) },
      'pdf',
    );
    expect(result.map((d) => d.code)).toEqual(['description-too-long', 'compatibility-too-long']);
    expect(result.every((d) => d.severity === 'warning')).toBe(true);
  });

  it('does not require optional fields or reject unknown ones', () => {
    expect(codes({ name: 'pdf', description: 'd', anything: { goes: 1 } })).toEqual([]);
  });
});
