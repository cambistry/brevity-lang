import { compileActor, createActor, expectActorReply } from './helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// ...args rest binding
// ═══════════════════════════════════════════════════════════════════════════════

describe('...args rest binding', () => {
  let actor;

  beforeAll(async () => {
    actor = await createActor(`
      @pass = |...args| ->(...args)
      @passTyped = |...args : Structure| ->(...args : Structure)
      @passSpacious
        =
        ...args : Structure
        =
        ->
          ...args : Structure
    `);
  });

  it('named payload passes through — pack/splat roundtrip', async () => {
    await expectActorReply({ actor, receive: { id: '1', op: [{ a: 1, b: 2 }, '@pass'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'c' }, reply: { id: '1', 'bv-a': { a: 'Integer', b: 'Integer' }, re: { a: 1, b: 2 }, to: 'c' } });
  });

  it('positional payload passes through — pack/splat roundtrip', async () => {
    await expectActorReply({ actor, receive: { id: '2', op: [[1, 2], '@pass'], 'bv-a': [['Integer', 'Integer']], from: 'c' }, reply: { id: '2', 'bv-a': ['Integer', 'Integer'], re: [1, 2], to: 'c' } });
  });

  it('mixed payload passes through — pack/splat roundtrip', async () => {
    await expectActorReply({ actor, receive: { id: '3', op: [[1, 2, { c: 3 }], '@pass'], 'bv-a': [['Integer', 'Integer', { c: 'Integer' }]], from: 'c' }, reply: { id: '3', 'bv-a': ['Integer', 'Integer', { c: 'Integer' }], re: [1, 2, { c: 3 }], to: 'c' } });
  });

  it('explicit : Structure type annotation is accepted', async () => {
    await expectActorReply({ actor, receive: { id: '4', op: [{ x: 42 }, '@passTyped'], 'bv-a': [{ x: 'Integer' }], from: 'c' }, reply: { id: '4', 'bv-a': { x: 'Integer' }, re: { x: 42 }, to: 'c' } });
  });

  it('lineal form with ...args : Structure', async () => {
    await expectActorReply({ actor, receive: { id: '5', op: [{ a: 1, b: 2 }, '@passSpacious'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'c' }, reply: { id: '5', 'bv-a': { a: 'Integer', b: 'Integer' }, re: { a: 1, b: 2 }, to: 'c' } });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Structure destructuring
// ═══════════════════════════════════════════════════════════════════════════════

describe('Structure destructuring', () => {
  let actor;

  beforeAll(async () => {
    actor = await createActor(`
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
    `);
  });

  it('named — :a, :b = args', async () => {
    await expectActorReply({ actor, receive: { id: '1', op: [{ a: 10, b: 20 }, '@namedTwo'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'c' }, reply: { id: '1', re: { result: 10 }, to: 'c' } });
  });

  it('named — :a = args (extra keys ignored)', async () => {
    await expectActorReply({ actor, receive: { id: '2', op: [{ a: 99, b: 2, c: 3 }, '@namedOne'], 'bv-a': [{ a: 'Integer', b: 'Integer', c: 'Integer' }], from: 'c' }, reply: { id: '2', re: { result: 99 }, to: 'c' } });
  });

  it('named — paren form', async () => {
    await expectActorReply({ actor, receive: { id: '3', op: [{ a: 7, b: 8 }, '@namedParen'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'c' }, reply: { id: '3', re: { result: 7 }, to: 'c' } });
  });

  it('positional — a, b = args', async () => {
    await expectActorReply({ actor, receive: { id: '4', op: [[3, 4], '@posTwo'], 'bv-a': [['Integer', 'Integer']], from: 'c' }, reply: { id: '4', re: { result: 3 }, to: 'c' } });
  });

  it('positional — a = args[0]', async () => {
    await expectActorReply({ actor, receive: { id: '5', op: [[42, 99, 1], '@posIndex'], 'bv-a': [['Integer', 'Integer', 'Integer']], from: 'c' }, reply: { id: '5', re: { result: 42 }, to: 'c' } });
  });

  it('positional — paren form', async () => {
    await expectActorReply({ actor, receive: { id: '6', op: [[5, 6], '@posParen'], 'bv-a': [['Integer', 'Integer']], from: 'c' }, reply: { id: '6', re: { result: 5 }, to: 'c' } });
  });

  it('positional — trailing-comma paren form', async () => {
    await expectActorReply({ actor, receive: { id: '7', op: [[11, 22], '@posTrailing'], 'bv-a': [['Integer', 'Integer']], from: 'c' }, reply: { id: '7', re: { result: 11 }, to: 'c' } });
  });

  it('mixed — a, b, :c = args', async () => {
    await expectActorReply({ actor, receive: { id: '8', op: [[1, 2, { c: 3 }], '@mixedThree'], 'bv-a': [['Integer', 'Integer', { c: 'Integer' }]], from: 'c' }, reply: { id: '8', re: { result: 1 }, to: 'c' } });
  });

  it('mixed — paren form, uses named field', async () => {
    await expectActorReply({ actor, receive: { id: '9', op: [[1, 2, { c: 99 }], '@mixedParen'], 'bv-a': [['Integer', 'Integer', { c: 'Integer' }]], from: 'c' }, reply: { id: '9', re: { result: 99 }, to: 'c' } });
  });

  it('key-mapped — a: x = args', async () => {
    await expectActorReply({ actor, receive: { id: '10', op: [{ a: 55 }, '@keyMap'], 'bv-a': [{ a: 'Integer' }], from: 'c' }, reply: { id: '10', re: { result: 55 }, to: 'c' } });
  });

  it('key-mapped — paren form', async () => {
    await expectActorReply({ actor, receive: { id: '11', op: [{ a: 77 }, '@keyMapParen'], 'bv-a': [{ a: 'Integer' }], from: 'c' }, reply: { id: '11', re: { result: 77 }, to: 'c' } });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Structure accessors
// ═══════════════════════════════════════════════════════════════════════════════

describe('Structure accessors', () => {
  let actor;

  beforeAll(async () => {
    actor = await createActor(`
      @accessFirst  = |...args| x = args[0]   -> result: x
      @accessSecond = |...args| x = args[1]   -> result: x
      @accessNamed  = |...args| x = args["a"] -> result: x
    `);
  });

  it('args[0] reads first positional', async () => {
    await expectActorReply({ actor, receive: { id: '1', op: [[42, 99], '@accessFirst'], 'bv-a': [['Integer', 'Integer']], from: 'c' }, reply: { id: '1', re: { result: 42 }, to: 'c' } });
  });

  it('args[1] reads second positional', async () => {
    await expectActorReply({ actor, receive: { id: '2', op: [[10, 20], '@accessSecond'], 'bv-a': [['Integer', 'Integer']], from: 'c' }, reply: { id: '2', re: { result: 20 }, to: 'c' } });
  });

  it('args["a"] reads named field', async () => {
    await expectActorReply({ actor, receive: { id: '3', op: [{ a: 'hello' }, '@accessNamed'], 'bv-a': [{ a: 'Text' }], from: 'c' }, reply: { id: '3', re: { result: 'hello' }, to: 'c' } });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Structure constructor
// ═══════════════════════════════════════════════════════════════════════════════

describe('Structure constructor', () => {
  let actor;

  beforeAll(async () => {
    actor = await createActor(`
      @constructSingle
        =
        ...args
        =
        a : Integer = Structure(42 : Integer)
        -> result: a

      @constructClosure
        =
        ...args
        =
        x : Integer = 10
        f = { x }
        s : Structure = Structure(fn: f : Function)
        :fn = s
        result : Integer = fn()
        -> result

      @constructLive
        =
        x : Integer = 10
        :fn = Structure(fn: { x } : Function)
        x = 20
        result : Integer = fn()
        -> result

      @constructTyped
        =
        ...args
        =
        a, b = args
        s : Structure = Structure(a, b)
        ->(...s)

      @constructNamed
        =
        s : Structure = Structure(a: "alpha" : Text, b: "beta" : Text)
        ->(...s)

      @constructMixed
        =
        s : Structure = Structure(1 : Integer, 2 : Integer, x: "extra" : Text)
        ->(...s)
    `);
  });

  it('Structure(v : Type) assigns unwrapped value', async () => {
    await expectActorReply({ actor, receive: { id: '1', op: [{}, '@constructSingle'], from: 'c' }, reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 42 }, to: 'c' } });
  });

  it('function closure preserved through Structure extraction', async () => {
    await expectActorReply({ actor, receive: { id: '2', op: [{}, '@constructClosure'], from: 'c' }, reply: { id: '2', 'bv-a': ['Integer'], re: [10], to: 'c' } });
  });

  it('Structure-stored function observes capture-time binding', async () => {
    await expectActorReply({ actor, receive: { id: '3', op: '@constructLive', from: 'c' }, reply: { id: '3', 'bv-a': ['Integer'], re: [10], to: 'c' } });
  });

  it('Structure(a, b) from typed locals carries types through', async () => {
    await expectActorReply({ actor, receive: { id: '4', op: [[3, 4], '@constructTyped'], 'bv-a': [['Integer', 'Integer']], from: 'c' }, reply: { id: '4', 'bv-a': ['Integer', 'Integer'], re: [3, 4], to: 'c' } });
  });

  it('Structure(k: v : Type, ...) builds named structure', async () => {
    await expectActorReply({ actor, receive: { id: '5', op: '@constructNamed', from: 'c' }, reply: { id: '5', re: { a: 'alpha', b: 'beta' }, to: 'c' } });
  });

  it('Structure(v : Type, k: v : Type) builds mixed structure', async () => {
    await expectActorReply({ actor, receive: { id: '6', op: '@constructMixed', from: 'c' }, reply: { id: '6', re: [1, 2, { x: 'extra' }], to: 'c' } });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Structure return — bv-a coercion
// ═══════════════════════════════════════════════════════════════════════════════

describe('Structure return — bv-a coercion', () => {
  let actor;

  beforeAll(async () => {
    actor = await createActor(`
      @rawStructureOneArity
        =
        s : Structure = Structure(100 : Integer)
        -> s : Structure

      @rawStructureTwoArity
        =
        s : Structure = Structure(100 : Integer, 200 : Integer)
        -> s : Structure
    `);
  });

  it.skip('single-arity Structure returns [[100]] with bv-a', async () => {
    await expectActorReply({ actor, receive: { id: '1', op: '@rawStructureOneArity', from: 'c' }, reply: { id: '1', 'bv-a': ['Structure'], re: [[100]], to: 'c' } });
  });

  it.skip('two-arity Structure returns [[100, 200]] with bv-a', async () => {
    await expectActorReply({ actor, receive: { id: '2', op: '@rawStructureTwoArity', from: 'c' }, reply: { id: '2', 'bv-a': ['Structure'], re: [[100, 200]], to: 'c' } });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Runtime errors (deferred)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Structure destructuring — runtime errors (deferred)', () => {
  it.skip('a, b, c = args — too many positionals is a runtime error', async () => {
    const actor = await createActor(`
      @test
        =
        ...args
        =
        a, b, c = args
        -> result: a
    `);
    await expectActorReply({
      actor, receive: { id: '1', op: [[1, 2], '@test'], from: 'caller' },
      reply: { id: '1', ex: { '@test': 'destructure error' }, to: 'caller' },
    });
  });

  it.skip(':a, :b, :c = args — missing named key is a runtime error', async () => {
    const actor = await createActor(`
      @test
        =
        ...args
        =
        :a, :b, :c = args
        -> result: a
    `);
    await expectActorReply({
      actor, receive: { id: '1', op: [{ a: 1, b: 2 }, '@test'], from: 'caller' },
      reply: { id: '1', ex: { '@test': 'destructure error' }, to: 'caller' },
    });
  });
});
