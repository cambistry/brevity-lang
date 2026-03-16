import { expectReply } from './helpers.js';

// ...args binds the entire op payload as a Structure:
//   { positional: [...], named: {...}, positional_types: null, named_types: null }
// ->(...args) splats the Structure back to wire format.
// Pack+splat is identity for the standard payload shapes tested here.

describe('...args rest binding', () => {
  it('named payload passes through — pack/splat roundtrip', async () => {
    const source = 'on import(...args) ->(...args)\n';
    await expectReply({
      source,
      receive: { id: '1', op: [{ a: 1, b: 2 }, 'import'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'caller' },
      reply: {
        id: '1', 'bv-a': { a: 'Integer', b: 'Integer' }, re: { a: 1, b: 2 }, to: 'caller',
      },
    });
  });

  it('positional payload passes through — pack/splat roundtrip', async () => {
    const source = 'on import(...args) ->(...args)\n';
    await expectReply({
      source,
      receive: { id: '1', op: [[1, 2], 'import'], 'bv-a': [['Integer', 'Integer']], from: 'caller' },
      reply: {
        id: '1', 'bv-a': ['Integer', 'Integer'], re: [1, 2], to: 'caller',
      },
    });
  });

  it('mixed payload passes through — pack/splat roundtrip', async () => {
    const source = 'on import(...args) ->(...args)\n';
    await expectReply({
      source,
      receive: { id: '1', op: [[1, 2, { c: 3 }], 'import'], 'bv-a': [['Integer', 'Integer', { c: 'Integer' }]], from: 'caller' },
      reply: {
        id: '1', 'bv-a': ['Integer', 'Integer', { c: 'Integer' }], re: [1, 2, { c: 3 }], to: 'caller',
      },
    });
  });

  it('explicit : Structure type annotation is accepted', async () => {
    const source = 'on import(...args : Structure) ->(...args : Structure)\n';
    await expectReply({
      source,
      receive: { id: '1', op: [{ x: 42 }, 'import'], 'bv-a': [{ x: 'Integer' }], from: 'caller' },
      reply: {
        id: '1', 'bv-a': { x: 'Integer' }, re: { x: 42 }, to: 'caller',
      },
    });
  });

  it('open form with ...args : Structure and stitch separator', async () => {
    const source = `
      on import
        ...args : Structure
      --
        ->
          ...args : Structure
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{ a: 1, b: 2 }, 'import'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'caller' },
      reply: {
        id: '1', 'bv-a': { a: 'Integer', b: 'Integer' }, re: { a: 1, b: 2 }, to: 'caller',
      },
    });
  });
});

describe('Structure destructuring — named', () => {
  it(':a, :b = args extracts named fields', async () => {
    const source = `
      on test(...args)
        :a, :b = args
        -> result: a
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{ a: 10, b: 20 }, 'test'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'caller' },
      reply: { id: '1', re: { result: 10 }, to: 'caller' },
    });
  });

  it(':a = args extracts single named field when structure has more keys', async () => {
    const source = `
      on test(...args)
        :a = args
        -> result: a
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{ a: 99, b: 2, c: 3 }, 'test'], 'bv-a': [{ a: 'Integer', b: 'Integer', c: 'Integer' }], from: 'caller' },
      reply: { id: '1', re: { result: 99 }, to: 'caller' },
    });
  });

  it('(:a, :b) = args — paren form', async () => {
    const source = `
      on test(...args)
        (:a, :b) = args
        -> result: a
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{ a: 7, b: 8 }, 'test'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'caller' },
      reply: { id: '1', re: { result: 7 }, to: 'caller' },
    });
  });
});

describe('Structure destructuring — positional', () => {
  it('a, b = args extracts positional fields', async () => {
    const source = `
      on test(...args)
        a, b = args
        -> result: a
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [[3, 4], 'test'], 'bv-a': [['Integer', 'Integer']], from: 'caller' },
      reply: { id: '1', re: { result: 3 }, to: 'caller' },
    });
  });

  it('a = args[0] extracts first positional element', async () => {
    const source = `
      on test(...args)
        a = args[0]
        -> result: a
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [[42, 99, 1], 'test'], 'bv-a': [['Integer', 'Integer', 'Integer']], from: 'caller' },
      reply: { id: '1', re: { result: 42 }, to: 'caller' },
    });
  });

  it('(a, b) = args — paren form', async () => {
    const source = `
      on test(...args)
        (a, b) = args
        -> result: a
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [[5, 6], 'test'], 'bv-a': [['Integer', 'Integer']], from: 'caller' },
      reply: { id: '1', re: { result: 5 }, to: 'caller' },
    });
  });

  it('(a,) = args — paren trailing-comma form', async () => {
    const source = `
      on test(...args)
        (a,) = args
        -> result: a
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [[11, 22], 'test'], 'bv-a': [['Integer', 'Integer']], from: 'caller' },
      reply: { id: '1', re: { result: 11 }, to: 'caller' },
    });
  });
});

describe('Structure destructuring — mixed', () => {
  it('a, b, :c = args extracts positional and named', async () => {
    const source = `
      on test(...args)
        a, b, :c = args
        -> result: a
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [[1, 2, { c: 3 }], 'test'], 'bv-a': [['Integer', 'Integer', { c: 'Integer' }]], from: 'caller' },
      reply: { id: '1', re: { result: 1 }, to: 'caller' },
    });
  });

  it('(a, b, :c) = args — paren form, uses named field', async () => {
    const source = `
      on test(...args)
        (a, b, :c) = args
        -> result: c
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [[1, 2, { c: 99 }], 'test'], 'bv-a': [['Integer', 'Integer', { c: 'Integer' }]], from: 'caller' },
      reply: { id: '1', re: { result: 99 }, to: 'caller' },
    });
  });
});

describe('Structure destructuring — key-mapped', () => {
  it('a: x = args binds key a to local x', async () => {
    const source = `
      on test(...args)
        a: x = args
        -> result: x
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{ a: 55 }, 'test'], 'bv-a': [{ a: 'Integer' }], from: 'caller' },
      reply: { id: '1', re: { result: 55 }, to: 'caller' },
    });
  });

  it('(a: x) = args — paren form', async () => {
    const source = `
      on test(...args)
        (a: x) = args
        -> result: x
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{ a: 77 }, 'test'], 'bv-a': [{ a: 'Integer' }], from: 'caller' },
      reply: { id: '1', re: { result: 77 }, to: 'caller' },
    });
  });
});

describe('Structure destructuring — runtime errors (deferred)', () => {
  it.skip('a, b, c = args — too many positionals is a runtime error', async () => {
    const source = `
      on test(...args)
        a, b, c = args
        -> result: a
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [[1, 2], 'test'], from: 'caller' },
      reply: { id: '1', ex: { test: 'destructure error' }, to: 'caller' },
    });
  });

  it.skip(':a, :b, :c = args — missing named key is a runtime error', async () => {
    const source = `
      on test(...args)
        :a, :b, :c = args
        -> result: a
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{ a: 1, b: 2 }, 'test'], from: 'caller' },
      reply: { id: '1', ex: { test: 'destructure error' }, to: 'caller' },
    });
  });
});

describe('Structure accessors', () => {
  it('args[0] reads first positional element', async () => {
    const source = `
      on test(...args)
        x = args[0]
        -> result: x
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [[42, 99], 'test'], 'bv-a': [['Integer', 'Integer']], from: 'caller' },
      reply: { id: '1', re: { result: 42 }, to: 'caller' },
    });
  });

  it('args[1] reads second positional element', async () => {
    const source = `
      on test(...args)
        x = args[1]
        -> result: x
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [[10, 20], 'test'], 'bv-a': [['Integer', 'Integer']], from: 'caller' },
      reply: { id: '1', re: { result: 20 }, to: 'caller' },
    });
  });

  it('args["a"] reads named field by key', async () => {
    const source = `
      on test(...args)
        x = args["a"]
        -> result: x
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{ a: 'hello' }, 'test'], 'bv-a': [{ a: 'Text' }], from: 'caller' },
      reply: { id: '1', re: { result: 'hello' }, to: 'caller' },
    });
  });
});

describe('Structure constructor', () => {
  it('a = Structure(v : Type) assigns the unwrapped value', async () => {
    const source = `
      on test(...args)
        a : Integer = Structure(42 : Integer)
        -> result: a
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{}, 'test'], from: 'caller' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 42 }, to: 'caller' },
    });
  });

  it('s : Structure = Structure(fn: f : Callable) preserves callable closure through extraction', async () => {
    const source = `
      on test(...args)
        x : Integer = 10
        f = { x }
        s : Structure = Structure(fn: f : Callable)
        :fn = s
        result : Integer = fn()
        -> result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{}, 'test'], from: 'caller' },
      reply: { id: '1', 'bv-a': ['Integer'], re: [10], to: 'caller' },
    });
  });

  it('Structure-stored callable observes live outer binding updates', async () => {
    const source = `
      on test()
        x : Integer = 10
        :fn = Structure(fn: { x } : Callable)
        x = 20
        result : Integer = fn()
        -> result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{}, 'test'], from: 'caller' },
      reply: { id: '1', 'bv-a': ['Integer'], re: [10], to: 'caller' },
    });
  });

  it('s : Structure = Structure(a, b) from typed locals carries types through', async () => {
    const source = `
      on test(...args)
        a, b = args
        s : Structure = Structure(a, b)
        ->(...s)
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [[3, 4], 'test'], 'bv-a': [['Integer', 'Integer']], from: 'caller' },
      reply: { id: '1', 'bv-a': ['Integer', 'Integer'], re: [3, 4], to: 'caller' },
    });
  });

  it('s : Structure = Structure(k: v : Type, ...) builds a named structure', async () => {
    const source = `
      on test()
        s : Structure = Structure(a: "alpha" : Text, b: "beta" : Text)
        ->(...s)
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{}, 'test'], from: 'caller' },
      reply: { id: '1', re: { a: 'alpha', b: 'beta' }, to: 'caller' },
    });
  });

  it('s : Structure = Structure(v : Type, k: v : Type) builds a mixed structure', async () => {
    const source = `
      on test()
        s : Structure = Structure(1 : Integer, 2 : Integer, x: "extra" : Text)
        ->(...s)
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{}, 'test'], from: 'caller' },
      reply: { id: '1', re: [1, 2, { x: 'extra' }], to: 'caller' },
    });
  });
});
