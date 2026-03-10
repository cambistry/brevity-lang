import { jest } from '@jest/globals';
import compile from '../index.js';
import { evaluate } from './helpers.js';

// ...args binds the entire op payload as a Structure:
//   { positional: [...], named: {...}, positional_types: null, named_types: null }
// reply(...args) splats the Structure back to wire format.
// Pack+splat is identity for the standard payload shapes tested here.

describe('...args rest binding', () => {
  it('named payload passes through — pack/splat roundtrip', async () => {
    const { output } = compile('on import(...args) reply(...args)\n');
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { import: { a: 1, b: 2 } }, 'bv-a': { import: { a: 'Integer', b: 'Integer' } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({
      id: '1', 'bv-a': { import: { a: 'Integer', b: 'Integer' } }, re: { import: { a: 1, b: 2 } }, to: 'caller',
    });
  });

  it('positional payload passes through — pack/splat roundtrip', async () => {
    const { output } = compile('on import(...args) reply(...args)\n');
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { import: [1, 2] }, 'bv-a': { import: ['Integer', 'Integer'] }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({
      id: '1', 'bv-a': { import: ['Integer', 'Integer'] }, re: { import: [1, 2] }, to: 'caller',
    });
  });

  it('mixed payload passes through — pack/splat roundtrip', async () => {
    const { output } = compile('on import(...args) reply(...args)\n');
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { import: [1, 2, { c: 3 }] }, 'bv-a': { import: ['Integer', 'Integer', { c: 'Integer' }] }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({
      id: '1', 'bv-a': { import: ['Integer', 'Integer', { c: 'Integer' }] }, re: { import: [1, 2, { c: 3 }] }, to: 'caller',
    });
  });

  it('explicit : Structure type annotation is accepted', async () => {
    const { output } = compile('on import(...args : Structure) reply(...args : Structure)\n');
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { import: { x: 42 } }, 'bv-a': { import: { x: 'Integer' } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({
      id: '1', 'bv-a': { import: { x: 'Integer' } }, re: { import: { x: 42 } }, to: 'caller',
    });
  });

  it('open form with ...args : Structure and stitch separator', async () => {
    const source = `
      on import
        ...args : Structure
      --
        reply
          ...args : Structure
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { import: { a: 1, b: 2 } }, 'bv-a': { import: { a: 'Integer', b: 'Integer' } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({
      id: '1', 'bv-a': { import: { a: 'Integer', b: 'Integer' } }, re: { import: { a: 1, b: 2 } }, to: 'caller',
    });
  });
});

describe('Structure destructuring — named', () => {
  it(':a, :b = args extracts named fields', async () => {
    const source = `
      on test(...args)
        :a, :b = args
        reply result: a
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { test: { a: 10, b: 20 } }, 'bv-a': { test: { a: 'Integer', b: 'Integer' } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { test: { result: 10 } }, to: 'caller' });
  });

  it(':a = args extracts single named field when structure has more keys', async () => {
    const source = `
      on test(...args)
        :a = args
        reply result: a
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { test: { a: 99, b: 2, c: 3 } }, 'bv-a': { test: { a: 'Integer', b: 'Integer', c: 'Integer' } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { test: { result: 99 } }, to: 'caller' });
  });

  it('(:a, :b) = args — paren form', async () => {
    const source = `
      on test(...args)
        (:a, :b) = args
        reply result: a
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { test: { a: 7, b: 8 } }, 'bv-a': { test: { a: 'Integer', b: 'Integer' } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { test: { result: 7 } }, to: 'caller' });
  });
});

describe('Structure destructuring — positional', () => {
  it('a, b = args extracts positional fields', async () => {
    const source = `
      on test(...args)
        a, b = args
        reply result: a
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { test: [3, 4] }, 'bv-a': { test: ['Integer', 'Integer'] }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { test: { result: 3 } }, to: 'caller' });
  });

  it('a = args[0] extracts first positional element', async () => {
    const source = `
      on test(...args)
        a = args[0]
        reply result: a
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { test: [42, 99, 1] }, 'bv-a': { test: ['Integer', 'Integer', 'Integer'] }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { test: { result: 42 } }, to: 'caller' });
  });

  it('(a, b) = args — paren form', async () => {
    const source = `
      on test(...args)
        (a, b) = args
        reply result: a
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { test: [5, 6] }, 'bv-a': { test: ['Integer', 'Integer'] }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { test: { result: 5 } }, to: 'caller' });
  });

  it('(a,) = args — paren trailing-comma form', async () => {
    const source = `
      on test(...args)
        (a,) = args
        reply result: a
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { test: [11, 22] }, 'bv-a': { test: ['Integer', 'Integer'] }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { test: { result: 11 } }, to: 'caller' });
  });
});

describe('Structure destructuring — mixed', () => {
  it('a, b, :c = args extracts positional and named', async () => {
    const source = `
      on test(...args)
        a, b, :c = args
        reply result: a
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { test: [1, 2, { c: 3 }] }, 'bv-a': { test: ['Integer', 'Integer', { c: 'Integer' }] }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { test: { result: 1 } }, to: 'caller' });
  });

  it('(a, b, :c) = args — paren form, uses named field', async () => {
    const source = `
      on test(...args)
        (a, b, :c) = args
        reply result: c
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { test: [1, 2, { c: 99 }] }, 'bv-a': { test: ['Integer', 'Integer', { c: 'Integer' }] }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { test: { result: 99 } }, to: 'caller' });
  });
});

describe('Structure destructuring — key-mapped', () => {
  it('a: x = args binds key a to local x', async () => {
    const source = `
      on test(...args)
        a: x = args
        reply result: x
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { test: { a: 55 } }, 'bv-a': { test: { a: 'Integer' } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { test: { result: 55 } }, to: 'caller' });
  });

  it('(a: x) = args — paren form', async () => {
    const source = `
      on test(...args)
        (a: x) = args
        reply result: x
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { test: { a: 77 } }, 'bv-a': { test: { a: 'Integer' } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { test: { result: 77 } }, to: 'caller' });
  });
});

describe('Structure destructuring — runtime errors (deferred)', () => {
  it.skip('a, b, c = args — too many positionals is a runtime error', async () => {
    const source = `
      on test(...args)
        a, b, c = args
        reply result: a
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { test: [1, 2] }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', ex: { test: 'destructure error' }, to: 'caller' });
  });

  it.skip(':a, :b, :c = args — missing named key is a runtime error', async () => {
    const source = `
      on test(...args)
        :a, :b, :c = args
        reply result: a
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { test: { a: 1, b: 2 } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', ex: { test: 'destructure error' }, to: 'caller' });
  });
});

describe('Structure accessors', () => {
  it('args[0] reads first positional element', async () => {
    const source = `
      on test(...args)
        x = args[0]
        reply result: x
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { test: [42, 99] }, 'bv-a': { test: ['Integer', 'Integer'] }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { test: { result: 42 } }, to: 'caller' });
  });

  it('args[1] reads second positional element', async () => {
    const source = `
      on test(...args)
        x = args[1]
        reply result: x
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { test: [10, 20] }, 'bv-a': { test: ['Integer', 'Integer'] }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { test: { result: 20 } }, to: 'caller' });
  });

  it('args["a"] reads named field by key', async () => {
    const source = `
      on test(...args)
        x = args["a"]
        reply result: x
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { test: { a: 'hello' } }, 'bv-a': { test: { a: 'Text' } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { test: { result: 'hello' } }, to: 'caller' });
  });
});

describe('Structure constructor', () => {
  it('a = Structure(v : Type) assigns the unwrapped value', async () => {
    const source = `
      on test(...args)
        a : Integer = Structure(42 : Integer)
        reply result: a
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { test: {} }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', 'bv-a': { test: { result: 'Integer' } }, re: { test: { result: 42 } }, to: 'caller' });
  });

  it('s : Structure = Structure(fn: f : Callable) preserves callable closure through extraction', async () => {
    const source = `
      on test(...args)
        x : Integer = 10
        f = () { x }
        s : Structure = Structure(fn: f : Callable)
        :fn = s
        result : Integer = fn()
        reply result
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { test: {} }, from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', 'bv-a': { test: ['Integer'] }, re: { test: [10] }, to: 'caller' });
  });

  it('Structure-stored callable observes live outer binding updates', async () => {
    const source = `
      on test()
        x : Integer = 10
        :fn = Structure(fn: () { x } : Callable)
        x = 20
        result : Integer = fn()
        reply result
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { test: {} }, from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', 'bv-a': { test: ['Integer'] }, re: { test: [20] }, to: 'caller' });
  });

  it('s : Structure = Structure(a, b) from typed locals carries types through', async () => {
    const source = `
      on test(...args)
        a, b = args
        s : Structure = Structure(a, b)
        reply(...s)
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { test: [3, 4] }, 'bv-a': { test: ['Integer', 'Integer'] }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', 'bv-a': { test: ['Integer', 'Integer'] }, re: { test: [3, 4] }, to: 'caller' });
  });

  it('s : Structure = Structure(k: v : Type, ...) builds a named structure', async () => {
    const source = `
      on test()
        s : Structure = Structure(a: "alpha" : Text, b: "beta" : Text)
        reply(...s)
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { test: {} }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { test: { a: 'alpha', b: 'beta' } }, to: 'caller' });
  });

  it('s : Structure = Structure(v : Type, k: v : Type) builds a mixed structure', async () => {
    const source = `
      on test()
        s : Structure = Structure(1 : Integer, 2 : Integer, x: "extra" : Text)
        reply(...s)
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { test: {} }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { test: [1, 2, { x: 'extra' }] }, to: 'caller' });
  });
});
