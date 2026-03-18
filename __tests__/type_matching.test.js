import compile from '../index.js';
import { expectReply } from './helpers.js';

describe('type matching — named params', () => {
  it('exact named match dispatches', async () => {
    const source = '@add = |:a : Integer, :b : Integer| -> sum: a + b : Integer\n';
    await expectReply({
      source,
      receive: { id: '1', op: [{ a: 3, b: 4 }, 'add'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'caller' },
      reply: { id: '1', 'bv-a': { sum: 'Integer' }, re: { sum: 7 }, to: 'caller' },
    });
  });

  it('named type mismatch → unhandled', async () => {
    const source = '@add = |:a : Integer, :b : Integer| -> sum: a + b : Integer\n';
    await expectReply({
      source,
      receive: { id: '1', op: [{ a: 'x', b: 'y' }, 'add'], 'bv-a': [{ a: 'Text', b: 'Text' }], from: 'caller' },
      reply: { id: '1', ex: { add: 'unhandled' }, to: 'caller' },
    });
  });

  it('required named param absent from Structure → unhandled', async () => {
    const source = '@add = |:a : Integer, :b : Integer| -> sum: a + b : Integer\n';
    await expectReply({
      source,
      receive: { id: '1', op: [{ a: 3 }, 'add'], 'bv-a': [{ a: 'Integer' }], from: 'caller' },
      reply: { id: '1', ex: { add: 'unhandled' }, to: 'caller' },
    });
  });

  it('extra named field in Structure (not declared in handler) → still matches', async () => {
    const source = '@add = |:a : Integer, :b : Integer| -> sum: a + b : Integer\n';
    await expectReply({
      source,
      receive: { id: '1', op: [{ a: 3, b: 4, c: 99 }, 'add'], 'bv-a': [{ a: 'Integer', b: 'Integer', c: 'Integer' }], from: 'caller' },
      reply: { id: '1', 'bv-a': { sum: 'Integer' }, re: { sum: 7 }, to: 'caller' },
    });
  });

  it('missing bv-a with typed named params → schema_required', async () => {
    const source = '@add = |:a : Integer, :b : Integer| -> sum: a + b : Integer\n';
    await expectReply({
      source,
      receive: { id: '1', op: [{ a: 3, b: 4 }, 'add'], from: 'caller' },
      reply: { id: '1', ex: { add: 'schema_required' }, to: 'caller' },
    });
  });
});

describe('type matching — positional params', () => {
  it('exact positional match dispatches', async () => {
    const source = '@mult = |a : Integer, b : Integer| -> product: a * b : Integer\n';
    await expectReply({
      source,
      receive: { id: '1', op: [[3, 5], 'mult'], 'bv-a': [['Integer', 'Integer']], from: 'caller' },
      reply: { id: '1', 'bv-a': { product: 'Integer' }, re: { product: 15 }, to: 'caller' },
    });
  });

  it('positional type mismatch → unhandled', async () => {
    const source = '@mult = |a : Integer, b : Integer| -> product: a * b : Integer\n';
    await expectReply({
      source,
      receive: { id: '1', op: [['a', 'b'], 'mult'], 'bv-a': [['Text', 'Text']], from: 'caller' },
      reply: { id: '1', ex: { mult: 'unhandled' }, to: 'caller' },
    });
  });

  it('too few positionals → unhandled', async () => {
    const source = '@mult = |a : Integer, b : Integer| -> product: a * b : Integer\n';
    await expectReply({
      source,
      receive: { id: '1', op: [[3], 'mult'], 'bv-a': [['Integer']], from: 'caller' },
      reply: { id: '1', ex: { mult: 'unhandled' }, to: 'caller' },
    });
  });

  it('too many positionals → unhandled', async () => {
    const source = '@mult = |a : Integer, b : Integer| -> product: a * b : Integer\n';
    await expectReply({
      source,
      receive: { id: '1', op: [[3, 5, 7], 'mult'], 'bv-a': [['Integer', 'Integer', 'Integer']], from: 'caller' },
      reply: { id: '1', ex: { mult: 'unhandled' }, to: 'caller' },
    });
  });
});

describe('type matching — mixed params', () => {
  it('mixed positional + named match dispatches', async () => {
    const source = '@mash = |a : Integer, b : Integer, :label : Text| -> result: a + b : Integer\n';
    await expectReply({
      source,
      receive: { id: '1', op: [[3, 4, { label: 'hi' }], 'mash'], 'bv-a': [['Integer', 'Integer', { label: 'Text' }]], from: 'caller' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'caller' },
    });
  });

  it('mixed — positional type mismatch → unhandled', async () => {
    const source = '@mash = |a : Integer, b : Integer, :label : Text| -> result: a + b : Integer\n';
    await expectReply({
      source,
      receive: { id: '1', op: [['x', 'y', { label: 'hi' }], 'mash'], 'bv-a': [['Text', 'Text', { label: 'Text' }]], from: 'caller' },
      reply: { id: '1', ex: { mash: 'unhandled' }, to: 'caller' },
    });
  });

  it('mixed — named type mismatch → unhandled', async () => {
    const source = '@mash = |a : Integer, b : Integer, :label : Text| -> result: a + b : Integer\n';
    await expectReply({
      source,
      receive: { id: '1', op: [[3, 4, { label: 42 }], 'mash'], 'bv-a': [['Integer', 'Integer', { label: 'Integer' }]], from: 'caller' },
      reply: { id: '1', ex: { mash: 'unhandled' }, to: 'caller' },
    });
  });
});

describe('type matching — ...args (universal matcher)', () => {
  it('...args matches named payload with bv-a', async () => {
    const source = '@import = |...args| ->(...args)\n';
    await expectReply({
      source,
      receive: { id: '1', op: [{ x: 1 }, 'import'], 'bv-a': [{ x: 'Integer' }], from: 'caller' },
      reply: { id: '1', 'bv-a': { x: 'Integer' }, re: { x: 1 }, to: 'caller' },
    });
  });

  it('...args without bv-a returns schema_required when payload is non-empty', async () => {
    const source = '@import = |...args| ->(...args)\n';
    await expectReply({
      source,
      receive: { id: '1', op: [{ x: 1 }, 'import'], from: 'caller' },
      reply: { id: '1', ex: { import: 'schema_required' }, to: 'caller' },
    });
  });
});

describe('type matching — overloading (same op, different types)', () => {
  it('first handler matches Integer, second matches Text — Integer message routes to first', async () => {
    const source = `
      @greet = |:name : Integer| -> msg: "number" : Text
      @greet = |:name : Text| -> msg: "text" : Text
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{ name: 42 }, 'greet'], 'bv-a': [{ name: 'Integer' }], from: 'caller' },
      reply: { id: '1', 'bv-a': { msg: 'Text' }, re: { msg: 'number' }, to: 'caller' },
    });
  });

  it('first handler matches Integer, second matches Text — Text message routes to second', async () => {
    const source = `
      @greet = |:name : Integer| -> msg: "number" : Text
      @greet = |:name : Text| -> msg: "text" : Text
    `;
    await expectReply({
      source,
      receive: { id: '2', op: [{ name: 'Alice' }, 'greet'], 'bv-a': [{ name: 'Text' }], from: 'caller' },
      reply: { id: '2', 'bv-a': { msg: 'Text' }, re: { msg: 'text' }, to: 'caller' },
    });
  });

  it('both handlers mismatch → unhandled', async () => {
    const source = `
      @greet = |:name : Integer| -> msg: "number" : Text
      @greet = |:name : Text| -> msg: "text" : Text
    `;
    await expectReply({
      source,
      receive: { id: '3', op: [{ name: true }, 'greet'], 'bv-a': [{ name: 'Boolean' }], from: 'caller' },
      reply: { id: '3', ex: { greet: 'unhandled' }, to: 'caller' },
    });
  });
});

describe('type matching — key-mapped (longhand) named params', () => {
  it('exact key-mapped match dispatches', async () => {
    const source = '@letters = |a: alpha : Text, b: beta : Integer| -> result: alpha\n';
    await expectReply({
      source,
      receive: { id: '1', op: [{ a: 'hello', b: 42 }, 'letters'], 'bv-a': [{ a: 'Text', b: 'Integer' }], from: 'caller' },
      reply: { id: '1', 'bv-a': { result: 'Text' }, re: { result: 'hello' }, to: 'caller' },
    });
  });

  it('key-mapped type mismatch → unhandled', async () => {
    const source = '@letters = |a: alpha : Text, b: beta : Integer| -> result: alpha\n';
    await expectReply({
      source,
      receive: { id: '1', op: [{ a: 'hello', b: 'nope' }, 'letters'], 'bv-a': [{ a: 'Text', b: 'Text' }], from: 'caller' },
      reply: { id: '1', ex: { letters: 'unhandled' }, to: 'caller' },
    });
  });

  it('key-mapped — missing structure key → unhandled', async () => {
    const source = '@letters = |a: alpha : Text, b: beta : Integer| -> result: alpha\n';
    await expectReply({
      source,
      receive: { id: '1', op: [{ a: 'hello' }, 'letters'], 'bv-a': [{ a: 'Text' }], from: 'caller' },
      reply: { id: '1', ex: { letters: 'unhandled' }, to: 'caller' },
    });
  });

  it('key-mapped + positional match dispatches', async () => {
    const source = '@mash = |x : Integer, a: alpha : Text| -> result: x\n';
    await expectReply({
      source,
      receive: { id: '1', op: [[7, { a: 'hi' }], 'mash'], 'bv-a': [['Integer', { a: 'Text' }]], from: 'caller' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'caller' },
    });
  });

  it('key-mapped + positional — positional type mismatch → unhandled', async () => {
    const source = '@mash = |x : Integer, a: alpha : Text| -> result: x\n';
    await expectReply({
      source,
      receive: { id: '1', op: [['nope', { a: 'hi' }], 'mash'], 'bv-a': [['Text', { a: 'Text' }]], from: 'caller' },
      reply: { id: '1', ex: { mash: 'unhandled' }, to: 'caller' },
    });
  });

  it('key-mapped + sigil shorthand match dispatches', async () => {
    const source = '@letters = |a: alpha : Text, :c : Integer| -> result: alpha\n';
    await expectReply({
      source,
      receive: { id: '1', op: [{ a: 'hi', c: 5 }, 'letters'], 'bv-a': [{ a: 'Text', c: 'Integer' }], from: 'caller' },
      reply: { id: '1', 'bv-a': { result: 'Text' }, re: { result: 'hi' }, to: 'caller' },
    });
  });

  it('key-mapped + sigil shorthand — sigil type mismatch → unhandled', async () => {
    const source = '@letters = |a: alpha : Text, :c : Integer| -> result: alpha\n';
    await expectReply({
      source,
      receive: { id: '1', op: [{ a: 'hi', c: 'nope' }, 'letters'], 'bv-a': [{ a: 'Text', c: 'Text' }], from: 'caller' },
      reply: { id: '1', ex: { letters: 'unhandled' }, to: 'caller' },
    });
  });
});

describe('untyped param compile error', () => {
  it('sigil param without type annotation throws', () => {
    expect(() => compile('@add = |:a, :b : Integer| -> sum: a + b : Integer\n')).toThrow(
      /requires a type annotation/
    );
  });
});
