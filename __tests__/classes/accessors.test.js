import { expectBehavior, compileSource, createActor, expectActorBehavior } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Published params
//
// Class and file params are private unless published with `@`:
//   @a Integer          → accessor @a, replies with the value positionally
//   @label: Text        → accessor @label
//   @label: l Text    → accessor @label, local binding l
//   a Integer           → private: no accessor
// A renamed public name is an explicit handler: `@b = { a }`.
// ═══════════════════════════════════════════════════════════════════════════════

describe('published params — compilation', () => {
  it('positional and named params publish', () => {
    expect(() => compileSource(`
      T = (@a Integer, @label: Text) *{ @x = -> 1 }
      @test = { t = T(1, label: "x"); a Integer = t.a(); l Text = t.label(); return result: a }
    `)).not.toThrow();
  });

  it('an unpublished param has no accessor', () => {
    expect(() => compileSource(`
      T = (a Integer) *{ @x = -> 1 }
      @test = { t = T(1); a Integer = t.a(); return result: a }
    `)).toThrow(/'T' has no method 'a'/);
  });

  it('an accessor reply is positional, not named', () => {
    expect(() => compileSource(`
      T = (@a Integer) *{ @x = -> 1 }
      @test = { t = T(1); :a Integer = t.a(); return result: a }
    `)).toThrow(/Cannot destructure 'a' from 't.a\(\)'.*write 'a Integer = t.a\(\)'/);
  });

  it('a published param and a handler cannot share a name', () => {
    expect(() => compileSource(`
      T = (@val Integer) *{ @val = -> result: 999 }
      @test = -> 1
    `)).toThrow(/'@val' is both a published param and a handler of 'T'/);
  });

  it('a function param cannot be published', () => {
    expect(() => compileSource(`
      f = (@a Integer) { a }
      @test = -> 1
    `)).toThrow(/Cannot publish param 'a' of a function/);
  });

  it('a handler param cannot be published', () => {
    expect(() => compileSource(`
      @test = (@a Integer) { a }
    `)).toThrow(/Cannot publish param 'a' of a function/);
  });
});

describe('published params — retired accessor syntax', () => {
  it('(name) Type', () => {
    expect(() => compileSource(`
      T = ((a) Integer) *{ @x = -> 1 }
      @test = -> 1
    `)).toThrow(/'\(a\)' is retired: params are private unless published/);
  });

  it('(name) :accessor Type', () => {
    expect(() => compileSource(`
      T = ((a) :b Integer) *{ @x = -> 1 }
      @test = -> 1
    `)).toThrow(/Accessor remap '\(a\) :b' is retired.*'@b = \{ a \}'/);
  });

  it('name: :accessor Type', () => {
    expect(() => compileSource(`
      T = (a: :b Integer) *{ @x = -> 1 }
      @test = -> 1
    `)).toThrow(/Accessor remap 'a: :b' is retired/);
  });

  it('name: (alias) :accessor Type', () => {
    expect(() => compileSource(`
      T = (a: (l) :b Integer) *{ @x = -> 1 }
      @test = -> 1
    `)).toThrow(/Accessor remap 'a: \(l\) :b' is retired/);
  });
});

describe('published params — service document', () => {
  it('lists published params as read-only fields', () => {
    const { interface: iface } = compileSource(`
      @T = (@a Integer, @label: l Text, quiet: Text) *{ @x = -> 1 }
      @test = -> 1
    `);
    expect(iface.service).toContain('T (Integer, label: Text, quiet: Text) -> *{\n    a Integer\n    label Text\n    x () -> (Integer)\n  }');
  });

  it('lists published file params as read-only fields', () => {
    const { interface: iface } = compileSource(`
      *
        @count Integer
        @tag: Text
        quiet Integer
      *
      @test = -> 1
    `);
    expect(iface.service).toBe('{\n  count Integer\n  tag Text\n  test () -> (Integer)\n}');
  });
});

describe('published params — runtime', () => {
  const script = `
    T = (@a Integer, @b Integer = 99) *{
      @sum = -> result: (a + b)
    }

    Named = (@label: l Text, quiet: Text) *{
      @both = -> result: l + quiet
    }

    Renamed = (a Integer) *{
      @b = { a }
    }

    @testProvided = { t = T(1, 2); b Integer = t.b(); return result: b }
    @testDefault = { t = T(1); b Integer = t.b(); return result: b }
    @testRequired = { t = T(42); a Integer = t.a(); return result: a }
    @testAliased = { n = Named(label: "x", quiet: "y"); l Text = n.label(); return result: l }
    @testPrivateInHandler = { n = Named(label: "x", quiet: "y"); :result Text = n.both(); return :result }
    @testRenamed = { r = Renamed(7); b Integer = r.b(); return result: b }
  `;

  const run = (op, value) => expectBehavior(script,
    { input: { id: '1', op, from: 'c' } },
    { output: expect.objectContaining({ id: '1', re: { result: value }, to: 'c' }) },
  );

  it('accessor returns the provided value', async () => { await run('testProvided', 2); });
  it('accessor returns the default when omitted', async () => { await run('testDefault', 99); });
  it('required param accessor alongside an optional one', async () => { await run('testRequired', 42); });
  it('aliased named param publishes under its label', async () => { await run('testAliased', 'x'); });
  it('a private param is still bound inside the class', async () => { await run('testPrivateInHandler', 'xy'); });
  it('an explicit handler renames the public name', async () => { await run('testRenamed', 7); });
});

describe('published file params — runtime', () => {
  const source = `
    *
      @count Integer
      quiet: Integer
    *
    @go = -> 1
  `;

  it('a published file param answers its accessor', async () => {
    const actor = await createActor(source, { constructorArgs: [5, { quiet: 6 }] });
    await expectActorBehavior(actor,
      { input: { id: '1', op: 'count', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [5], to: 'c' }) },
    );
  });

  it('an unpublished file param has no accessor', async () => {
    const actor = await createActor(source, { constructorArgs: [5, { quiet: 6 }] });
    await expectActorBehavior(actor,
      { input: { id: '1', op: 'quiet', from: 'c' } },
      { output: expect.objectContaining({ id: '1', ex: { 'quiet': 'unhandled' }, to: 'c' }) },
    );
  });
});
