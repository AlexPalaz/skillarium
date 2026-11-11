import { describe, expect, it } from 'vitest';
import { formatBytes, resolveLink, sourceLink } from '../src/lib/links';
import { catalog, skill } from './fixtures';

// `resolveLink` decides what every link and image in a skill's Markdown turns
// into. Skill content is untrusted, so this function is the gate between
// "text someone wrote" and "something the viewer will navigate to or load".

const pdf = skill('pdf', 'skills/pdf', ['references/FORMS.md', 'references/layout.md', 'scripts/run.py', 'my file.md']);
const review = skill('review', 'skills/review', ['references/checklist.md']);
const nested = skill('ocr', 'skills/pdf/extras/ocr', ['notes.md']);
const all = catalog([pdf, review, nested]);
const from = (href: string | undefined, docPath = 'SKILL.md') => resolveLink(href, pdf, docPath, all);

describe('resolveLink', () => {
  it('only lets http, https and mailto leave the site', () => {
    expect(from('https://example.com/a')).toEqual({ type: 'external', href: 'https://example.com/a' });
    expect(from('HTTP://example.com')).toMatchObject({ type: 'external' });
    expect(from('mailto:someone@example.com')).toMatchObject({ type: 'external' });

    for (const href of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html,<script>1</script>',
      'file:///etc/passwd',
      'vbscript:x',
      'ftp://example.com/x',
      '//evil.example/x', // protocol-relative: would inherit https and leave the site
    ]) {
      expect(from(href), href).toEqual({ type: 'unresolved' });
    }
  });

  it('keeps in-page anchors and treats missing targets as unresolved', () => {
    expect(from('#usage')).toEqual({ type: 'anchor', href: '#usage' });
    expect(from(undefined)).toEqual({ type: 'unresolved' });
    expect(from('')).toEqual({ type: 'unresolved' });
    expect(from('?x=1')).toEqual({ type: 'unresolved' });
  });

  it('resolves a path relative to the document, then to the skill root', () => {
    // From SKILL.md both readings are the same.
    expect(from('references/FORMS.md')).toMatchObject({ type: 'internal', skillId: 'pdf', file: 'references/FORMS.md' });
    expect(from('./scripts/run.py')).toMatchObject({ file: 'scripts/run.py' });
    // From references/FORMS.md, `layout.md` is its sibling…
    expect(from('layout.md', 'references/FORMS.md')).toMatchObject({ file: 'references/layout.md' });
    // …and `scripts/run.py` only exists relative to the skill root, which the
    // specification allows documents to use.
    expect(from('scripts/run.py', 'references/FORMS.md')).toMatchObject({ file: 'scripts/run.py' });
    expect(from('../scripts/run.py', 'references/FORMS.md')).toMatchObject({ file: 'scripts/run.py' });
  });

  it('ignores fragments and queries and decodes percent-encoding', () => {
    expect(from('references/FORMS.md#fields')).toMatchObject({ file: 'references/FORMS.md' });
    expect(from('references/FORMS.md?plain=1')).toMatchObject({ file: 'references/FORMS.md' });
    expect(from('my%20file.md')).toMatchObject({ file: 'my file.md' });
    expect(from('%E0%A4%A.md')).toEqual({ type: 'unresolved' }); // malformed encoding must not throw
  });

  it('points links to SKILL.md at the skill itself, without a file', () => {
    const own = from('../SKILL.md', 'references/FORMS.md');
    expect(own).toEqual({ type: 'internal', skillId: 'pdf' });
  });

  it('follows a link out of the skill only into another indexed skill', () => {
    expect(from('../review/SKILL.md')).toEqual({ type: 'internal', skillId: 'review' });
    expect(from('../review')).toEqual({ type: 'internal', skillId: 'review' });
    expect(from('../review/references/checklist.md')).toMatchObject({
      skillId: 'review',
      file: 'references/checklist.md',
    });
    // Inside another skill's folder, but not a file the indexer published.
    expect(from('../review/secret.env')).toEqual({ type: 'unresolved' });
    // Outside every skill: the project root, the parent of the project, an absolute path.
    expect(from('../../package.json')).toEqual({ type: 'unresolved' });
    expect(from('../../../../etc/passwd')).toEqual({ type: 'unresolved' });
    expect(from('/etc/passwd')).toEqual({ type: 'unresolved' });
  });

  it('prefers the innermost skill when skills are nested', () => {
    // skills/pdf/extras/ocr is its own skill; its files do not belong to `pdf`.
    expect(from('extras/ocr/notes.md')).toMatchObject({ type: 'internal', skillId: 'ocr', file: 'notes.md' });
    expect(from('extras/ocr/SKILL.md')).toEqual({ type: 'internal', skillId: 'ocr' });
  });

  it('never reports a file that is not in the catalog', () => {
    expect(from('references/missing.md')).toEqual({ type: 'unresolved' });
    expect(from('scripts')).toEqual({ type: 'unresolved' }); // a directory, not a file
  });
});

describe('sourceLink', () => {
  it('fills the configured template and encodes each path segment', () => {
    const withUrl = catalog([pdf], { sourceUrl: 'https://example.com/blob/main/{path}' });
    expect(sourceLink(withUrl, 'skills/pdf/my file#1.md')).toBe(
      'https://example.com/blob/main/skills/pdf/my%20file%231.md',
    );
  });

  it('produces no link without a template or with a non-http template', () => {
    expect(sourceLink(catalog([pdf]), 'skills/pdf/SKILL.md')).toBeUndefined();
    expect(sourceLink(catalog([pdf], { sourceUrl: 'javascript:alert("{path}")' }), 'x')).toBeUndefined();
  });
});

describe('formatBytes', () => {
  it('picks a readable unit at each boundary', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(10 * 1024)).toBe('10 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
  });
});
