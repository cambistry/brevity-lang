import { runActor, expectReply } from './helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture — ...args rest binding
//
// ...args binds the entire op payload as a Structure:
//   { positional: [...], named: {...}, positional_types: null, named_types: null }
// ->(...args) splats the Structure back to wire format.
// Pack+splat is identity for the standard payload shapes tested here.
// ═══════════════════════════════════════════════════════════════════════════════

describe('...args rest binding', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      @pass = |...args| ->(...args)

      @passTyped = |...args : Structure| ->(...args : Structure)

      @passSpacious
        =
        ...args : Structure
        =
        ->
          ...args : Structure
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: [{ a: 1, b: 2 }, '@pass'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'c' },
        { id: '2', op: [[1, 2], '@pass'], 'bv-a': [['Integer', 'Integer']], from: 'c' },
        { id: '3', op: [[1, 2, { c: 3 }], '@pass'], 'bv-a': [['Integer', 'Integer', { c: 'Integer' }]], from: 'c' },
        { id: '4', op: [{ x: 42 }, '@passTyped'], 'bv-a': [{ x: 'Integer' }], from: 'c' },
        { id: '5', op: [{ a: 1, b: 2 }, '@passSpacious'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'c' },
      ],
    });
  });

  // named payload → pack → splat → same named payload
  it('named payload passes through — pack/splat roundtrip', () => {
    expect(outputs[0]).toEqual({
      id: '1', 'bv-a': { a: 'Integer', b: 'Integer' }, re: { a: 1, b: 2 }, to: 'c',
    });
  });

  // positional payload → pack → splat → same positional payload
  it('positional payload passes through — pack/splat roundtrip', () => {
    expect(outputs[1]).toEqual({
      id: '2', 'bv-a': ['Integer', 'Integer'], re: [1, 2], to: 'c',
    });
  });

  // mixed payload (positional + trailing named) → identity
  it('mixed payload passes through — pack/splat roundtrip', () => {
    expect(outputs[2]).toEqual({
      id: '3', 'bv-a': ['Integer', 'Integer', { c: 'Integer' }], re: [1, 2, { c: 3 }], to: 'c',
    });
  });

  // explicit : Structure annotation accepted on both param and return
  it('explicit : Structure type annotation is accepted', () => {
    expect(outputs[3]).toEqual({
      id: '4', 'bv-a': { x: 'Integer' }, re: { x: 42 }, to: 'c',
    });
  });

  // spacious form with ...args : Structure and stitch separator
  it('spacious form with ...args : Structure', () => {
    expect(outputs[4]).toEqual({
      id: '5', 'bv-a': { a: 'Integer', b: 'Integer' }, re: { a: 1, b: 2 }, to: 'c',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture — Structure destructuring
//
// Named (:a, :b = args), positional (a, b = args), mixed (a, b, :c = args),
// key-mapped (a: x = args), paren forms, and trailing-comma form.
// ═══════════════════════════════════════════════════════════════════════════════

describe('Structure destructuring', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      --- named destructuring ---

      @namedTwo
        =
        ...args
        =
        :a, :b = args
        -> result: a

      @namedOne
        =
        ...args
        =
        :a = args
        -> result: a

      @namedParen
        =
        ...args
        =
        (:a, :b) = args
        -> result: a

      --- positional destructuring ---

      @posTwo
        =
        ...args
        =
        a, b = args
        -> result: a

      @posIndex
        =
        ...args
        =
        a = args[0]
        -> result: a

      @posParen
        =
        ...args
        =
        (a, b) = args
        -> result: a

      @posTrailing
        =
        ...args
        =
        (a,) = args
        -> result: a

      --- mixed destructuring ---

      @mixedThree
        =
        ...args
        =
        a, b, :c = args
        -> result: a

      @mixedParen
        =
        ...args
        =
        (a, b, :c) = args
        -> result: c

      --- key-mapped destructuring ---

      @keyMap
        =
        ...args
        =
        a: x = args
        -> result: x

      @keyMapParen
        =
        ...args
        =
        (a: x) = args
        -> result: x
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: [{ a: 10, b: 20 }, '@namedTwo'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'c' },
        { id: '2', op: [{ a: 99, b: 2, c: 3 }, '@namedOne'], 'bv-a': [{ a: 'Integer', b: 'Integer', c: 'Integer' }], from: 'c' },
        { id: '3', op: [{ a: 7, b: 8 }, '@namedParen'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'c' },
        { id: '4', op: [[3, 4], '@posTwo'], 'bv-a': [['Integer', 'Integer']], from: 'c' },
        { id: '5', op: [[42, 99, 1], '@posIndex'], 'bv-a': [['Integer', 'Integer', 'Integer']], from: 'c' },
        { id: '6', op: [[5, 6], '@posParen'], 'bv-a': [['Integer', 'Integer']], from: 'c' },
        { id: '7', op: [[11, 22], '@posTrailing'], 'bv-a': [['Integer', 'Integer']], from: 'c' },
        { id: '8', op: [[1, 2, { c: 3 }], '@mixedThree'], 'bv-a': [['Integer', 'Integer', { c: 'Integer' }]], from: 'c' },
        { id: '9', op: [[1, 2, { c: 99 }], '@mixedParen'], 'bv-a': [['Integer', 'Integer', { c: 'Integer' }]], from: 'c' },
        { id: '10', op: [{ a: 55 }, '@keyMap'], 'bv-a': [{ a: 'Integer' }], from: 'c' },
        { id: '11', op: [{ a: 77 }, '@keyMapParen'], 'bv-a': [{ a: 'Integer' }], from: 'c' },
      ],
    });
  });

  // :a, :b = args extracts named fields
  it('named — :a, :b = args', () => {
    expect(outputs[0]).toEqual({ id: '1', re: { result: 10 }, to: 'c' });
  });

  // :a = args extracts single named field when structure has more keys
  it('named — :a = args (extra keys ignored)', () => {
    expect(outputs[1]).toEqual({ id: '2', re: { result: 99 }, to: 'c' });
  });

  // (:a, :b) = args — paren form
  it('named — paren form', () => {
    expect(outputs[2]).toEqual({ id: '3', re: { result: 7 }, to: 'c' });
  });

  // a, b = args extracts positional fields
  it('positional — a, b = args', () => {
    expect(outputs[3]).toEqual({ id: '4', re: { result: 3 }, to: 'c' });
  });

  // a = args[0] extracts first positional element
  it('positional — a = args[0]', () => {
    expect(outputs[4]).toEqual({ id: '5', re: { result: 42 }, to: 'c' });
  });

  // (a, b) = args — paren form
  it('positional — paren form', () => {
    expect(outputs[5]).toEqual({ id: '6', re: { result: 5 }, to: 'c' });
  });

  // (a,) = args — paren trailing-comma form
  it('positional — trailing-comma paren form', () => {
    expect(outputs[6]).toEqual({ id: '7', re: { result: 11 }, to: 'c' });
  });

  // a, b, :c = args extracts positional and named
  it('mixed — a, b, :c = args', () => {
    expect(outputs[7]).toEqual({ id: '8', re: { result: 1 }, to: 'c' });
  });

  // (a, b, :c) = args — paren form, uses named field
  it('mixed — paren form, uses named field', () => {
    expect(outputs[8]).toEqual({ id: '9', re: { result: 99 }, to: 'c' });
  });

  // a: x = args binds key a to local x
  it('key-mapped — a: x = args', () => {
    expect(outputs[9]).toEqual({ id: '10', re: { result: 55 }, to: 'c' });
  });

  // (a: x) = args — paren form
  it('key-mapped — paren form', () => {
    expect(outputs[10]).toEqual({ id: '11', re: { result: 77 }, to: 'c' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture — Structure accessors
//
// args[0], args[1], args["key"] — indexed and keyed access on a Structure.
// ═══════════════════════════════════════════════════════════════════════════════

describe('Structure accessors', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      @accessFirst
        =
        ...args
        =
        x = args[0]
        -> result: x

      @accessSecond
        =
        ...args
        =
        x = args[1]
        -> result: x

      @accessNamed
        =
        ...args
        =
        x = args["a"]
        -> result: x
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: [[42, 99], '@accessFirst'], 'bv-a': [['Integer', 'Integer']], from: 'c' },
        { id: '2', op: [[10, 20], '@accessSecond'], 'bv-a': [['Integer', 'Integer']], from: 'c' },
        { id: '3', op: [{ a: 'hello' }, '@accessNamed'], 'bv-a': [{ a: 'Text' }], from: 'c' },
      ],
    });
  });

  // args[0] reads first positional element
  it('args[0] reads first positional', () => {
    expect(outputs[0]).toEqual({ id: '1', re: { result: 42 }, to: 'c' });
  });

  // args[1] reads second positional element
  it('args[1] reads second positional', () => {
    expect(outputs[1]).toEqual({ id: '2', re: { result: 20 }, to: 'c' });
  });

  // args["a"] reads named field by key
  it('args["a"] reads named field', () => {
    expect(outputs[2]).toEqual({ id: '3', re: { result: 'hello' }, to: 'c' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture — Structure constructor
//
// Structure(v : Type), Structure(k: v : Type, ...), Structure(a, b) from
// typed locals, and closure preservation through Structure extraction.
// ═══════════════════════════════════════════════════════════════════════════════

describe('Structure constructor', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
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
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: [{}, '@constructSingle'], from: 'c' },
        { id: '2', op: [{}, '@constructClosure'], from: 'c' },
        { id: '3', op: '@constructLive', from: 'c' },
        { id: '4', op: [[3, 4], '@constructTyped'], 'bv-a': [['Integer', 'Integer']], from: 'c' },
        { id: '5', op: '@constructNamed', from: 'c' },
        { id: '6', op: '@constructMixed', from: 'c' },
      ],
    });
  });

  // Structure(v : Type) assigns the unwrapped value
  it('Structure(v : Type) assigns unwrapped value', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { result: 'Integer' }, re: { result: 42 }, to: 'c' });
  });

  // function closure survives Structure storage and extraction
  it('function closure preserved through Structure extraction', () => {
    expect(outputs[1]).toEqual({ id: '2', 'bv-a': ['Integer'], re: [10], to: 'c' });
  });

  // closure captures value at creation time, not live binding
  it('Structure-stored function observes capture-time binding', () => {
    expect(outputs[2]).toEqual({ id: '3', 'bv-a': ['Integer'], re: [10], to: 'c' });
  });

  // Structure(a, b) from typed locals carries types through splat
  it('Structure(a, b) from typed locals carries types through', () => {
    expect(outputs[3]).toEqual({ id: '4', 'bv-a': ['Integer', 'Integer'], re: [3, 4], to: 'c' });
  });

  // Structure(k: v : Type, ...) builds a named structure
  it('Structure(k: v : Type, ...) builds named structure', () => {
    expect(outputs[4]).toEqual({ id: '5', re: { a: 'alpha', b: 'beta' }, to: 'c' });
  });

  // Structure(v : Type, k: v : Type) builds a mixed structure
  it('Structure(v : Type, k: v : Type) builds mixed structure', () => {
    expect(outputs[5]).toEqual({ id: '6', re: [1, 2, { x: 'extra' }], to: 'c' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture — Structure return with bv-a coercion
//
// Returning a Structure directly with `as Structure` should produce wire-format
// positional arrays with bv-a: "Structure".
// ═══════════════════════════════════════════════════════════════════════════════

describe('Structure return — bv-a coercion', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      @rawStructureOneArity
        =
        s : Structure = Structure(100 : Integer)
        -> s : Structure

      @rawStructureTwoArity
        =
        s : Structure = Structure(100 : Integer, 200 : Integer)
        -> s : Structure
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: '@rawStructureOneArity', from: 'c' },
        { id: '2', op: '@rawStructureTwoArity', from: 'c' },
      ],
    });
  });

  it.skip('single-arity Structure returns [[100]] with bv-a', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': ['Structure'], re: [[100]], to: 'c' });
  });

  it.skip('two-arity Structure returns [[100, 200]] with bv-a', () => {
    expect(outputs[1]).toEqual({ id: '2', 'bv-a': ['Structure'], re: [[100, 200]], to: 'c' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Runtime errors (deferred) — skipped until error handling is implemented
// ═══════════════════════════════════════════════════════════════════════════════

describe('Structure destructuring — runtime errors (deferred)', () => {
  it.skip('a, b, c = args — too many positionals is a runtime error', async () => {
    const source = `
      @test
        =
        ...args
        =
        a, b, c = args
        -> result: a
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [[1, 2], '@test'], from: 'caller' },
      reply: { id: '1', ex: { '@test': 'destructure error' }, to: 'caller' },
    });
  });

  it.skip(':a, :b, :c = args — missing named key is a runtime error', async () => {
    const source = `
      @test
        =
        ...args
        =
        :a, :b, :c = args
        -> result: a
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{ a: 1, b: 2 }, '@test'], from: 'caller' },
      reply: { id: '1', ex: { '@test': 'destructure error' }, to: 'caller' },
    });
  });
});
