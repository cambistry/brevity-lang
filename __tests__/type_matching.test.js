import compile from '../index.js';
import { expectReply } from './helpers.js';

describe('type matching — named params', () => {
  it('exact named match dispatches', async () => {
    const source = 'on add(:a : Integer, :b : Integer) reply sum: a + b : Integer\n';
    await expectReply({
      source,
      receive: { id: '1', op: [{ a: 3, b: 4 }, 'add'], 'bv-a': [{ a: 'Integer', b: 'Integer' }, 'add'], from: 'caller' },
      reply: { id: '1', 'bv-a': [{ sum: 'Integer' }, 'add'], re: [{ sum: 7 }, 'add'], to: 'caller' },
    });
  });

  it('named type mismatch → unhandled', async () => {
    const source = 'on add(:a : Integer, :b : Integer) reply sum: a + b : Integer\n';
    await expectReply({
      source,
      receive: { id: '1', op: [{ a: 'x', b: 'y' }, 'add'], 'bv-a': [{ a: 'Text', b: 'Text' }, 'add'], from: 'caller' },
      reply: { id: '1', ex: { add: 'unhandled' }, to: 'caller' },
    });
  });

  it('required named param absent from Structure → unhandled', async () => {
    const source = 'on add(:a : Integer, :b : Integer) reply sum: a + b : Integer\n';
    await expectReply({
      source,
      receive: { id: '1', op: [{ a: 3 }, 'add'], 'bv-a': [{ a: 'Integer' }, 'add'], from: 'caller' },
      reply: { id: '1', ex: { add: 'unhandled' }, to: 'caller' },
    });
  });

  it('extra named field in Structure (not declared in handler) → still matches', async () => {
    const source = 'on add(:a : Integer, :b : Integer) reply sum: a + b : Integer\n';
    await expectReply({
      source,
      receive: { id: '1', op: [{ a: 3, b: 4, c: 99 }, 'add'], 'bv-a': [{ a: 'Integer', b: 'Integer', c: 'Integer' }, 'add'], from: 'caller' },
      reply: { id: '1', 'bv-a': [{ sum: 'Integer' }, 'add'], re: [{ sum: 7 }, 'add'], to: 'caller' },
    });
  });

  it('missing bv-a with typed named params → schema_required', async () => {
    const source = 'on add(:a : Integer, :b : Integer) reply sum: a + b : Integer\n';
    await expectReply({
      source,
      receive: { id: '1', op: [{ a: 3, b: 4 }, 'add'], from: 'caller' },
      reply: { id: '1', ex: { add: 'schema_required' }, to: 'caller' },
    });
  });
});

describe('type matching — positional params', () => {
  it('exact positional match dispatches', async () => {
    const source = 'on mult(a : Integer, b : Integer) reply product: a * b : Integer\n';
    await expectReply({
      source,
      receive: { id: '1', op: [[3, 5], 'mult'], 'bv-a': [['Integer', 'Integer'], 'mult'], from: 'caller' },
      reply: { id: '1', 'bv-a': [{ product: 'Integer' }, 'mult'], re: [{ product: 15 }, 'mult'], to: 'caller' },
    });
  });

  it('positional type mismatch → unhandled', async () => {
    const source = 'on mult(a : Integer, b : Integer) reply product: a * b : Integer\n';
    await expectReply({
      source,
      receive: { id: '1', op: [['a', 'b'], 'mult'], 'bv-a': [['Text', 'Text'], 'mult'], from: 'caller' },
      reply: { id: '1', ex: { mult: 'unhandled' }, to: 'caller' },
    });
  });

  it('too few positionals → unhandled', async () => {
    const source = 'on mult(a : Integer, b : Integer) reply product: a * b : Integer\n';
    await expectReply({
      source,
      receive: { id: '1', op: [[3], 'mult'], 'bv-a': [['Integer'], 'mult'], from: 'caller' },
      reply: { id: '1', ex: { mult: 'unhandled' }, to: 'caller' },
    });
  });

  it('too many positionals → unhandled', async () => {
    const source = 'on mult(a : Integer, b : Integer) reply product: a * b : Integer\n';
    await expectReply({
      source,
      receive: { id: '1', op: [[3, 5, 7], 'mult'], 'bv-a': [['Integer', 'Integer', 'Integer'], 'mult'], from: 'caller' },
      reply: { id: '1', ex: { mult: 'unhandled' }, to: 'caller' },
    });
  });
});

describe('type matching — mixed params', () => {
  it('mixed positional + named match dispatches', async () => {
    const source = 'on mash(a : Integer, b : Integer, :label : Text) reply result: a + b : Integer\n';
    await expectReply({
      source,
      receive: { id: '1', op: [[3, 4, { label: 'hi' }], 'mash'], 'bv-a': [['Integer', 'Integer', { label: 'Text' }], 'mash'], from: 'caller' },
      reply: { id: '1', 'bv-a': [{ result: 'Integer' }, 'mash'], re: [{ result: 7 }, 'mash'], to: 'caller' },
    });
  });

  it('mixed — positional type mismatch → unhandled', async () => {
    const source = 'on mash(a : Integer, b : Integer, :label : Text) reply result: a + b : Integer\n';
    await expectReply({
      source,
      receive: { id: '1', op: [['x', 'y', { label: 'hi' }], 'mash'], 'bv-a': [['Text', 'Text', { label: 'Text' }], 'mash'], from: 'caller' },
      reply: { id: '1', ex: { mash: 'unhandled' }, to: 'caller' },
    });
  });

  it('mixed — named type mismatch → unhandled', async () => {
    const source = 'on mash(a : Integer, b : Integer, :label : Text) reply result: a + b : Integer\n';
    await expectReply({
      source,
      receive: { id: '1', op: [[3, 4, { label: 42 }], 'mash'], 'bv-a': [['Integer', 'Integer', { label: 'Integer' }], 'mash'], from: 'caller' },
      reply: { id: '1', ex: { mash: 'unhandled' }, to: 'caller' },
    });
  });
});

describe('type matching — ...args (universal matcher)', () => {
  it('...args matches named payload with bv-a', async () => {
    const source = 'on import(...args) reply(...args)\n';
    await expectReply({
      source,
      receive: { id: '1', op: [{ x: 1 }, 'import'], 'bv-a': [{ x: 'Integer' }, 'import'], from: 'caller' },
      reply: { id: '1', 'bv-a': [{ x: 'Integer' }, 'import'], re: [{ x: 1 }, 'import'], to: 'caller' },
    });
  });

  it('...args without bv-a returns schema_required when payload is non-empty', async () => {
    const source = 'on import(...args) reply(...args)\n';
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
      on greet(:name : Integer) reply msg: "number" : Text
      on greet(:name : Text) reply msg: "text" : Text
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{ name: 42 }, 'greet'], 'bv-a': [{ name: 'Integer' }, 'greet'], from: 'caller' },
      reply: { id: '1', 'bv-a': [{ msg: 'Text' }, 'greet'], re: [{ msg: 'number' }, 'greet'], to: 'caller' },
    });
  });

  it('first handler matches Integer, second matches Text — Text message routes to second', async () => {
    const source = `
      on greet(:name : Integer) reply msg: "number" : Text
      on greet(:name : Text) reply msg: "text" : Text
    `;
    await expectReply({
      source,
      receive: { id: '2', op: [{ name: 'Alice' }, 'greet'], 'bv-a': [{ name: 'Text' }, 'greet'], from: 'caller' },
      reply: { id: '2', 'bv-a': [{ msg: 'Text' }, 'greet'], re: [{ msg: 'text' }, 'greet'], to: 'caller' },
    });
  });

  it('both handlers mismatch → unhandled', async () => {
    const source = `
      on greet(:name : Integer) reply msg: "number" : Text
      on greet(:name : Text) reply msg: "text" : Text
    `;
    await expectReply({
      source,
      receive: { id: '3', op: [{ name: true }, 'greet'], 'bv-a': [{ name: 'Boolean' }, 'greet'], from: 'caller' },
      reply: { id: '3', ex: { greet: 'unhandled' }, to: 'caller' },
    });
  });
});

describe('type matching — key-mapped (longhand) named params', () => {
  it('exact key-mapped match dispatches', async () => {
    const source = 'on letters(a: alpha : Text, b: beta : Integer) reply result: alpha\n';
    await expectReply({
      source,
      receive: { id: '1', op: [{ a: 'hello', b: 42 }, 'letters'], 'bv-a': [{ a: 'Text', b: 'Integer' }, 'letters'], from: 'caller' },
      reply: { id: '1', 'bv-a': [{ result: 'Text' }, 'letters'], re: [{ result: 'hello' }, 'letters'], to: 'caller' },
    });
  });

  it('key-mapped type mismatch → unhandled', async () => {
    const source = 'on letters(a: alpha : Text, b: beta : Integer) reply result: alpha\n';
    await expectReply({
      source,
      receive: { id: '1', op: [{ a: 'hello', b: 'nope' }, 'letters'], 'bv-a': [{ a: 'Text', b: 'Text' }, 'letters'], from: 'caller' },
      reply: { id: '1', ex: { letters: 'unhandled' }, to: 'caller' },
    });
  });

  it('key-mapped — missing structure key → unhandled', async () => {
    const source = 'on letters(a: alpha : Text, b: beta : Integer) reply result: alpha\n';
    await expectReply({
      source,
      receive: { id: '1', op: [{ a: 'hello' }, 'letters'], 'bv-a': [{ a: 'Text' }, 'letters'], from: 'caller' },
      reply: { id: '1', ex: { letters: 'unhandled' }, to: 'caller' },
    });
  });

  it('key-mapped + positional match dispatches', async () => {
    const source = 'on mash(x : Integer, a: alpha : Text) reply result: x\n';
    await expectReply({
      source,
      receive: { id: '1', op: [[7, { a: 'hi' }], 'mash'], 'bv-a': [['Integer', { a: 'Text' }], 'mash'], from: 'caller' },
      reply: { id: '1', 'bv-a': [{ result: 'Integer' }, 'mash'], re: [{ result: 7 }, 'mash'], to: 'caller' },
    });
  });

  it('key-mapped + positional — positional type mismatch → unhandled', async () => {
    const source = 'on mash(x : Integer, a: alpha : Text) reply result: x\n';
    await expectReply({
      source,
      receive: { id: '1', op: [['nope', { a: 'hi' }], 'mash'], 'bv-a': [['Text', { a: 'Text' }], 'mash'], from: 'caller' },
      reply: { id: '1', ex: { mash: 'unhandled' }, to: 'caller' },
    });
  });

  it('key-mapped + sigil shorthand match dispatches', async () => {
    const source = 'on letters(a: alpha : Text, :c : Integer) reply result: alpha\n';
    await expectReply({
      source,
      receive: { id: '1', op: [{ a: 'hi', c: 5 }, 'letters'], 'bv-a': [{ a: 'Text', c: 'Integer' }, 'letters'], from: 'caller' },
      reply: { id: '1', 'bv-a': [{ result: 'Text' }, 'letters'], re: [{ result: 'hi' }, 'letters'], to: 'caller' },
    });
  });

  it('key-mapped + sigil shorthand — sigil type mismatch → unhandled', async () => {
    const source = 'on letters(a: alpha : Text, :c : Integer) reply result: alpha\n';
    await expectReply({
      source,
      receive: { id: '1', op: [{ a: 'hi', c: 'nope' }, 'letters'], 'bv-a': [{ a: 'Text', c: 'Text' }, 'letters'], from: 'caller' },
      reply: { id: '1', ex: { letters: 'unhandled' }, to: 'caller' },
    });
  });
});

describe('untyped param compile error', () => {
  it('sigil param without type annotation throws', () => {
    expect(() => compile('on add(:a, :b : Integer) reply sum: a + b : Integer\n')).toThrow(
      /requires a type annotation/
    );
  });
});
