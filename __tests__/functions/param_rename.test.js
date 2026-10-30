import { compileSource, expectBehavior, createActor, expectActorBehavior } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// After a named param's colon:
//   key: local Type   — rename: the caller passes `key`, the body sees `local`
//   key: X            — X is a type when one by that name is in scope,
//                       otherwise the param's local (untyped)
// A type name in scope is reserved: no param may share it. In scope: built-ins,
// the file's `::` types and classes, and every name the header binds.
// A single name in parens (`key: (local)`) is retired.
// ═══════════════════════════════════════════════════════════════════════════════

describe('named param — rename', () => {
  it('typed rename runs', async () => {
    await expectBehavior(`
      f = (key: k Integer) { k + 1 }
      @test = { r Integer = f(key: 41); return result: r }
    `,
      { input: { id: '1', op: '@test', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: { result: 42 } }) },
    );
  });

  it('untyped rename in a generic runs (lone name, no such type)', async () => {
    await expectBehavior(`
      f = (key: k) { k * 2 }
      @test = { r Integer = f(key: 21); return result: r }
    `,
      { input: { id: '1', op: '@test', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: { result: 42 } }) },
    );
  });

  it('a lone name that is a type in scope is the type', async () => {
    await expectBehavior(`
      ::Point (x Integer, y Integer)
      f = (p: Point) { p.x + p.y }
      @test = { r Integer = f(p: Point(1, 2)); return result: r }
    `,
      { input: { id: '1', op: '@test', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: { result: 3 } }) },
    );
  });

  it('a lone name with a default is a local; the default gives its type', () => {
    expect(() => compileSource(`
      f = (n: k = 5) { k + 1 }
      @test = { r Integer = f(); return result: r }
    `)).not.toThrow();
  });

  it('a public handler rename needs a type', () => {
    expect(() => compileSource('@f = (a: b) -> b\n')).toThrow(/Public function param 'a: b' requires a type annotation/);
    expect(() => compileSource('@f = (a: b Integer) -> b\n')).not.toThrow();
  });

  it('a published class param renames', async () => {
    const actor = await createActor(`
      *
        @label: l Text
      *
      @get = -> l
    `, { constructorArgs: { label: 'hi' } });
    await expectActorBehavior(actor,
      { input: { id: '1', op: '@label', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: ['hi'], to: 'c' }) },
    );
  });

  it('a file param renames', async () => {
    const actor = await createActor(`
      *
        limit: n Integer
      *
      @get = -> n
    `, { constructorArgs: { limit: 7 } });
    await expectActorBehavior(actor,
      { input: { id: '1', op: '@get', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [7], to: 'c' }) },
    );
  });

  it('a keyed ref param renames', () => {
    expect(() => compileSource(`
      Wrapper = (child: inner *) *{ @x = -> 1 }
      @test = -> 1
    `)).not.toThrow();
  });
});

describe('named param — a misspelt type', () => {
  it('reads as a rename; using the key says so', () => {
    expect(() => compileSource(`
      f = (limit: Intger) { limit + 1 }
      @test = -> 1
    `)).toThrow(/'Intger' is not declared or imported, so 'limit: Intger' names the param's local 'Intger' and leaves 'limit' unbound/);
  });
});

describe('type names are reserved', () => {
  it.each([
    ['a built-in', 'f = (Integer Integer) { 1 }'],
    ['a :: type', '::Point (x Integer)\nf = (Point Integer) { 1 }'],
    ['a class', 'Box = *{ @x = -> 1 }\nf = (Box Integer) { 1 }'],
    ['a named param', '::Point (x Integer)\nf = (Point: Integer) { 1 }'],
    ['a rename local', '::Point (x Integer)\nf = (p: Point Integer) { 1 }'],
  ])('a param may not share the name of %s', (_label, src) => {
    expect(() => compileSource(`${src}\n@test = -> 1\n`)).toThrow(/has the name of a type in scope/);
  });

  it('a header binding is a type in scope', () => {
    expect(() => compileSource(`
      *
        "thing.bv": Thing #
      *
      f = (Thing Integer) { 1 }
      @test = -> 1
    `)).toThrow(/Param 'Thing' has the name of a type in scope/);
  });
});

describe('single name in parens — retired', () => {
  it.each([
    ['f = (key: (k) Integer) { k }', "'key: (k)' is retired — write 'key: k Integer'"],
    ['f = (key: (k)) { k }', "'key: (k)' is retired — write 'key: k'"],
    ['W = (child: (inner) *) *{ @x = -> 1 }', "'child: (inner)' is retired — write 'child: inner *'"],
    ['C = (@label: (l) Text) *{ @x = -> 1 }', "'label: (l)' is retired — write 'label: l Text'"],
  ])('%s', (src, message) => {
    expect(() => compileSource(`${src}\n@test = -> 1\n`)).toThrow(message);
  });

  it('a function-typed param keeps its parens', () => {
    expect(() => compileSource(`
      f = (cb: (Integer) -> (Integer)) { cb(1) }
      @test = -> 1
    `)).not.toThrow();
  });
});
