import { expectBehavior } from '../helpers.js';

// Slice 4 of types-implementation-plan-2026-04-27: tag-aware equality.
// `Point(1, 2) == Point(1, 2)` is true; `Point(0, 0) == Pair(0, 0)` is
// false; `Point(0, 0) == (0, 0)` is false (the bare tuple has no tag).

describe('shape equality — Name(args) ==', () => {
  const script = `
    ::Point = (x Integer, y Integer)
    ::Pair  = (a Integer, b Integer)

    @same       = -> result: (Point(1, 2) == Point(1, 2))
    @diff_field = -> result: (Point(1, 2) == Point(3, 4))
    @diff_tag   = -> result: (Point(0, 0) == Pair(0, 0))
    @neq_same   = -> result: (Point(1, 2) != Point(1, 2))
    @neq_diff   = -> result: (Point(1, 2) != Point(3, 4))
  `;

  it('Point(1, 2) == Point(1, 2) is true', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@same', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Boolean' }, re: { result: true }, to: 'c' } },
    );
  });

  it('Point(1, 2) == Point(3, 4) is false', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@diff_field', from: 'c' } },
      { output: { id: '2', 'bv-a': { result: 'Boolean' }, re: { result: false }, to: 'c' } },
    );
  });

  it('Point(0, 0) == Pair(0, 0) is false (different tags)', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: '@diff_tag', from: 'c' } },
      { output: { id: '3', 'bv-a': { result: 'Boolean' }, re: { result: false }, to: 'c' } },
    );
  });

  it('Point(1, 2) != Point(1, 2) is false', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: '@neq_same', from: 'c' } },
      { output: { id: '4', 'bv-a': { result: 'Boolean' }, re: { result: false }, to: 'c' } },
    );
  });

  it('Point(1, 2) != Point(3, 4) is true', async () => {
    await expectBehavior(script,
      { input: { id: '5', op: '@neq_diff', from: 'c' } },
      { output: { id: '5', 'bv-a': { result: 'Boolean' }, re: { result: true }, to: 'c' } },
    );
  });
});
