import { describe, expect, it } from 'vitest';
import { createSearch, highlightSegments } from '../src/lib/search';
import { catalog, skill } from './fixtures';

// Search is the main way to find a skill in a large catalog. It runs in the
// browser over the catalog only, so these tests pin down what a query matches
// and what the result list shows.

const skills = [
  skill('pdf-processing', 'skills/pdf', ['scripts/extract_text.py', 'references/FORMS.md'], {
    description: 'Extracts text and tables from PDF files.',
    content: '# PDF\n\nFalls back to OCR when a page has no text layer.\n',
    metadata: { name: 'pdf-processing', metadata: { author: 'acme-platform' } },
  }),
  skill('database-migration', 'skills/db', ['references/checklist.md'], {
    description: 'Plans reversible schema migrations.',
    content: '# Migrations\n\nCreate indexes concurrently. Never mention the pdf format here twice: pdf.\n',
  }),
  skill('code-review', 'skills/review', [], {
    description: 'Reviews a diff for correctness.',
    content: '# Review\n\nSkip what a formatter would catch.\n',
  }),
];
const search = createSearch(catalog(skills));
const ids = (query: string) => search.search(query).map((hit) => hit.skill.id);

describe('createSearch', () => {
  it('returns nothing for an empty query or a query that matches nothing', () => {
    expect(ids('')).toEqual([]);
    expect(ids('   ')).toEqual([]);
    expect(ids('kubernetes')).toEqual([]);
    expect(ids('---')).toEqual([]); // only separators: no terms at all
  });

  it('searches names, descriptions, instructions, metadata and file names', () => {
    expect(ids('review')).toEqual(['code-review']); // name
    expect(ids('reversible')).toEqual(['database-migration']); // description
    expect(ids('concurrently')).toEqual(['database-migration']); // instructions
    expect(ids('acme')).toEqual(['pdf-processing']); // nested metadata
    expect(ids('checklist')).toEqual(['database-migration']); // file name
  });

  it('ranks a match in the name above a match in the instructions', () => {
    // "pdf" appears twice in database-migration's body but is pdf-processing's name.
    expect(ids('pdf')).toEqual(['pdf-processing', 'database-migration']);
  });

  it('requires every term, and matches prefixes while typing', () => {
    expect(ids('pdf tables')).toEqual(['pdf-processing']);
    expect(ids('pdf concurrently')).toEqual(['database-migration']);
    expect(ids('pdf kubernetes')).toEqual([]);
    expect(ids('migr')).toEqual(['database-migration']);
  });

  it('finds a file by part of its name and lists the matching files', () => {
    const [hit] = search.search('extract');
    expect(hit?.skill.id).toBe('pdf-processing');
    expect(hit?.files).toEqual(['scripts/extract_text.py']);
    // A hit on the description alone lists no files.
    expect(search.search('tables')[0]?.files).toEqual([]);
  });

  it('forgives a typo in a long word but not in a short one', () => {
    expect(ids('migartion')).toEqual(['database-migration']);
    expect(ids('pfd')).toEqual([]);
  });

  it('shows an excerpt around the match', () => {
    const [hit] = search.search('ocr');
    expect(hit?.snippet).toContain('Falls back to OCR');
    expect(hit?.snippet.length).toBeLessThanOrEqual(152);
    expect(hit?.terms).toContain('ocr');
  });
});

describe('highlightSegments', () => {
  const joined = (text: string, terms: string[]) =>
    highlightSegments(text, terms)
      .map((s) => s.text)
      .join('');

  it('marks every occurrence, ignoring case, and loses no text', () => {
    const segments = highlightSegments('PDF forms and pdf tables', ['pdf']);
    expect(segments).toEqual([
      { text: 'PDF', match: true },
      { text: ' forms and ', match: false },
      { text: 'pdf', match: true },
      { text: ' tables', match: false },
    ]);
    expect(joined('PDF forms and pdf tables', ['pdf', 'form'])).toBe('PDF forms and pdf tables');
  });

  it('prefers the longest term when terms overlap', () => {
    expect(highlightSegments('formatter', ['form', 'formatter'])).toEqual([{ text: 'formatter', match: true }]);
  });

  it('treats terms as plain text, not as regular expressions', () => {
    for (const term of ['c++', '(', '[a-z]', '.*', 'a|b', '\\']) {
      expect(() => highlightSegments('x', [term]), term).not.toThrow();
    }
    expect(highlightSegments('abc', ['.*'])).toEqual([{ text: 'abc', match: false }]);
    expect(highlightSegments('use c++ here', ['c++'])).toEqual([
      { text: 'use ', match: false },
      { text: 'c++', match: true },
      { text: ' here', match: false },
    ]);
  });

  it('returns the text unchanged when there is nothing to mark', () => {
    expect(highlightSegments('abc', [])).toEqual([{ text: 'abc', match: false }]);
    expect(highlightSegments('abc', [''])).toEqual([{ text: 'abc', match: false }]);
    expect(highlightSegments('abc', ['zzz'])).toEqual([{ text: 'abc', match: false }]);
  });
});
