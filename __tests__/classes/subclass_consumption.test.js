import { compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Subclass consumption — compile-time checks
//
// These tests use compileSource (no runtime), so they pass on every target:
// the validator's discipline is the single source of truth for "legal call".
//
// Synthetic domain-neutral types (T / U / W) — no HTML or other domain
// conventions. The subclass-interface mechanism must be sound in its own right
// before any consumer (e.g. an HTML tag hierarchy) layers on top.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Happy path ───────────────────────────────────────────────────────────────

describe('subclass consumption — happy path', () => {
  it('sub-for-super: subclass passed where superclass param expected (positional)', () => {
    expect(() => compileSource(`
      T = *(x Integer) { @a = () -> v: x as Integer }
      U = T ^ *(x Integer, y Integer) { super(x); @b = () -> v: y as Integer }
      take = (t T) -> result: t.a() as Integer
      @test
        =
        u = U(1, 2)
        :result Integer = take(u)
        return :result as Integer
    `)).not.toThrow();
  });

  it('sub-for-super: subclass passed where superclass param expected (named)', () => {
    expect(() => compileSource(`
      T = *(x: Integer) { @a = () -> v: x as Integer }
      U = T ^ *(x: Integer, y: Integer) { super(x: x); @b = () -> v: y as Integer }
      take = (t: T) -> result: t.a() as Integer
      @test
        =
        u = U(x: 1, y: 2)
        :result Integer = take(t: u)
        return :result as Integer
    `)).not.toThrow();
  });

  it('call inherited method on subclass-typed value', () => {
    expect(() => compileSource(`
      T = *(x Integer) { @a = () -> v: x as Integer }
      U = T ^ *(x Integer, y Integer) { super(x); @b = () -> v: y as Integer }
      @test
        =
        u U = U(1, 2)
        :v = u.a()
        return result: v as Integer
    `)).not.toThrow();
  });

  it('call own method on subclass-typed value', () => {
    expect(() => compileSource(`
      T = *(x Integer) { @a = () -> v: x as Integer }
      U = T ^ *(x Integer, y Integer) { super(x); @b = () -> v: y as Integer }
      @test
        =
        u U = U(1, 2)
        :v = u.b()
        return result: v as Integer
    `)).not.toThrow();
  });

  it('call inherited method on superclass-typed value', () => {
    expect(() => compileSource(`
      T = *(x Integer) { @a = () -> v: x as Integer }
      U = T ^ *(x Integer, y Integer) { super(x); @b = () -> v: y as Integer }
      @test
        =
        u T = U(1, 2)
        :v = u.a()
        return result: v as Integer
    `)).not.toThrow();
  });

  it('nullable param accepts null', () => {
    expect(() => compileSource(`
      T = *(x Integer) { @a = () -> v: x as Integer }
      take = (t T | null) -> result: 0 as Integer
      @test
        =
        :result Integer = take(null)
        return :result as Integer
    `)).not.toThrow();
  });

  it('nullable param accepts the underlying type', () => {
    expect(() => compileSource(`
      T = *(x Integer) { @a = () -> v: x as Integer }
      take = (t T | null) -> result: 0 as Integer
      @test
        =
        t = T(1)
        :result Integer = take(t)
        return :result as Integer
    `)).not.toThrow();
  });
});

// ── Sad path: method existence ───────────────────────────────────────────────

describe('subclass consumption — method existence (sad path)', () => {
  it('P3: subclass-only method on superclass-typed value is rejected', () => {
    expect(() => compileSource(`
      T = *(x Integer) { @a = () -> v: x as Integer }
      U = T ^ *(x Integer, y Integer) { super(x); @b = () -> v: y as Integer }
      @test
        =
        u T = U(1, 2)
        :v = u.b()
        return result: v as Integer
    `)).toThrow(/has no method 'b'/);
  });

  it('P8: calling a nonexistent method is rejected', () => {
    expect(() => compileSource(`
      T = *(x Integer) { @a = () -> v: x as Integer }
      @test
        =
        t = T(1)
        :result = t.nonexistent()
        return :result as Integer
    `)).toThrow(/has no method 'nonexistent'/);
  });

  it('error lists available methods on the declared type', () => {
    expect(() => compileSource(`
      T = *(@x Integer) { @a = () -> v: x as Integer }
      @test
        =
        t = T(1)
        :result = t.nope()
        return :result as Integer
    `)).toThrow(/available: a, x/);
  });
});

// ── Sad path: assignability ──────────────────────────────────────────────────

describe('subclass consumption — assignability (sad path)', () => {
  it('P4: superclass passed where subclass expected is rejected', () => {
    expect(() => compileSource(`
      T = *(x Integer) { @a = () -> v: x as Integer }
      U = T ^ *(x Integer, y Integer) { super(x); @b = () -> v: y as Integer }
      take = (u U) -> result: u.b() as Integer
      @test
        =
        t = T(1)
        :result Integer = take(t)
        return :result as Integer
    `)).toThrow(/'T' is not assignable to 'U'/);
  });

  it('P7: unrelated type passed where T expected is rejected', () => {
    expect(() => compileSource(`
      T = *(x Integer) { @a = () -> v: x as Integer }
      W = *(n Integer) { @w = () -> v: n as Integer }
      take = (t T) -> result: t.a() as Integer
      @test
        =
        w = W(99)
        :result Integer = take(w)
        return :result as Integer
    `)).toThrow(/'W' is not assignable to 'T'/);
  });

  it('P9: wrong primitive type at constructor is rejected', () => {
    expect(() => compileSource(`
      T = *(x Integer) { @a = () -> v: x as Integer }
      @test
        =
        t = T("not-an-int")
        :result = t.a()
        return :result as Integer
    `)).toThrow(/'Text' is not assignable to 'Integer'/);
  });

  it('wrong primitive at named constructor arg is rejected', () => {
    expect(() => compileSource(`
      T = *(x: Integer) { @a = () -> v: x as Integer }
      @test
        =
        t = T(x: "wrong")
        :result = t.a()
        return :result as Integer
    `)).toThrow(/named arg 'x'.*'Text'.*'Integer'/);
  });
});

// ── A typed local or cell takes an instance as a param does ─────────────────

describe('subclass consumption — a typed local or cell', () => {
  const classes = `
      T = *(x Integer) { @a = () -> v: x as Integer }
      U = T ^ *(x Integer, y Integer) { super(x); @b = () -> v: y as Integer }
      W = *(n Integer) { @w = () -> v: n as Integer }
  `;

  it('a typed local takes a subclass instance', () => {
    expect(() => compileSource(`${classes}
      @f = { t T = U(1, 2); return 1 }
    `)).not.toThrow();
  });

  it('a typed local refuses an instance of an unrelated class', () => {
    expect(() => compileSource(`${classes}
      @f = { t T = W(1); return 1 }
    `)).toThrow("Cannot bind 't T' to a value that is W: 'W' is not assignable to 'T'");
  });

  it('a typed local refuses a superclass instance where a subclass is declared', () => {
    expect(() => compileSource(`${classes}
      @f = { u U = T(1); return 1 }
    `)).toThrow("Cannot bind 'u U' to a value that is T: 'T' is not assignable to 'U'");
  });

  it('a typed local in a nested block is checked', () => {
    expect(() => compileSource(`${classes}
      @f = (n Integer) {
        if (n > 0) { t T = W(1); return 1 }
        return 2
      }
    `)).toThrow("Cannot bind 't T' to a value that is W: 'W' is not assignable to 'T'");
  });

  it('a typed cell and a write to it take subclass instances', () => {
    expect(() => compileSource(`${classes}
      @f = { c *T = U(1, 2); *c <- U(3, 4); return 1 }
    `)).not.toThrow();
  });

  it('a typed cell refuses an instance of an unrelated class', () => {
    expect(() => compileSource(`${classes}
      @f = { c *T = W(1); return 1 }
    `)).toThrow("Cannot bind 'c *T' to a value that is W: 'W' is not assignable to 'T'");
  });

  it('a write to a typed cell refuses an instance of an unrelated class', () => {
    expect(() => compileSource(`${classes}
      @f = { c *T = U(1, 2); *c <- W(1); return 1 }
    `)).toThrow("Cannot set 'c *T' to a value that is W: 'W' is not assignable to 'T'");
  });

  it('a state cell refuses an instance of an unrelated class', () => {
    expect(() => compileSource(`${classes}
      held *T = W(1)
      @f = () -> 1
    `)).toThrow("Cannot bind 'held *T' to a value that is W: 'W' is not assignable to 'T'");
  });

  it('a write to a state cell takes a subclass instance', () => {
    expect(() => compileSource(`${classes}
      held *T = T(1)
      @f! = { *held <- U(1, 2) }
    `)).not.toThrow();
  });

  it('a write to a state cell refuses an instance of an unrelated class', () => {
    expect(() => compileSource(`${classes}
      held *T = T(1)
      @f! = { *held <- W(1) }
    `)).toThrow("Cannot set 'held *T' to a value that is W: 'W' is not assignable to 'T'");
  });
});

// ── Sad path: constructor shape ──────────────────────────────────────────────

describe('subclass consumption — constructor shape (sad path)', () => {
  it('P10: missing required param, the one passed to super, is rejected', () => {
    expect(() => compileSource(`
      T = *(x Integer) { @a = () -> v: x as Integer }
      U = T ^ *(x Integer, y Integer) { super(x); @b = () -> v: y as Integer }
      @test
        =
        u = U(y: 2)
        :v = u.a()
        return result: v as Integer
    `)).toThrow(/doesn't match any constructor clause/);
  });

  it('missing required own positional param is rejected', () => {
    expect(() => compileSource(`
      T = *(x Integer, y Integer) { @a = () -> v: x as Integer }
      @test
        =
        t = T(1)
        :result = t.a()
        return :result as Integer
    `)).toThrow(/doesn't match any constructor clause/);
  });

  it('unexpected named arg is rejected', () => {
    expect(() => compileSource(`
      T = *(x: Integer) { @a = () -> v: x as Integer }
      @test
        =
        t = T(x: 1, unexpected: 99)
        :result = t.a()
        return :result as Integer
    `)).toThrow(/doesn't match any constructor clause/);
  });

  it('excess positional args are rejected', () => {
    expect(() => compileSource(`
      T = *(x Integer) { @a = () -> v: x as Integer }
      @test
        =
        t = T(1, 2, 3)
        :result = t.a()
        return :result as Integer
    `)).toThrow(/doesn't match any constructor clause/);
  });
});

// ── Sad path: method arg-type ────────────────────────────────────────────────

describe('subclass consumption — method arg-type (sad path)', () => {
  it('method called with wrong primitive arg is rejected', () => {
    expect(() => compileSource(`
      T = * { @take = (n Integer) -> v: n as Integer }
      @test
        =
        t = T()
        :result Integer = t.take("wrong")
        return :result as Integer
    `)).toThrow(/'Text' is not assignable to 'Integer'/);
  });
});
