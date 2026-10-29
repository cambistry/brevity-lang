import { compileSource, expectBehavior } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// `:x = f()` (and `x: v = f()`) destructures f's named `x`. A sole positional
// result does not bind into a named pattern item — bind it by position:
// `x T = f()`. Rejected at compile time when f's returns are statically known
// (a file-level function, or a method defined on an in-file class).
// ═══════════════════════════════════════════════════════════════════════════════

describe('named destructure — rejected when the callee returns no such name', () => {
  it('file-level function with a positional result', () => {
    expect(() => compileSource(`
      double = (n Integer) { n * 2 }
      @test = { :result Integer = double(21); return :result }
    `)).toThrow(/Cannot destructure 'result' from 'double\(\)'.*write 'result Integer = double\(\)'/);
  });

  it('post-colon form (same as the colon prefix)', () => {
    expect(() => compileSource(`
      Box = (v Integer) *{ @get = -> r: v }
      @h = { b = Box(1); x: Integer = b.get(); return result: x }
    `)).toThrow(/Cannot destructure 'x' from 'b.get\(\)'/);
  });

  it('an Object among several returned values carries no names', () => {
    expect(() => compileSource(`
      g = (n Integer) { return x: n }
      f = (n Integer) { r Object = g(n); return r, 7 }
      @test = { :x Integer = f(1); return result: x }
    `)).toThrow(/Cannot destructure 'x' from 'f\(\)'/);
  });

  it('key form', () => {
    expect(() => compileSource(`
      double = (n Integer) { return n * 2 }
      @test = { result: r Integer = double(21); return result: r }
    `)).toThrow(/Cannot destructure 'result'/);
  });

  it('a different named field', () => {
    expect(() => compileSource(`
      f = (n Integer) { return value: n }
      @test = { :result Integer = f(1); return :result }
    `)).toThrow(/Cannot destructure 'result'/);
  });

  it('class method with a positional result', () => {
    expect(() => compileSource(`
      C = *{
        news *List = []
        @news = { news }
      }
      @run = { a = C(); :a1 List = a.news(); return :a1 }
    `)).toThrow(/Cannot destructure 'a1' from 'a.news\(\)'/);
  });
});

describe('positional bind — rejected when the callee returns only named fields', () => {
  it('file-level function', () => {
    expect(() => compileSource(`
      f = (n Integer) { return value: n }
      @run = { value Integer = f(7); return a1: value }
    `)).toThrow(/Cannot bind 'value' to 'f\(\)' — it returns only named fields \(value\); destructure instead: ':value Integer = f\(\)'/);
  });

  it('class method', () => {
    expect(() => compileSource(`
      C = *{ @get = -> value: 7 }
      @run = { a = C(); value Integer = a.get(); return a1: value }
    `)).toThrow(/Cannot bind 'value' to 'a.get\(\)'/);
  });

  it('class method on a typed construction, different local name', () => {
    expect(() => compileSource(`
      C = *{ @get = -> value: 7 }
      @run = { a C = C(); v Integer = a.get(); return a1: v }
    `)).toThrow(/destructure instead: 'value: v Integer = a.get\(\)'/);
  });
});

describe('named destructure — accepted', () => {
  it('callee returns the name', () => {
    expect(() => compileSource(`
      f = (n Integer) { return value: n }
      @test = { :value Integer = f(1); return :value }
    `)).not.toThrow();
  });

  it('class method returns the name', () => {
    expect(() => compileSource(`
      C = *{ @get = -> value: 1 }
      @run = { a = C(); :value Integer = a.get(); return :value }
    `)).not.toThrow();
  });

  it('key form extracts a named field into another local', async () => {
    await expectBehavior(`
      f = (n Integer) { return value: n }
      @run = { value: v Integer = f(7); return a1: v }
    `,
      { input: { id: '1', op: '@run', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: { a1: 7 } }) },
    );
  });

  it('typed Object bind takes the whole reply', () => {
    expect(() => compileSource(`
      f = (n Integer) { return value: n }
      @run = { r Object = f(7); return r }
    `)).not.toThrow();
  });

  it('callee returns an Object (its names are not known statically)', () => {
    expect(() => compileSource(`
      g = (n Integer) { return x: n }
      f = (n Integer) { r Object = g(n); return r }
      @test = { :x Integer = f(1); return result: x }
    `)).not.toThrow();
  });
});

describe('positional result — bind by position', () => {
  it('runs', async () => {
    await expectBehavior(`
      double = (n Integer) { n * 2 }
      @test = { result Integer = double(21); return :result }
    `,
      { input: { id: '1', op: '@test', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 42 }, to: 'c' } },
    );
  });
});

describe('positional result of a class method — bind by position', () => {
  const run = (src, value) => expectBehavior(src,
    { input: { id: '1', op: '@run', from: 'c' } },
    { output: expect.objectContaining({ id: '1', re: { a1: value } }) },
  );

  it('Integer literal reply', async () => {
    await run(`
      C = *{ @seven = { 7 } }
      @run = { a = C(); v Integer = a.seven(); return a1: v }
    `, 7);
  });

  it('List cell reply', async () => {
    await run(`
      C = *{
        news *List = ["x"]
        @news = { news }
      }
      @run = { a = C(); a1 List = a.news(); return a1: a1 }
    `, ['x']);
  });

  it('typed construction', async () => {
    await run(`
      C = *{
        news *List = ["x"]
        @news = { news }
      }
      @run = { a C = C(); a1 List = a.news(); return a1: a1 }
    `, ['x']);
  });

  it('typed construction, named return', async () => {
    await run(`
      C = *{
        n *Integer = 7
        @get = -> value: n
      }
      @run = { a C = C(); :value Integer = a.get(); return a1: value }
    `, 7);
  });

});

// An inherited method is checked against the ancestor that declares it, using
// that ancestor's own state/param types.
describe('return shape — inherited methods', () => {
  it('positional bind of an inherited named-only result is rejected', () => {
    expect(() => compileSource(`
      Base = *{ @get = -> value: 1 }
      Box = (Base |) *{}
      @run = { b = Box(); n Integer = b.get(); return a1: n }
    `)).toThrow(/Cannot bind 'n' to 'b.get\(\)' — it returns only named fields \(value\)/);
  });

  it('named destructure of an inherited positional result is rejected', () => {
    expect(() => compileSource(`
      Base = *{ @seven = { 7 } }
      Box = (Base |) *{}
      @run = { b = Box(); :x Integer = b.seven(); return a1: x }
    `)).toThrow(/Cannot destructure 'x' from 'b.seven\(\)'/);
  });

  it('a grandparent method is checked', () => {
    expect(() => compileSource(`
      A = *{ @get = -> value: 1 }
      B = (A |) *{}
      C = (B |) *{}
      @run = { c = C(); n Integer = c.get(); return a1: n }
    `)).toThrow(/returns only named fields \(value\)/);
  });

  it('a subclass override wins over the parent', () => {
    expect(() => compileSource(`
      Base = *{ @get = -> value: 1 }
      Box = (Base |) *{ @get = { 2 } }
      @run = { b = Box(); n Integer = b.get(); return a1: n }
    `)).not.toThrow();
  });

  it('with two parents, the later one wins', () => {
    const src = (bind) => `
      A = *{ @get = -> value: 1 }
      B = *{ @get = { 2 } }
      C = (A, B |) *{}
      @run = { c = C(); ${bind}; return a1: n }
    `;
    expect(() => compileSource(src('n Integer = c.get()'))).not.toThrow();
    expect(() => compileSource(src(':n Integer = c.get()'))).toThrow(/Cannot destructure 'n'/);
  });

  it("uses the declaring class's state types", () => {
    // `v` is Integer state on Base, so `-> v` is a known positional; Box has
    // no `v` of its own.
    expect(() => compileSource(`
      Base = *{
        v Integer = 3
        @get = -> v
      }
      Box = (Base |) *{}
      @run = { b = Box(); :x Integer = b.get(); return a1: x }
    `)).toThrow(/Cannot destructure 'x' from 'b.get\(\)'/);
  });

  it('an inherited named result destructures and runs', async () => {
    await expectBehavior(`
      Base = *{ @get = -> value: 7 }
      Box = (Base |) *{}
      @run = { b = Box(); :value Integer = b.get(); return a1: value }
    `,
      { input: { id: '1', op: '@run', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: { a1: 7 } }) },
    );
  });

  it('an inherited positional result binds and runs (empty-bodied subclass)', async () => {
    await expectBehavior(`
      Base = *{ @seven = { 7 } }
      Box = (Base |) *{}
      @run = { b = Box(); n Integer = b.seven(); return a1: n }
    `,
      { input: { id: '1', op: '@run', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: { a1: 7 } }) },
    );
  });

  describe('manifest classes', () => {
    const shapes = `{
      Base () -> *{
        get () -> (value: Integer)
        size () -> (Integer)
      }
      Box (Base |) -> *{}
    }`;
    const withBox = (body) => compileSource(`*\n  Shapes: (:Box)\n*\n${body}\n`, {
      remotes: [{ path: 'Shapes', service: shapes }],
    });

    it('inherited named-only result: positional bind rejected', () => {
      expect(() => withBox('@run = { b = Box(); n Integer = b.get(); return a1: n }'))
        .toThrow(/returns only named fields \(value\)/);
    });

    it('inherited named result: wrong name rejected', () => {
      expect(() => withBox('@run = { b = Box(); :wrong Integer = b.get(); return a1: wrong }'))
        .toThrow(/Cannot destructure 'wrong'/);
    });

    it('inherited positional result: positional bind accepted', () => {
      expect(() => withBox('@run = { b = Box(); n Integer = b.size(); return a1: n }')).not.toThrow();
    });
  });
});
