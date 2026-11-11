import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (relative: string) => fs.readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

/** The `d` attributes of the paths in a piece of SVG, whichever quotes it uses. */
function shapes(svg: string): string[] {
  return [...svg.matchAll(/\bd=(['"])(.*?)\1/g)].map((match) => match[2]!);
}

describe('logo', () => {
  const favicon = read('../public/favicon.svg');
  const styles = read('../src/styles.css');
  const mark = decodeURIComponent(/\.brand-mark\s*\{[^}]*url\("data:image\/svg\+xml,([^"]+)"\)/.exec(styles)?.[1] ?? '');

  it('is a diamond above the two pages of an open book', () => {
    const drawn = shapes(mark);
    expect(drawn).toHaveLength(3);
    // The diamond: four straight sides, starting from its top point on the centre line.
    expect(drawn[0]).toMatch(/^M12 [\d.]+(L[\d. ]+){3}Z$/);
    // The pages mirror each other around the centre line (x = 12).
    const xs = (d: string) => [...d.matchAll(/(?:^M|L)([\d.]+) /g)].map((m) => Number(m[1]));
    const left = xs(drawn[1]!);
    const right = xs(drawn[2]!);
    expect(left.length).toBeGreaterThan(0);
    expect(right.map((x) => +(24 - x).toFixed(2))).toEqual(left);
  });

  it('is the same drawing in the header and in the favicon', () => {
    expect(shapes(favicon)).toEqual(shapes(mark));
  });

  it('keeps the favicon a plain image: no script, no external reference', () => {
    expect(favicon).not.toMatch(/<script|href=|url\(|on\w+=/i);
  });

  it('is shown in the README from a file that exists', () => {
    const readme = read('../../../README.md');
    const source = /<img src="([^"]+)"[^>]*alt="Skillarium logo/.exec(readme)?.[1];
    expect(source).toBeDefined();
    expect(fs.existsSync(fileURLToPath(new URL(`../../../${source}`, import.meta.url)))).toBe(true);
  });
});
