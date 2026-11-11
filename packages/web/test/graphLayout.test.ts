import { describe, expect, it } from 'vitest';
import {
  layoutBlocks,
  layoutSkills,
  SKILL_HEIGHT,
  SKILL_WIDTH,
  type Block,
  type Link,
  type Point,
} from '../src/lib/graphLayout';

// The skills-only graph must stay readable in a large catalog. These tests
// state what "readable" means in terms that can be checked: nothing overlaps,
// a link points to the next column, skills without links stay out of the way.

const ids = (n: number) => Array.from({ length: n }, (_, i) => `s${i}`);
const link = (a: number, b: number): Link => ({ source: `s${a}`, target: `s${b}` });

function overlaps(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < SKILL_WIDTH && Math.abs(a.y - b.y) < SKILL_HEIGHT;
}

function anyOverlap(at: Map<string, Point>): boolean {
  const points = [...at.values()];
  return points.some((a, i) => points.slice(i + 1).some((b) => overlaps(a, b)));
}

/** A catalog like the playground: many skills, a link from about one in four. */
function large(count: number): { skills: string[]; links: Link[] } {
  const links: Link[] = [];
  for (let i = 0; i < count; i++) if (i % 4 === 0) links.push(link(i, (i * 7 + 3) % count));
  return { skills: ids(count), links };
}

describe('layoutSkills', () => {
  it('places every skill exactly once, without overlaps', () => {
    for (const count of [1, 2, 7, 40, 150, 400]) {
      const { skills, links } = large(count);
      const at = layoutSkills(skills, links);
      expect([...at.keys()].sort(), `${count} skills`).toEqual([...skills].sort());
      expect(anyOverlap(at), `${count} skills`).toBe(false);
    }
  });

  it('puts the target of a link in a later column than its source', () => {
    // s0 → s1 → s2, and s0 → s3
    const at = layoutSkills(ids(4), [link(0, 1), link(1, 2), link(0, 3)]);
    expect(at.get('s1')!.x).toBeGreaterThan(at.get('s0')!.x + SKILL_WIDTH);
    expect(at.get('s2')!.x).toBeGreaterThan(at.get('s1')!.x + SKILL_WIDTH);
    expect(at.get('s3')!.x).toBe(at.get('s1')!.x); // both one step from s0
  });

  it('keeps skills without links below every linked skill', () => {
    const at = layoutSkills(ids(12), [link(0, 1), link(2, 3), link(3, 4)]);
    const linked = ['s0', 's1', 's2', 's3', 's4'].map((id) => at.get(id)!);
    const bottom = Math.max(...linked.map((p) => p.y + SKILL_HEIGHT));
    for (let i = 5; i < 12; i++) expect(at.get(`s${i}`)!.y, `s${i}`).toBeGreaterThan(bottom);
  });

  it('keeps separate groups of linked skills apart', () => {
    const at = layoutSkills(ids(4), [link(0, 1), link(2, 3)]);
    const first = [at.get('s0')!, at.get('s1')!];
    const second = [at.get('s2')!, at.get('s3')!];
    const right = Math.max(...first.map((p) => p.x + SKILL_WIDTH));
    const below = Math.max(...first.map((p) => p.y + SKILL_HEIGHT));
    // The second group starts entirely to the right of, or entirely below, the first.
    expect(second.every((p) => p.x >= right) || second.every((p) => p.y >= below)).toBe(true);
  });

  it('has the proportions of a screen, not of a strip, for a large catalog', () => {
    for (const count of [60, 150, 400]) {
      const { skills, links } = large(count);
      const points = [...layoutSkills(skills, links).values()];
      const width = Math.max(...points.map((p) => p.x)) + SKILL_WIDTH;
      const height = Math.max(...points.map((p) => p.y)) + SKILL_HEIGHT;
      expect(width / height, `${count} skills`).toBeGreaterThan(0.7);
      expect(width / height, `${count} skills`).toBeLessThan(3.5);
    }
  });

  it('is deterministic', () => {
    const { skills, links } = large(150);
    expect([...layoutSkills(skills, links)]).toEqual([...layoutSkills(skills, links)]);
  });

  it('copes with cycles, self-links, duplicates and links to unknown skills', () => {
    const links = [link(0, 1), link(1, 0), link(1, 2), link(2, 0), link(3, 3), link(0, 1), link(0, 99)];
    const at = layoutSkills(ids(5), links);
    expect(at.size).toBe(5);
    expect(anyOverlap(at)).toBe(false);
    // s3 only links to itself and s4 has no link: both count as unlinked.
    expect(at.get('s3')!.y).toBe(at.get('s4')!.y);
  });

  it('lays out a catalog with no links as a plain grid', () => {
    const at = layoutSkills(ids(30), []);
    expect(at.get('s0')).toEqual({ x: 0, y: 0 });
    expect(new Set([...at.values()].map((p) => p.y)).size).toBeGreaterThan(1); // more than one row
    expect(anyOverlap(at)).toBe(false);
  });

  it('lays out blocks of different sizes (skills with their files) without overlaps', () => {
    // Heights vary like real skills: none, a few or many files.
    const blocks: Block[] = Array.from({ length: 150 }, (_, i) => ({
      id: `s${i}`,
      width: 250,
      height: 44 + ((i * 5) % 9) * 36,
    }));
    const { links } = large(150);
    const at = layoutBlocks(blocks, links);
    expect(at.size).toBe(150);

    const boxes = blocks.map((block) => ({ ...block, ...at.get(block.id)! }));
    const clash = boxes.some((a, i) =>
      boxes.slice(i + 1).some(
        (b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height,
      ),
    );
    expect(clash).toBe(false);

    const width = Math.max(...boxes.map((b) => b.x + b.width));
    const height = Math.max(...boxes.map((b) => b.y + b.height));
    expect(width / height).toBeGreaterThan(0.7);
    expect(width / height).toBeLessThan(3.5);

    // A linked block still sits one column after the block that links to it.
    const [first] = links;
    expect(at.get(first!.target)!.x).toBeGreaterThan(at.get(first!.source)!.x + 250);
  });
});
