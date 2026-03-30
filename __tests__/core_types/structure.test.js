import { expectBehavior } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// ...args rest binding
// ═══════════════════════════════════════════════════════════════════════════════

describe('...args rest binding', () => {
  const script = `
    @pass = |...args| ->(...args)
    @passTyped = |...args Structure| ->(...args as Structure)
    @passSpacious
      =
      ...args Structure
      =
      ->
        ...args as Structure
  `;

  it('named payload passes through — pack/splat roundtrip', async () => {
    await expectBehavior(script, { input: { id: '1', op: [{ a: 1, b: 2 }, '@pass'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'c' } }, { output: { id: '1', 'bv-a': { a: 'Integer', b: 'Integer' }, re: { a: 1, b: 2 }, to: 'c' } });
  });

  it('positional payload passes through — pack/splat roundtrip', async () => {
    await expectBehavior(script, { input: { id: '2', op: [[1, 2], '@pass'], 'bv-a': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '2', 'bv-a': ['Integer', 'Integer'], re: [1, 2], to: 'c' } });
  });

  it('mixed payload passes through — pack/splat roundtrip', async () => {
    await expectBehavior(script, { input: { id: '3', op: [[1, 2, { c: 3 }], '@pass'], 'bv-a': [['Integer', 'Integer', { c: 'Integer' }]], from: 'c' } }, { output: { id: '3', 'bv-a': ['Integer', 'Integer', { c: 'Integer' }], re: [1, 2, { c: 3 }], to: 'c' } });
  });

  it('explicit Structure type annotation is accepted', async () => {
    await expectBehavior(script, { input: { id: '4', op: [{ x: 42 }, '@passTyped'], 'bv-a': [{ x: 'Integer' }], from: 'c' } }, { output: { id: '4', 'bv-a': { x: 'Integer' }, re: { x: 42 }, to: 'c' } });
  });

  it('lineal form with ...args Structure', async () => {
    await expectBehavior(script, { input: { id: '5', op: [{ a: 1, b: 2 }, '@passSpacious'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'c' } }, { output: { id: '5', 'bv-a': { a: 'Integer', b: 'Integer' }, re: { a: 1, b: 2 }, to: 'c' } });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Structure destructuring
// ═══════════════════════════════════════════════════════════════════════════════

describe('Structure destructuring', () => {
  const script = `
    @namedTwo    = |...args| :a, :b = args    -> result: a
    @namedOne    = |...args| :a = args         -> result: a
    @namedParen  = |...args| (:a, :b) = args   -> result: a
    @posTwo      = |...args| a, b = args       -> result: a
    @posIndex    = |...args| a = args[0]       -> result: a
    @posParen    = |...args| (a, b) = args     -> result: a
    @posTrailing = |...args| (a,) = args       -> result: a
    @mixedThree  = |...args| a, b, :c = args   -> result: a
    @mixedParen  = |...args| (a, b, :c) = args -> result: c
    @keyMap      = |...args| a: x = args       -> result: x
    @keyMapParen = |...args| (a: x) = args     -> result: x
  `;

  it('named — :a, :b = args', async () => {
    await expectBehavior(script, { input: { id: '1', op: [{ a: 10, b: 20 }, '@namedTwo'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'c' } }, { output: { id: '1', re: { result: 10 }, to: 'c' } });
  });

  it('named — :a = args (extra keys ignored)', async () => {
    await expectBehavior(script, { input: { id: '2', op: [{ a: 99, b: 2, c: 3 }, '@namedOne'], 'bv-a': [{ a: 'Integer', b: 'Integer', c: 'Integer' }], from: 'c' } }, { output: { id: '2', re: { result: 99 }, to: 'c' } });
  });

  it('named — paren form', async () => {
    await expectBehavior(script, { input: { id: '3', op: [{ a: 7, b: 8 }, '@namedParen'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'c' } }, { output: { id: '3', re: { result: 7 }, to: 'c' } });
  });

  it('positional — a, b = args', async () => {
    await expectBehavior(script, { input: { id: '4', op: [[3, 4], '@posTwo'], 'bv-a': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '4', re: { result: 3 }, to: 'c' } });
  });

  it('positional — a = args[0]', async () => {
    await expectBehavior(script, { input: { id: '5', op: [[42, 99, 1], '@posIndex'], 'bv-a': [['Integer', 'Integer', 'Integer']], from: 'c' } }, { output: { id: '5', re: { result: 42 }, to: 'c' } });
  });

  it('positional — paren form', async () => {
    await expectBehavior(script, { input: { id: '6', op: [[5, 6], '@posParen'], 'bv-a': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '6', re: { result: 5 }, to: 'c' } });
  });

  it('positional — trailing-comma paren form', async () => {
    await expectBehavior(script, { input: { id: '7', op: [[11, 22], '@posTrailing'], 'bv-a': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '7', re: { result: 11 }, to: 'c' } });
  });

  it('mixed — a, b, :c = args', async () => {
    await expectBehavior(script, { input: { id: '8', op: [[1, 2, { c: 3 }], '@mixedThree'], 'bv-a': [['Integer', 'Integer', { c: 'Integer' }]], from: 'c' } }, { output: { id: '8', re: { result: 1 }, to: 'c' } });
  });

  it('mixed — paren form, uses named field', async () => {
    await expectBehavior(script, { input: { id: '9', op: [[1, 2, { c: 99 }], '@mixedParen'], 'bv-a': [['Integer', 'Integer', { c: 'Integer' }]], from: 'c' } }, { output: { id: '9', re: { result: 99 }, to: 'c' } });
  });

  it('key-mapped — a: x = args', async () => {
    await expectBehavior(script, { input: { id: '10', op: [{ a: 55 }, '@keyMap'], 'bv-a': [{ a: 'Integer' }], from: 'c' } }, { output: { id: '10', re: { result: 55 }, to: 'c' } });
  });

  it('key-mapped — paren form', async () => {
    await expectBehavior(script, { input: { id: '11', op: [{ a: 77 }, '@keyMapParen'], 'bv-a': [{ a: 'Integer' }], from: 'c' } }, { output: { id: '11', re: { result: 77 }, to: 'c' } });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Structure accessors
// ═══════════════════════════════════════════════════════════════════════════════

describe('Structure accessors', () => {
  const script = `
    @accessFirst  = |...args| x = args[0]   -> result: x
    @accessSecond = |...args| x = args[1]   -> result: x
    @accessNamed  = |...args| x = args["a"] -> result: x
  `;

  it('args[0] reads first positional', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[42, 99], '@accessFirst'], 'bv-a': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', re: { result: 42 }, to: 'c' } });
  });

  it('args[1] reads second positional', async () => {
    await expectBehavior(script, { input: { id: '2', op: [[10, 20], '@accessSecond'], 'bv-a': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '2', re: { result: 20 }, to: 'c' } });
  });

  it('args["a"] reads named field', async () => {
    await expectBehavior(script, { input: { id: '3', op: [{ a: 'hello' }, '@accessNamed'], 'bv-a': [{ a: 'Text' }], from: 'c' } }, { output: { id: '3', re: { result: 'hello' }, to: 'c' } });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Structure constructor
// ═══════════════════════════════════════════════════════════════════════════════

describe('Structure constructor', () => {
  const script = `
    @constructSingle
      =
      ...args
      =
      a Integer = Structure(42 as Integer)
      -> result: a

    @constructClosure
      =
      ...args
      =
      x Integer = 10
      f = { x }
      s Structure = Structure(fn: f as Function)
      :fn = s
      result Integer = fn()
      -> result

    @constructLive
      =
      x Integer = 10
      :fn = Structure(fn: { x } as Function)
      x = 20
      result Integer = fn()
      -> result

    @constructTyped
      =
      ...args
      =
      a, b = args
      s Structure = Structure(a, b)
      ->(...s)

    @constructNamed
      =
      s Structure = Structure(a: "alpha" as Text, b: "beta" as Text)
      ->(...s)

    @constructMixed
      =
      s Structure = Structure(1 as Integer, 2 as Integer, x: "extra" as Text)
      ->(...s)
  `;

  it('Structure(v as Type) assigns unwrapped value', async () => {
    await expectBehavior(script, { input: { id: '1', op: '@constructSingle', from: 'c' } }, { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 42 }, to: 'c' } });
  });

  it('function closure preserved through Structure extraction', async () => {
    await expectBehavior(script, { input: { id: '2', op: '@constructClosure', from: 'c' } }, { output: { id: '2', 'bv-a': ['Integer'], re: [10], to: 'c' } });
  });

  it('Structure-stored function observes capture-time binding', async () => {
    await expectBehavior(script, { input: { id: '3', op: '@constructLive', from: 'c' } }, { output: { id: '3', 'bv-a': ['Integer'], re: [10], to: 'c' } });
  });

  it('Structure(a, b) from typed locals carries types through', async () => {
    await expectBehavior(script, { input: { id: '4', op: [[3, 4], '@constructTyped'], 'bv-a': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '4', 'bv-a': ['Integer', 'Integer'], re: [3, 4], to: 'c' } });
  });

  it('Structure(k: v as Type, ...) builds named structure', async () => {
    await expectBehavior(script, { input: { id: '5', op: '@constructNamed', from: 'c' } }, { output: { id: '5', re: { a: 'alpha', b: 'beta' }, to: 'c' } });
  });

  it('Structure(v as Type, k: v as Type) builds mixed structure', async () => {
    await expectBehavior(script, { input: { id: '6', op: '@constructMixed', from: 'c' } }, { output: { id: '6', re: [1, 2, { x: 'extra' }], to: 'c' } });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Structure return — bv-a coercion
// ═══════════════════════════════════════════════════════════════════════════════

describe('Structure return — bv-a coercion', () => {
  const script = `
    @rawStructureOneArity
      =
      s Structure = Structure(100 as Integer)
      -> s as Structure

    @rawStructureTwoArity
      =
      s Structure = Structure(100 as Integer, 200 as Integer)
      -> s as Structure
  `;

  it.skip('single-arity Structure returns [[100]] with bv-a', async () => {
    await expectBehavior(script, { input: { id: '1', op: '@rawStructureOneArity', from: 'c' } }, { output: { id: '1', 'bv-a': ['Structure'], re: [[100]], to: 'c' } });
  });

  it.skip('two-arity Structure returns [[100, 200]] with bv-a', async () => {
    await expectBehavior(script, { input: { id: '2', op: '@rawStructureTwoArity', from: 'c' } }, { output: { id: '2', 'bv-a': ['Structure'], re: [[100, 200]], to: 'c' } });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Runtime errors (deferred)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Structure destructuring — runtime errors (deferred)', () => {
  it.skip('a, b, c = args — too many positionals is a runtime error', async () => {
    const script = `
      @test
        =
        ...args
        =
        a, b, c = args
        -> result: a
    `;
    await expectBehavior(script,
      { input: { id: '1', op: [[1, 2], '@test'], from: 'caller' } },
      { output: { id: '1', ex: { '@test': 'destructure error' }, to: 'caller' } },
    );
  });

  it.skip(':a, :b, :c = args — missing named key is a runtime error', async () => {
    const script = `
      @test
        =
        ...args
        =
        :a, :b, :c = args
        -> result: a
    `;
    await expectBehavior(script,
      { input: { id: '1', op: [{ a: 1, b: 2 }, '@test'], from: 'caller' } },
      { output: { id: '1', ex: { '@test': 'destructure error' }, to: 'caller' } },
    );
  });
});
