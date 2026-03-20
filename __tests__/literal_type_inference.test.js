import { runActor } from './helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture — Variable assignment
//
// x = literal  →  type inferred; bv-a reflects inferred type.
// Covers Text, Integer, Decimal, Float, Boolean, null.
// ═══════════════════════════════════════════════════════════════════════════════

describe('literal type inference — variable assignment', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      @text
        =
        x = "hello"
        -> :x

      @integer
        =
        x = 42
        -> :x

      @decimal
        =
        x = 3.14
        -> :x

      @float
        =
        x = 1.23E+2
        -> :x

      @boolTrue
        =
        x = true
        -> :x

      @boolFalse
        =
        x = false
        -> :x

      @nullLit
        =
        x = null
        -> :x
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: '@text', from: 'c' },
        { id: '2', op: '@integer', from: 'c' },
        { id: '3', op: '@decimal', from: 'c' },
        { id: '4', op: '@float', from: 'c' },
        { id: '5', op: '@boolTrue', from: 'c' },
        { id: '6', op: '@boolFalse', from: 'c' },
        { id: '7', op: '@nullLit', from: 'c' },
      ],
    });
  });

  it('string literal inferred as Text', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { x: 'Text' }, re: { x: 'hello' }, to: 'c' });
  });

  it('integer literal inferred as Integer', () => {
    expect(outputs[1]).toEqual({ id: '2', 'bv-a': { x: 'Integer' }, re: { x: 42 }, to: 'c' });
  });

  it('decimal literal inferred as Decimal', () => {
    expect(outputs[2]).toEqual({ id: '3', 'bv-a': { x: 'Decimal' }, re: { x: 3.14 }, to: 'c' });
  });

  it('scientific notation literal inferred as Float', () => {
    expect(outputs[3]).toEqual({ id: '4', 'bv-a': { x: 'Float' }, re: { x: 123 }, to: 'c' });
  });

  it('true inferred as Boolean', () => {
    expect(outputs[4]).toEqual({ id: '5', 'bv-a': { x: 'Boolean' }, re: { x: true }, to: 'c' });
  });

  it('false inferred as Boolean', () => {
    expect(outputs[5]).toEqual({ id: '6', 'bv-a': { x: 'Boolean' }, re: { x: false }, to: 'c' });
  });

  it('null literal inferred as null', () => {
    expect(outputs[6]).toEqual({ id: '7', 'bv-a': { x: 'null' }, re: { x: null }, to: 'c' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture — Reply fields
//
// -> literal  →  type inferred in positional and named return fields.
// ═══════════════════════════════════════════════════════════════════════════════

describe('literal type inference — reply fields', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      @intPos
        =
        -> 99

      @strNamed
        =
        -> msg: "hi"

      @boolNamed
        =
        -> ok: true

      @decNamed
        =
        -> pi: 3.14

      @nullNamed
        =
        -> value: null
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: '@intPos', from: 'c' },
        { id: '2', op: '@strNamed', from: 'c' },
        { id: '3', op: '@boolNamed', from: 'c' },
        { id: '4', op: '@decNamed', from: 'c' },
        { id: '5', op: '@nullNamed', from: 'c' },
      ],
    });
  });

  it('integer in positional reply', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': ['Integer'], re: [99], to: 'c' });
  });

  it('string in named reply field', () => {
    expect(outputs[1]).toEqual({ id: '2', 'bv-a': { msg: 'Text' }, re: { msg: 'hi' }, to: 'c' });
  });

  it('boolean in named reply field', () => {
    expect(outputs[2]).toEqual({ id: '3', 'bv-a': { ok: 'Boolean' }, re: { ok: true }, to: 'c' });
  });

  it('decimal in named reply field', () => {
    expect(outputs[3]).toEqual({ id: '4', 'bv-a': { pi: 'Decimal' }, re: { pi: 3.14 }, to: 'c' });
  });

  it('null in named reply field', () => {
    expect(outputs[4]).toEqual({ id: '5', 'bv-a': { value: 'null' }, re: { value: null }, to: 'c' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture — Function arguments
//
// fn(literal)  →  no type annotation needed on the argument itself.
// ═══════════════════════════════════════════════════════════════════════════════

describe('literal type inference — function arguments', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      @intArg
        =
        fn = |a| a + 1
        result : Integer = fn(10)
        -> :result

      @strArg
        =
        fn = |s| s
        result : Text = fn("world")
        -> :result

      @boolArg
        =
        fn = |b| b
        result : Boolean = fn(true)
        -> :result
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: '@intArg', from: 'c' },
        { id: '2', op: '@strArg', from: 'c' },
        { id: '3', op: '@boolArg', from: 'c' },
      ],
    });
  });

  it('integer passed without annotation', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { result: 'Integer' }, re: { result: 11 }, to: 'c' });
  });

  it('string passed without annotation', () => {
    expect(outputs[1]).toEqual({ id: '2', 'bv-a': { result: 'Text' }, re: { result: 'world' }, to: 'c' });
  });

  it('boolean passed without annotation', () => {
    expect(outputs[2]).toEqual({ id: '3', 'bv-a': { result: 'Boolean' }, re: { result: true }, to: 'c' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture — Structure fields
//
// Structure(key: literal)  →  no type annotation needed on the value.
// ═══════════════════════════════════════════════════════════════════════════════

describe('literal type inference — structure fields', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      @intField
        =
        s : Structure = Structure(count: 7)
        :count : Integer = s
        -> :count

      @strField
        =
        s : Structure = Structure(label: "hello")
        :label : Text = s
        -> :label
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: '@intField', from: 'c' },
        { id: '2', op: '@strField', from: 'c' },
      ],
    });
  });

  it('integer field without annotation', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { count: 'Integer' }, re: { count: 7 }, to: 'c' });
  });

  it('string field without annotation', () => {
    expect(outputs[1]).toEqual({ id: '2', 'bv-a': { label: 'Text' }, re: { label: 'hello' }, to: 'c' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture — Explicit annotation coexists
//
// Fully qualified literal (x : T = v : T) still compiles correctly.
// ═══════════════════════════════════════════════════════════════════════════════

describe('literal type inference — explicit annotation coexists', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      @explicitInt
        =
        x : Integer = 5
        -> :x

      @explicitStr
        =
        x : Text = "hi"
        -> :x
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: '@explicitInt', from: 'c' },
        { id: '2', op: '@explicitStr', from: 'c' },
      ],
    });
  });

  it('integer with explicit annotation still works', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { x: 'Integer' }, re: { x: 5 }, to: 'c' });
  });

  it('string with explicit annotation still works', () => {
    expect(outputs[1]).toEqual({ id: '2', 'bv-a': { x: 'Text' }, re: { x: 'hi' }, to: 'c' });
  });
});
