import { jest } from '@jest/globals';
import compile from '../index.js';
import { evaluate } from './helpers.js';

describe('type matching — named params', () => {
  it('exact named match dispatches', async () => {
    const { output } = compile('on add(:a : Integer, :b : Integer) reply sum: a + b : Integer\n');
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { add: { a: 3, b: 4 } }, 'bv-a': { add: { a: 'Integer', b: 'Integer' } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', 'bv-a': { add: { sum: 'Integer' } }, re: { add: { sum: 7 } }, to: 'caller' });
  });

  it('named type mismatch → unhandled', async () => {
    const { output } = compile('on add(:a : Integer, :b : Integer) reply sum: a + b : Integer\n');
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { add: { a: 'x', b: 'y' } }, 'bv-a': { add: { a: 'Text', b: 'Text' } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', ex: { add: 'unhandled' }, to: 'caller' });
  });

  it('required named param absent from Structure → unhandled', async () => {
    const { output } = compile('on add(:a : Integer, :b : Integer) reply sum: a + b : Integer\n');
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { add: { a: 3 } }, 'bv-a': { add: { a: 'Integer' } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', ex: { add: 'unhandled' }, to: 'caller' });
  });

  it('extra named field in Structure (not declared in handler) → still matches', async () => {
    const { output } = compile('on add(:a : Integer, :b : Integer) reply sum: a + b : Integer\n');
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { add: { a: 3, b: 4, c: 99 } }, 'bv-a': { add: { a: 'Integer', b: 'Integer', c: 'Integer' } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', 'bv-a': { add: { sum: 'Integer' } }, re: { add: { sum: 7 } }, to: 'caller' });
  });

  it('missing bv-a with typed named params → schema_required', async () => {
    const { output } = compile('on add(:a : Integer, :b : Integer) reply sum: a + b : Integer\n');
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { add: { a: 3, b: 4 } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', ex: { add: 'schema_required' }, to: 'caller' });
  });
});

describe('type matching — positional params', () => {
  it('exact positional match dispatches', async () => {
    const { output } = compile('on mult(a : Integer, b : Integer) reply product: a * b : Integer\n');
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { mult: [3, 5] }, 'bv-a': { mult: ['Integer', 'Integer'] }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', 'bv-a': { mult: { product: 'Integer' } }, re: { mult: { product: 15 } }, to: 'caller' });
  });

  it('positional type mismatch → unhandled', async () => {
    const { output } = compile('on mult(a : Integer, b : Integer) reply product: a * b : Integer\n');
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { mult: ['a', 'b'] }, 'bv-a': { mult: ['Text', 'Text'] }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', ex: { mult: 'unhandled' }, to: 'caller' });
  });

  it('too few positionals → unhandled', async () => {
    const { output } = compile('on mult(a : Integer, b : Integer) reply product: a * b : Integer\n');
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { mult: [3] }, 'bv-a': { mult: ['Integer'] }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', ex: { mult: 'unhandled' }, to: 'caller' });
  });

  it('too many positionals → unhandled', async () => {
    const { output } = compile('on mult(a : Integer, b : Integer) reply product: a * b : Integer\n');
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { mult: [3, 5, 7] }, 'bv-a': { mult: ['Integer', 'Integer', 'Integer'] }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', ex: { mult: 'unhandled' }, to: 'caller' });
  });
});

describe('type matching — mixed params', () => {
  it('mixed positional + named match dispatches', async () => {
    const source = 'on mash(a : Integer, b : Integer, :label : Text) reply result: a + b : Integer\n';
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { mash: [3, 4, { label: 'hi' }] }, 'bv-a': { mash: ['Integer', 'Integer', { label: 'Text' }] }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', 'bv-a': { mash: { result: 'Integer' } }, re: { mash: { result: 7 } }, to: 'caller' });
  });

  it('mixed — positional type mismatch → unhandled', async () => {
    const source = 'on mash(a : Integer, b : Integer, :label : Text) reply result: a + b : Integer\n';
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { mash: ['x', 'y', { label: 'hi' }] }, 'bv-a': { mash: ['Text', 'Text', { label: 'Text' }] }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', ex: { mash: 'unhandled' }, to: 'caller' });
  });

  it('mixed — named type mismatch → unhandled', async () => {
    const source = 'on mash(a : Integer, b : Integer, :label : Text) reply result: a + b : Integer\n';
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { mash: [3, 4, { label: 42 }] }, 'bv-a': { mash: ['Integer', 'Integer', { label: 'Integer' }] }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', ex: { mash: 'unhandled' }, to: 'caller' });
  });
});

describe('type matching — ...args (universal matcher)', () => {
  it('...args matches named payload with bv-a', async () => {
    const { output } = compile('on import(...args) reply(...args)\n');
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { import: { x: 1 } }, 'bv-a': { import: { x: 'Integer' } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', 'bv-a': { import: { x: 'Integer' } }, re: { import: { x: 1 } }, to: 'caller' });
  });

  it('...args without bv-a returns schema_required when payload is non-empty', async () => {
    const { output } = compile('on import(...args) reply(...args)\n');
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { import: { x: 1 } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', ex: { import: 'schema_required' }, to: 'caller' });
  });
});

describe('type matching — overloading (same op, different types)', () => {
  it('first handler matches Integer, second matches Text — Integer message routes to first', async () => {
    const source = `
      on greet(:name : Integer) reply msg: "number" : Text
      on greet(:name : Text) reply msg: "text" : Text
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const b = { post: jest.fn() };
    new Actor(b).receive({ id: '1', op: { greet: { name: 42 } }, 'bv-a': { greet: { name: 'Integer' } }, from: 'caller' });
    expect(b.post).toHaveBeenCalledWith({ id: '1', 'bv-a': { greet: { msg: 'Text' } }, re: { greet: { msg: 'number' } }, to: 'caller' });
  });

  it('first handler matches Integer, second matches Text — Text message routes to second', async () => {
    const source = `
      on greet(:name : Integer) reply msg: "number" : Text
      on greet(:name : Text) reply msg: "text" : Text
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const b = { post: jest.fn() };
    new Actor(b).receive({ id: '2', op: { greet: { name: 'Alice' } }, 'bv-a': { greet: { name: 'Text' } }, from: 'caller' });
    expect(b.post).toHaveBeenCalledWith({ id: '2', 'bv-a': { greet: { msg: 'Text' } }, re: { greet: { msg: 'text' } }, to: 'caller' });
  });

  it('both handlers mismatch → unhandled', async () => {
    const source = `
      on greet(:name : Integer) reply msg: "number" : Text
      on greet(:name : Text) reply msg: "text" : Text
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '3', op: { greet: { name: true } }, 'bv-a': { greet: { name: 'Boolean' } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '3', ex: { greet: 'unhandled' }, to: 'caller' });
  });
});

describe('type matching — key-mapped (longhand) named params', () => {
  it('exact key-mapped match dispatches', async () => {
    const { output } = compile('on letters(a: alpha : Text, b: beta : Integer) reply result: alpha\n');
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { letters: { a: 'hello', b: 42 } }, 'bv-a': { letters: { a: 'Text', b: 'Integer' } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', 'bv-a': { letters: { result: 'Text' } }, re: { letters: { result: 'hello' } }, to: 'caller' });
  });

  it('key-mapped type mismatch → unhandled', async () => {
    const { output } = compile('on letters(a: alpha : Text, b: beta : Integer) reply result: alpha\n');
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { letters: { a: 'hello', b: 'nope' } }, 'bv-a': { letters: { a: 'Text', b: 'Text' } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', ex: { letters: 'unhandled' }, to: 'caller' });
  });

  it('key-mapped — missing structure key → unhandled', async () => {
    const { output } = compile('on letters(a: alpha : Text, b: beta : Integer) reply result: alpha\n');
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { letters: { a: 'hello' } }, 'bv-a': { letters: { a: 'Text' } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', ex: { letters: 'unhandled' }, to: 'caller' });
  });

  it('key-mapped + positional match dispatches', async () => {
    const { output } = compile('on mash(x : Integer, a: alpha : Text) reply result: x\n');
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { mash: [7, { a: 'hi' }] }, 'bv-a': { mash: ['Integer', { a: 'Text' }] }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', 'bv-a': { mash: { result: 'Integer' } }, re: { mash: { result: 7 } }, to: 'caller' });
  });

  it('key-mapped + positional — positional type mismatch → unhandled', async () => {
    const { output } = compile('on mash(x : Integer, a: alpha : Text) reply result: x\n');
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { mash: ['nope', { a: 'hi' }] }, 'bv-a': { mash: ['Text', { a: 'Text' }] }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', ex: { mash: 'unhandled' }, to: 'caller' });
  });

  it('key-mapped + sigil shorthand match dispatches', async () => {
    const { output } = compile('on letters(a: alpha : Text, :c : Integer) reply result: alpha\n');
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { letters: { a: 'hi', c: 5 } }, 'bv-a': { letters: { a: 'Text', c: 'Integer' } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', 'bv-a': { letters: { result: 'Text' } }, re: { letters: { result: 'hi' } }, to: 'caller' });
  });

  it('key-mapped + sigil shorthand — sigil type mismatch → unhandled', async () => {
    const { output } = compile('on letters(a: alpha : Text, :c : Integer) reply result: alpha\n');
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { letters: { a: 'hi', c: 'nope' } }, 'bv-a': { letters: { a: 'Text', c: 'Text' } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', ex: { letters: 'unhandled' }, to: 'caller' });
  });
});

describe('untyped param compile error', () => {
  it('sigil param without type annotation throws', () => {
    expect(() => compile('on add(:a, :b : Integer) reply sum: a + b : Integer\n')).toThrow(
      /requires a type annotation/
    );
  });
});
