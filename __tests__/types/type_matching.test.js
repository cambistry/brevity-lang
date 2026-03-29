import { expectReply, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Named params
// ═══════════════════════════════════════════════════════════════════════════════

describe('type matching — named params', () => {
  const script = '@add = |a: Integer, b: Integer| -> sum: (a + b) as Integer\n';

  it('exact named match dispatches', async () => {
    await expectReply({
      script, receive: { id: '1', op: [{ a: 3, b: 4 }, '@add'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'c' },
      reply: { id: '1', 'bv-a': { sum: 'Integer' }, re: { sum: 7 }, to: 'c' },
    });
  });

  it('named type mismatch → unhandled', async () => {
    await expectReply({
      script, receive: { id: '2', op: [{ a: 'x', b: 'y' }, '@add'], 'bv-a': [{ a: 'Text', b: 'Text' }], from: 'c' },
      reply: { id: '2', ex: { '@add': 'unhandled' }, to: 'c' },
    });
  });

  it('required named param absent → unhandled', async () => {
    await expectReply({
      script, receive: { id: '3', op: [{ a: 3 }, '@add'], 'bv-a': [{ a: 'Integer' }], from: 'c' },
      reply: { id: '3', ex: { '@add': 'unhandled' }, to: 'c' },
    });
  });

  it('extra named field still matches', async () => {
    await expectReply({
      script, receive: { id: '4', op: [{ a: 3, b: 4, c: 99 }, '@add'], 'bv-a': [{ a: 'Integer', b: 'Integer', c: 'Integer' }], from: 'c' },
      reply: { id: '4', 'bv-a': { sum: 'Integer' }, re: { sum: 7 }, to: 'c' },
    });
  });

  it('missing bv-a → schema_required', async () => {
    await expectReply({
      script, receive: { id: '5', op: [{ a: 3, b: 4 }, '@add'], from: 'c' },
      reply: { id: '5', ex: { '@add': 'schema_required' }, to: 'c' },
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Positional params
// ═══════════════════════════════════════════════════════════════════════════════

describe('type matching — positional params', () => {
  const script = '@mult = |a Integer, b Integer| -> product: (a * b) as Integer\n';

  it('exact positional match dispatches', async () => {
    await expectReply({
      script, receive: { id: '1', op: [[3, 5], '@mult'], 'bv-a': [['Integer', 'Integer']], from: 'c' },
      reply: { id: '1', 'bv-a': { product: 'Integer' }, re: { product: 15 }, to: 'c' },
    });
  });

  it('positional type mismatch → unhandled', async () => {
    await expectReply({
      script, receive: { id: '2', op: [['a', '@b'], '@mult'], 'bv-a': [['Text', 'Text']], from: 'c' },
      reply: { id: '2', ex: { '@mult': 'unhandled' }, to: 'c' },
    });
  });

  it('too few positionals → unhandled', async () => {
    await expectReply({
      script, receive: { id: '3', op: [[3], '@mult'], 'bv-a': [['Integer']], from: 'c' },
      reply: { id: '3', ex: { '@mult': 'unhandled' }, to: 'c' },
    });
  });

  it('too many positionals → unhandled', async () => {
    await expectReply({
      script, receive: { id: '4', op: [[3, 5, 7], '@mult'], 'bv-a': [['Integer', 'Integer', 'Integer']], from: 'c' },
      reply: { id: '4', ex: { '@mult': 'unhandled' }, to: 'c' },
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Mixed params + ...args
// ═══════════════════════════════════════════════════════════════════════════════

describe('type matching — mixed params + ...args', () => {
  const script = `
    @mash = |a Integer, b Integer, label: Text| -> result: (a + b) as Integer
    @import = |...args| ->(...args)
  `;

  it('mixed positional + named match dispatches', async () => {
    await expectReply({
      script, receive: { id: '1', op: [[3, 4, { label: 'hi' }], '@mash'], 'bv-a': [['Integer', 'Integer', { label: 'Text' }]], from: 'c' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'c' },
    });
  });

  it('mixed — positional type mismatch → unhandled', async () => {
    await expectReply({
      script, receive: { id: '2', op: [['x', 'y', { label: 'hi' }], '@mash'], 'bv-a': [['Text', 'Text', { label: 'Text' }]], from: 'c' },
      reply: { id: '2', ex: { '@mash': 'unhandled' }, to: 'c' },
    });
  });

  it('mixed — named type mismatch → unhandled', async () => {
    await expectReply({
      script, receive: { id: '3', op: [[3, 4, { label: 42 }], '@mash'], 'bv-a': [['Integer', 'Integer', { label: 'Integer' }]], from: 'c' },
      reply: { id: '3', ex: { '@mash': 'unhandled' }, to: 'c' },
    });
  });

  it('...args matches named payload with bv-a', async () => {
    await expectReply({
      script, receive: { id: '4', op: [{ x: 1 }, '@import'], 'bv-a': [{ x: 'Integer' }], from: 'c' },
      reply: { id: '4', 'bv-a': { x: 'Integer' }, re: { x: 1 }, to: 'c' },
    });
  });

  it('...args without bv-a → schema_required', async () => {
    await expectReply({
      script, receive: { id: '5', op: [{ x: 1 }, '@import'], from: 'c' },
      reply: { id: '5', ex: { '@import': 'schema_required' }, to: 'c' },
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Overloading (same op, different types)
// ═══════════════════════════════════════════════════════════════════════════════

describe('type matching — overloading', () => {
  const script = `
    @greet = |name: Integer| -> msg: "number" as Text
    @greet = |name: Text| -> msg: "text" as Text
  `;

  it('Integer message routes to first overload', async () => {
    await expectReply({
      script, receive: { id: '1', op: [{ name: 42 }, '@greet'], 'bv-a': [{ name: 'Integer' }], from: 'c' },
      reply: { id: '1', 'bv-a': { msg: 'Text' }, re: { msg: 'number' }, to: 'c' },
    });
  });

  it('Text message routes to second overload', async () => {
    await expectReply({
      script, receive: { id: '2', op: [{ name: 'Alice' }, '@greet'], 'bv-a': [{ name: 'Text' }], from: 'c' },
      reply: { id: '2', 'bv-a': { msg: 'Text' }, re: { msg: 'text' }, to: 'c' },
    });
  });

  it('Boolean message → unhandled (no matching overload)', async () => {
    await expectReply({
      script, receive: { id: '3', op: [{ name: true }, '@greet'], 'bv-a': [{ name: 'Boolean' }], from: 'c' },
      reply: { id: '3', ex: { '@greet': 'unhandled' }, to: 'c' },
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Key-mapped (longhand) named params
// ═══════════════════════════════════════════════════════════════════════════════

describe('type matching — key-mapped params', () => {
  const script = `
    @lettersTwo = |a: (alpha) Text, b: (beta) Integer| -> result: alpha
    @mashKeyed = |x Integer, a: (alpha) Text| -> result: x
    @lettersSigil = |a: (alpha) Text, c: Integer| -> result: alpha
  `;

  it('exact key-mapped match dispatches', async () => {
    await expectReply({
      script, receive: { id: '1', op: [{ a: 'hello', b: 42 }, '@lettersTwo'], 'bv-a': [{ a: 'Text', b: 'Integer' }], from: 'c' },
      reply: { id: '1', 'bv-a': { result: 'Text' }, re: { result: 'hello' }, to: 'c' },
    });
  });

  it('key-mapped type mismatch → unhandled', async () => {
    await expectReply({
      script, receive: { id: '2', op: [{ a: 'hello', b: 'nope' }, '@lettersTwo'], 'bv-a': [{ a: 'Text', b: 'Text' }], from: 'c' },
      reply: { id: '2', ex: { '@lettersTwo': 'unhandled' }, to: 'c' },
    });
  });

  it('key-mapped missing key → unhandled', async () => {
    await expectReply({
      script, receive: { id: '3', op: [{ a: 'hello' }, '@lettersTwo'], 'bv-a': [{ a: 'Text' }], from: 'c' },
      reply: { id: '3', ex: { '@lettersTwo': 'unhandled' }, to: 'c' },
    });
  });

  it('key-mapped + positional match dispatches', async () => {
    await expectReply({
      script, receive: { id: '4', op: [[7, { a: 'hi' }], '@mashKeyed'], 'bv-a': [['Integer', { a: 'Text' }]], from: 'c' },
      reply: { id: '4', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'c' },
    });
  });

  it('key-mapped + positional — positional type mismatch → unhandled', async () => {
    await expectReply({
      script, receive: { id: '5', op: [['nope', { a: 'hi' }], '@mashKeyed'], 'bv-a': [['Text', { a: 'Text' }]], from: 'c' },
      reply: { id: '5', ex: { '@mashKeyed': 'unhandled' }, to: 'c' },
    });
  });

  it('key-mapped + sigil shorthand match dispatches', async () => {
    await expectReply({
      script, receive: { id: '6', op: [{ a: 'hi', c: 5 }, '@lettersSigil'], 'bv-a': [{ a: 'Text', c: 'Integer' }], from: 'c' },
      reply: { id: '6', 'bv-a': { result: 'Text' }, re: { result: 'hi' }, to: 'c' },
    });
  });

  it('key-mapped + sigil — sigil type mismatch → unhandled', async () => {
    await expectReply({
      script, receive: { id: '7', op: [{ a: 'hi', c: 'nope' }, '@lettersSigil'], 'bv-a': [{ a: 'Text', c: 'Text' }], from: 'c' },
      reply: { id: '7', ex: { '@lettersSigil': 'unhandled' }, to: 'c' },
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Compile errors
// ═══════════════════════════════════════════════════════════════════════════════

describe('type matching — compile errors', () => {
  it('sigil param without type annotation throws', () => {
    expect(() => compileSource('@add = |:a, b: Integer| -> sum: (a + b) as Integer\n')).toThrow(
      /requires a type annotation/
    );
  });
});
