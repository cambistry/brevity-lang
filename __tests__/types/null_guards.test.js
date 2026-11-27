import { expectBehavior, compileSource } from '../helpers.js';

// A call or a member read through a name whose type includes null is guarded. A
// guard narrows the name: inside `if (t)` or `if (t != null)`, in the `else` of
// `if (not t)` or `if (t == null)`, after an early exit (`if (not t) { return … }`),
// and `t ?? d` is never null. See notes/checking-reaches-every-body-2026-11-27.md.

describe('null guards — at run time', () => {
  const script = `
    T = *(x Integer) { @a = () -> x }
    held *T | null = null
    @fill! = { *held <- T(5) }
    @read = {
      if (not held) { return 0 }
      x Integer = held.a()
      return x
    }
  `;

  it('an early exit answers while the cell is null, and the call after it once it holds an actor', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'read', from: 'c' } },
      { output: { id: '1', ty: ['Integer'], re: [0], to: 'c' } },
      { input: { id: '2', op: 'fill!', from: 'c' } },
      { output: { id: '2', re: ['#<:>'], ty: ['*'], to: 'c' } },
      { input: { id: '3', op: 'read', from: 'c' } },
      { output: { id: '3', ty: ['Integer'], re: [5], to: 'c' } },
    );
  });
});

describe('null guards — what they allow', () => {
  const T = 'T = *(x Integer) { @a = () -> x }';

  it('a call through a param that may be null, unguarded, is an error', () => {
    expect(() => compileSource(`${T}
      @f = (t T | null) { x Integer = t.a(); return x }
    `)).toThrow("'t' may be null, so a call through it is guarded: 'if (t) { … }'");
  });

  it('so is one through a local', () => {
    expect(() => compileSource(`${T}
      @f = { t T | null = T(1); x Integer = t.a(); return x }
    `)).toThrow("'t' may be null, so a call through it is guarded: 'if (t) { … }'");
  });

  it('inside if (t)', () => {
    expect(() => compileSource(`${T}
      @f = (t T | null) { if (t) { x Integer = t.a(); return x }; return 0 }
    `)).not.toThrow();
  });

  it('after an early exit', () => {
    expect(() => compileSource(`${T}
      @f = (t T | null) {
        if (not t) { return 0 }
        x Integer = t.a()
        return x
      }
    `)).not.toThrow();
  });

  it('an if that does not exit narrows nothing after it', () => {
    expect(() => compileSource(`${T}
      @f = (t T | null) {
        if (not t) { y = 1 }
        x Integer = t.a()
        return x
      }
    `)).toThrow("'t' may be null, so a call through it is guarded: 'if (t) { … }'");
  });

  it('inside if (t != null), and in the else of if (t == null)', () => {
    expect(() => compileSource(`${T}
      @f = (t T | null) {
        if (t != null) { x Integer = t.a(); return x }
        r Integer = if (t == null) { 0 } else { t.a() }
        return r
      }
    `)).not.toThrow();
  });

  it('t ?? d is never null', () => {
    expect(() => compileSource(`${T}
      @f = (t T | null) { x Integer = (t ?? T(0)).a(); return x }
    `)).not.toThrow();
  });

  it('not still takes Booleans, or a value that may be null', () => {
    expect(() => compileSource(`
      @f = (n Integer) { b Boolean = not n; return b }
    `)).toThrow("'not' takes Booleans: this operand is 'Integer'");
  });
});
