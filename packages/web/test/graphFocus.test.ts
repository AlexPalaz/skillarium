import { describe, expect, it } from 'vitest';
import { focusOn, type FocusEdge } from '../src/lib/graphFocus';

// Hovering a node in the architecture view dims everything unrelated to it.
// These tests define "related".

const link = (source: string, target: string): FocusEdge => ({ id: `${source}>${target}`, source, target, chain: true });
const file = (source: string, target: string): FocusEdge => ({ id: `${source}>${target}`, source, target, chain: false });
const lit = (start: string, edges: FocusEdge[]) => [...focusOn(start, edges).nodes].sort();

describe('focusOn', () => {
  // a → b → c → d
  const chain = [link('a', 'b'), link('b', 'c'), link('c', 'd')];

  it('follows a chain of skill links to its end, in both directions', () => {
    expect(lit('a', chain)).toEqual(['a', 'b', 'c', 'd']); // everything a leads to
    expect(lit('d', chain)).toEqual(['a', 'b', 'c', 'd']); // everything that leads to d
    expect(lit('b', chain)).toEqual(['a', 'b', 'c', 'd']);
    expect([...focusOn('a', chain).edges].sort()).toEqual(['a>b', 'b>c', 'c>d']);
  });

  it('does not spread sideways to skills that only share an ancestor or a descendant', () => {
    // a → b, a → x   and   y → b
    const edges = [link('a', 'b'), link('a', 'x'), link('y', 'b')];
    expect(lit('b', edges)).toEqual(['a', 'b', 'y']); // x is a's other branch
    expect(lit('a', edges)).toEqual(['a', 'b', 'x']); // y only shares the target b
    expect([...focusOn('b', edges).edges].sort()).toEqual(['a>b', 'y>b']);
  });

  it('includes the files of the hovered skill but not those of the skills along the chain', () => {
    const edges = [...chain, file('a', 'a/run.py'), file('b', 'b/notes.md'), file('a/run.py', 'a/guide.md')];
    expect(lit('a', edges)).toEqual(['a', 'a/run.py', 'b', 'c', 'd']);
  });

  it('keeps a hovered file with its skill and the documents one line away, and stops there', () => {
    const edges = [...chain, file('a', 'a/run.py'), file('a/guide.md', 'a/run.py'), file('a', 'a/guide.md')];
    expect(lit('a/run.py', edges)).toEqual(['a', 'a/guide.md', 'a/run.py']);
  });

  it('terminates on cycles and handles a node without edges', () => {
    const loop = [link('a', 'b'), link('b', 'c'), link('c', 'a')];
    expect(lit('a', loop)).toEqual(['a', 'b', 'c']);
    expect(lit('z', loop)).toEqual(['z']);
    expect(focusOn('z', loop).edges.size).toBe(0);
  });
});
