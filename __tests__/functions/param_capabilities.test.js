import { expectBehavior, compileSource } from '../helpers.js';

// Param-capability sigils on function parameters — write-cap (*Type) for
// scalars, shapes, and collections passed to lambdas. The call-site `*name`
// is the explicit grant marker mirroring the param sigil. By-val (no sigil)
// passes the current value; *Type with *name grants live-cell write capability.
//
// Read-only ref params (&Type) and the matching restrictions land in a
// follow-up commit. Per notes/capability-sigils-2026-05-06.md.
//
// Actor references are out of scope for this convention — bare names work
// as today (see classes/peer.test.js, classes/peer_list.test.js).

// ── Scalar — *Integer ────────────────────────────────────────────────────────

describe('param capabilities — *Integer write-cap on lambda', () => {
  const script = `
    @bumpOnce
      =
      n *Integer = 0
      bump = (x *Integer) { x <- x + 1 }
      bump(*n)
      -> result: n

    @bumpTwice
      =
      n *Integer = 0
      bump = (x *Integer) { x <- x + 1 }
      bump(*n)
      bump(*n)
      -> result: n
  `;

  it('*Integer param mutates caller cell when granted *n', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@bumpOnce', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' } },
    );
  });

  it('repeated *Integer grants accumulate on caller cell', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@bumpTwice', from: 'c' } },
      { output: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 2 }, to: 'c' } },
    );
  });
});

// ── Shape — *Point ───────────────────────────────────────────────────────────

describe('param capabilities — *Point write-cap on lambda', () => {
  const script = `
    ::Point = (x Integer, y Integer)

    @replace
      =
      coords *Point = Point(0, 0)
      reset = (p *Point) { p <- Point(7, 8) }
      reset(*coords)
      -> :coords
  `;

  it('whole-cell replace via *Point grant propagates to caller', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@replace', from: 'c' } },
      { output: { id: '1', 'bv-a': { coords: '::Point' }, re: { coords: [7, 8] }, to: 'c' } },
    );
  });
});

// ── Collection — *List of Integers ───────────────────────────────────────────

describe('param capabilities — *List write-cap on lambda', () => {
  // Whole-cell replacement (`xs <- [...]`) is the supported propagation
  // pattern for collection refs through *List params, paralleling scalar
  // and shape behavior.
  const script = `
    @whole_replace
      =
      ns *List of Integers = [1, 2, 3]
      reset = (xs *List of Integers) {
        xs <- [9, 8, 7]
      }
      reset(*ns)
      -> :ns
  `;

  it('whole-cell replace via *List grant propagates to caller', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@whole_replace', from: 'c' } },
      { output: { id: '1', 'bv-a': { ns: 'List of Integers' }, re: { ns: [9, 8, 7] }, to: 'c' } },
    );
  });
});

// ── Negative cases ───────────────────────────────────────────────────────────

describe('param capabilities — compile errors', () => {
  it('passing *Integer ref without grant marker → compile error', () => {
    expect(() => compileSource(`
      @test
        =
        n *Integer = 0
        bump = (x *Integer) { x <- x + 1 }
        bump(n)
        -> result: n
    `)).toThrow();
  });

  it('granting * on a non-ref local → compile error', () => {
    expect(() => compileSource(`
      @test
        =
        n Integer = 0
        bump = (x *Integer) { x <- x + 1 }
        bump(*n)
        -> result: n
    `)).toThrow(/not a ref cell/);
  });

  it('granting * to a by-val parameter → compile error', () => {
    expect(() => compileSource(`
      @test
        =
        n *Integer = 0
        reader = (x Integer) { x + 1 }
        reader(*n)
        -> result: n
    `)).toThrow();
  });

  it('legacy &n cell-handoff against *Type param → compile error', () => {
    expect(() => compileSource(`
      @test
        =
        n *Integer = 0
        bump = (x *Integer) { x <- x + 1 }
        bump(&n)
        -> result: n
    `)).toThrow(/use '\*n'/);
  });
});
