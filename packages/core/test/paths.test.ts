import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isInside, shortHash, slugify } from '../src/paths.js';

describe('isInside', () => {
  // Every containment decision (symlinks, published files, output directory)
  // goes through this function.
  const root = path.resolve('/project/skills');

  it('accepts the directory itself and anything below it', () => {
    expect(isInside(root, root)).toBe(true);
    expect(isInside(root, path.join(root, 'pdf', 'SKILL.md'))).toBe(true);
  });

  it('rejects parents and siblings', () => {
    expect(isInside(root, path.resolve('/project'))).toBe(false);
    expect(isInside(root, path.resolve('/project/other'))).toBe(false);
    expect(isInside(root, path.resolve('/'))).toBe(false);
  });

  it('is not fooled by a sibling whose name starts with the same text', () => {
    // A string prefix check would accept this one.
    expect(isInside(root, path.resolve('/project/skills-private/key'))).toBe(false);
    expect(isInside(root, path.resolve('/project/skills.bak'))).toBe(false);
  });

  it('accepts names that merely begin with two dots', () => {
    expect(isInside(root, path.join(root, '..notes', 'a.md'))).toBe(true);
  });
});

describe('slugify', () => {
  // Slugs become skill ids, and ids become URL segments and directory names
  // in the built site.
  it('keeps only lowercase letters, digits and single hyphens', () => {
    expect(slugify('PDF Processing')).toBe('pdf-processing');
    expect(slugify('  --weird__name!!  ')).toBe('weird-name');
    expect(slugify('Crème Brûlée')).toBe('creme-brulee');
  });

  it('cannot produce a path', () => {
    for (const input of ['../../etc/passwd', 'a/b\\c', '..', '.', '%2e%2e/x', 'a?b#c']) {
      expect(slugify(input), input).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it('falls back to a fixed slug when nothing usable is left', () => {
    expect(slugify('')).toBe('skill');
    expect(slugify('***')).toBe('skill');
    expect(slugify('日本語')).toBe('skill');
  });
});

describe('shortHash', () => {
  it('is stable across runs and differs for different input', () => {
    expect(shortHash('skills/pdf')).toBe(shortHash('skills/pdf'));
    expect(shortHash('skills/pdf')).not.toBe(shortHash('skills/pdg'));
    expect(shortHash('')).toMatch(/^[a-z0-9]+$/);
    expect(shortHash('skills/pdf')).toBe('ssk066'); // pinned: ids must not change between versions
  });
});
