import { expectBehavior, compileSource } from '../helpers.js';

// Read-only ref parameters — `&Type` declares a parameter that the callee
// can read (and subscribe to, in a live-cell sense) but cannot mutate. The
// caller passes the value bare; no grant marker is needed at the call site
// because the callee is requesting strictly less than full capability.
//
// Restrictions enforced inside the callee body:
//   - `<-` against the parameter is a compile error
//   - calling any `.X!` (bang) method on the parameter is a compile error
//
// Read access (.size, .first, .contains, .subscribe, plain field reads on
// shapes) remains allowed.
//
// Per notes/capability-sigils-2026-05-06.md.

// ── Reads succeed ────────────────────────────────────────────────────────────

describe('readonly param — &Type permits reads', () => {
  it('&List of Integers — value flows through readonly param', async () => {
    await expectBehavior(`
      @run
        =
        ns *List of Integers = [10, 20, 30]
        echo = (xs &List of Integers) { xs }
        result List of Integers = echo(ns)
        -> :result
    `,
      { input: { id: '1', op: '@run', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'List of Integers' }, re: { result: [10, 20, 30] }, to: 'c' } },
    );
  });
});

// ── Writes are rejected ──────────────────────────────────────────────────────

describe('readonly param — &Type rejects mutation', () => {
  it('`<-` against an &Integer param → compile error', () => {
    expect(() => compileSource(`
      @run
        =
        n *Integer = 0
        bump = (x &Integer) { x <- x + 1 }
        bump(n)
        -> result: n
    `)).toThrow(/read-only/);
  });

  it('`<-` against an &Point param → compile error', () => {
    expect(() => compileSource(`
      ::Point = (x Integer, y Integer)
      @run
        =
        coords *Point = Point(0, 0)
        replace = (p &Point) { p <- Point(7, 8) }
        replace(coords)
        -> :coords
    `)).toThrow(/read-only/);
  });

  it('.append! on an &List param → compile error', () => {
    expect(() => compileSource(`
      @run
        =
        ns *List of Integers = [1, 2]
        addOne = (xs &List of Integers) { xs.append!(99) }
        addOne(ns)
        -> :ns
    `)).toThrow(/read-only parameter/);
  });

  it('.reverse! on an &List param → compile error', () => {
    expect(() => compileSource(`
      @run
        =
        ns *List of Integers = [1, 2, 3]
        rev = (xs &List of Integers) { xs.reverse! }
        rev(ns)
        -> :ns
    `)).toThrow(/read-only parameter/);
  });
});
