import compile from '../index.js';
import { runActor } from './helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture — Named params
//
// Typed named params (:a : Integer, :b : Integer) dispatch on type match.
// Mismatched types, missing params, extra fields, missing bv-a all tested.
// ═══════════════════════════════════════════════════════════════════════════════

describe('type matching — named params', () => {
  let outputs;

  beforeAll(async () => {
    const source = '@add = |:a : Integer, :b : Integer| -> sum: (a + b) as Integer\n';

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: [{ a: 3, b: 4 }, 'add'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'c' },
        { id: '2', op: [{ a: 'x', b: 'y' }, 'add'], 'bv-a': [{ a: 'Text', b: 'Text' }], from: 'c' },
        { id: '3', op: [{ a: 3 }, 'add'], 'bv-a': [{ a: 'Integer' }], from: 'c' },
        { id: '4', op: [{ a: 3, b: 4, c: 99 }, 'add'], 'bv-a': [{ a: 'Integer', b: 'Integer', c: 'Integer' }], from: 'c' },
        { id: '5', op: [{ a: 3, b: 4 }, 'add'], from: 'c' },
      ],
    });
  });

  it('exact named match dispatches', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { sum: 'Integer' }, re: { sum: 7 }, to: 'c' });
  });

  it('named type mismatch → unhandled', () => {
    expect(outputs[1]).toEqual({ id: '2', ex: { add: 'unhandled' }, to: 'c' });
  });

  it('required named param absent → unhandled', () => {
    expect(outputs[2]).toEqual({ id: '3', ex: { add: 'unhandled' }, to: 'c' });
  });

  it('extra named field still matches', () => {
    expect(outputs[3]).toEqual({ id: '4', 'bv-a': { sum: 'Integer' }, re: { sum: 7 }, to: 'c' });
  });

  it('missing bv-a → schema_required', () => {
    expect(outputs[4]).toEqual({ id: '5', ex: { add: 'schema_required' }, to: 'c' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture — Positional params
//
// Typed positional params (a : Integer, b : Integer) — exact count and type
// must match; too few, too many, or wrong type → unhandled.
// ═══════════════════════════════════════════════════════════════════════════════

describe('type matching — positional params', () => {
  let outputs;

  beforeAll(async () => {
    const source = '@mult = |a : Integer, b : Integer| -> product: (a * b) as Integer\n';

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: [[3, 5], 'mult'], 'bv-a': [['Integer', 'Integer']], from: 'c' },
        { id: '2', op: [['a', 'b'], 'mult'], 'bv-a': [['Text', 'Text']], from: 'c' },
        { id: '3', op: [[3], 'mult'], 'bv-a': [['Integer']], from: 'c' },
        { id: '4', op: [[3, 5, 7], 'mult'], 'bv-a': [['Integer', 'Integer', 'Integer']], from: 'c' },
      ],
    });
  });

  it('exact positional match dispatches', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { product: 'Integer' }, re: { product: 15 }, to: 'c' });
  });

  it('positional type mismatch → unhandled', () => {
    expect(outputs[1]).toEqual({ id: '2', ex: { mult: 'unhandled' }, to: 'c' });
  });

  it('too few positionals → unhandled', () => {
    expect(outputs[2]).toEqual({ id: '3', ex: { mult: 'unhandled' }, to: 'c' });
  });

  it('too many positionals → unhandled', () => {
    expect(outputs[3]).toEqual({ id: '4', ex: { mult: 'unhandled' }, to: 'c' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture — Mixed params + ...args
//
// Mixed positional + named type matching, and ...args universal matcher
// (with and without bv-a).
// ═══════════════════════════════════════════════════════════════════════════════

describe('type matching — mixed params + ...args', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      @mash = |a : Integer, b : Integer, :label : Text| -> result: (a + b) as Integer
      @import = |...args| ->(...args)
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: [[3, 4, { label: 'hi' }], 'mash'], 'bv-a': [['Integer', 'Integer', { label: 'Text' }]], from: 'c' },
        { id: '2', op: [['x', 'y', { label: 'hi' }], 'mash'], 'bv-a': [['Text', 'Text', { label: 'Text' }]], from: 'c' },
        { id: '3', op: [[3, 4, { label: 42 }], 'mash'], 'bv-a': [['Integer', 'Integer', { label: 'Integer' }]], from: 'c' },
        { id: '4', op: [{ x: 1 }, 'import'], 'bv-a': [{ x: 'Integer' }], from: 'c' },
        { id: '5', op: [{ x: 1 }, 'import'], from: 'c' },
      ],
    });
  });

  it('mixed positional + named match dispatches', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'c' });
  });

  it('mixed — positional type mismatch → unhandled', () => {
    expect(outputs[1]).toEqual({ id: '2', ex: { mash: 'unhandled' }, to: 'c' });
  });

  it('mixed — named type mismatch → unhandled', () => {
    expect(outputs[2]).toEqual({ id: '3', ex: { mash: 'unhandled' }, to: 'c' });
  });

  it('...args matches named payload with bv-a', () => {
    expect(outputs[3]).toEqual({ id: '4', 'bv-a': { x: 'Integer' }, re: { x: 1 }, to: 'c' });
  });

  it('...args without bv-a → schema_required', () => {
    expect(outputs[4]).toEqual({ id: '5', ex: { import: 'schema_required' }, to: 'c' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture — Overloading (same op, different types)
//
// Two public functions with the same op name but different type signatures.
// Integer routes to first, Text routes to second, Boolean → unhandled.
// ═══════════════════════════════════════════════════════════════════════════════

describe('type matching — overloading', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      @greet = |:name : Integer| -> msg: "number" as Text
      @greet = |:name : Text| -> msg: "text" as Text
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: [{ name: 42 }, 'greet'], 'bv-a': [{ name: 'Integer' }], from: 'c' },
        { id: '2', op: [{ name: 'Alice' }, 'greet'], 'bv-a': [{ name: 'Text' }], from: 'c' },
        { id: '3', op: [{ name: true }, 'greet'], 'bv-a': [{ name: 'Boolean' }], from: 'c' },
      ],
    });
  });

  it('Integer message routes to first overload', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { msg: 'Text' }, re: { msg: 'number' }, to: 'c' });
  });

  it('Text message routes to second overload', () => {
    expect(outputs[1]).toEqual({ id: '2', 'bv-a': { msg: 'Text' }, re: { msg: 'text' }, to: 'c' });
  });

  it('Boolean message → unhandled (no matching overload)', () => {
    expect(outputs[2]).toEqual({ id: '3', ex: { greet: 'unhandled' }, to: 'c' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture — Key-mapped (longhand) named params
//
// Key-mapped params (a: alpha : Text), combined with positional and sigil
// shorthand. Type mismatch and missing key → unhandled.
// ═══════════════════════════════════════════════════════════════════════════════

describe('type matching — key-mapped params', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      @lettersTwo = |a: alpha : Text, b: beta : Integer| -> result: alpha
      @mashKeyed = |x : Integer, a: alpha : Text| -> result: x
      @lettersSigil = |a: alpha : Text, :c : Integer| -> result: alpha
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: [{ a: 'hello', b: 42 }, 'lettersTwo'], 'bv-a': [{ a: 'Text', b: 'Integer' }], from: 'c' },
        { id: '2', op: [{ a: 'hello', b: 'nope' }, 'lettersTwo'], 'bv-a': [{ a: 'Text', b: 'Text' }], from: 'c' },
        { id: '3', op: [{ a: 'hello' }, 'lettersTwo'], 'bv-a': [{ a: 'Text' }], from: 'c' },
        { id: '4', op: [[7, { a: 'hi' }], 'mashKeyed'], 'bv-a': [['Integer', { a: 'Text' }]], from: 'c' },
        { id: '5', op: [['nope', { a: 'hi' }], 'mashKeyed'], 'bv-a': [['Text', { a: 'Text' }]], from: 'c' },
        { id: '6', op: [{ a: 'hi', c: 5 }, 'lettersSigil'], 'bv-a': [{ a: 'Text', c: 'Integer' }], from: 'c' },
        { id: '7', op: [{ a: 'hi', c: 'nope' }, 'lettersSigil'], 'bv-a': [{ a: 'Text', c: 'Text' }], from: 'c' },
      ],
    });
  });

  it('exact key-mapped match dispatches', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { result: 'Text' }, re: { result: 'hello' }, to: 'c' });
  });

  it('key-mapped type mismatch → unhandled', () => {
    expect(outputs[1]).toEqual({ id: '2', ex: { lettersTwo: 'unhandled' }, to: 'c' });
  });

  it('key-mapped missing key → unhandled', () => {
    expect(outputs[2]).toEqual({ id: '3', ex: { lettersTwo: 'unhandled' }, to: 'c' });
  });

  it('key-mapped + positional match dispatches', () => {
    expect(outputs[3]).toEqual({ id: '4', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'c' });
  });

  it('key-mapped + positional — positional type mismatch → unhandled', () => {
    expect(outputs[4]).toEqual({ id: '5', ex: { mashKeyed: 'unhandled' }, to: 'c' });
  });

  it('key-mapped + sigil shorthand match dispatches', () => {
    expect(outputs[5]).toEqual({ id: '6', 'bv-a': { result: 'Text' }, re: { result: 'hi' }, to: 'c' });
  });

  it('key-mapped + sigil — sigil type mismatch → unhandled', () => {
    expect(outputs[6]).toEqual({ id: '7', ex: { lettersSigil: 'unhandled' }, to: 'c' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Compile errors (no build needed — instant)
// ═══════════════════════════════════════════════════════════════════════════════

describe('type matching — compile errors', () => {
  it('sigil param without type annotation throws', () => {
    expect(() => compile('@add = |:a, :b : Integer| -> sum: (a + b) as Integer\n')).toThrow(
      /requires a type annotation/
    );
  });
});
