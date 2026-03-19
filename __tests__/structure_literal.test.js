import compile from '../index.js';
import { runActor } from './helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture — RHS structure literal syntax
//
// s = a, b  (positional), s = :a, :b  (named sigil), s = x: 5  (key-value),
// s = a, b, :c  (mixed), typed positional, destructure roundtrip.
// ═══════════════════════════════════════════════════════════════════════════════

describe('RHS structure literal', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      --- positional ---

      @posTwo
        =
        a : Integer = 10
        b : Integer = 20
        s = a, b
        -> ...s

      @posThree
        =
        a : Integer = 1
        b : Integer = 2
        c : Integer = 3
        s = a, b, c
        -> ...s

      @posTyped
        =
        a : Integer = 7
        b : Integer = 8
        s = a : Integer, b : Integer
        -> ...s

      --- named ---

      @namedSigil
        =
        a : Integer = 11
        b : Integer = 22
        s = :a, :b
        -> ...s

      @namedKeyValue
        =
        s = x: 5, y: 10
        -> ...s

      --- mixed ---

      @mixedSigil
        =
        a : Integer = 1
        b : Integer = 2
        c : Integer = 30
        d : Integer = 40
        s = a, b, :c, :d
        -> ...s

      @mixedLiteral
        =
        s = 1 : Integer, 2 : Integer, x: "val" : Text
        -> ...s

      --- destructure roundtrip ---

      @roundtrip
        =
        x : Integer = 5
        y : Integer = 6
        s = x, y
        a, b = s
        -> sum: a + b : Integer
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: 'posTwo', from: 'c' },
        { id: '2', op: 'posThree', from: 'c' },
        { id: '3', op: 'posTyped', from: 'c' },
        { id: '4', op: 'namedSigil', from: 'c' },
        { id: '5', op: 'namedKeyValue', from: 'c' },
        { id: '6', op: 'mixedSigil', from: 'c' },
        { id: '7', op: 'mixedLiteral', from: 'c' },
        { id: '8', op: 'roundtrip', from: 'c' },
      ],
    });
  });

  // positional
  it('s = a, b — 2-positional structure', () => {
    expect(outputs[0]).toEqual({ id: '1', re: [10, 20], to: 'c' });
  });

  it('s = a, b, c — 3-positional structure', () => {
    expect(outputs[1]).toEqual({ id: '2', re: [1, 2, 3], to: 'c' });
  });

  it('s = a : Integer, b : Integer — typed positional', () => {
    expect(outputs[2]).toEqual({ id: '3', re: [7, 8], to: 'c' });
  });

  // named
  it('s = :a, :b — named sigil structure', () => {
    expect(outputs[3]).toEqual({ id: '4', re: { a: 11, b: 22 }, to: 'c' });
  });

  it('s = x: 5, y: 10 — key-value named structure', () => {
    expect(outputs[4]).toEqual({ id: '5', re: { x: 5, y: 10 }, to: 'c' });
  });

  // mixed
  it('s = a, b, :c, :d — mixed positional + named', () => {
    expect(outputs[5]).toEqual({ id: '6', re: [1, 2, { c: 30, d: 40 }], to: 'c' });
  });

  it('s = 1, 2, x: "val" — mixed with literal and key-value', () => {
    expect(outputs[6]).toEqual({ id: '7', re: [1, 2, { x: 'val' }], to: 'c' });
  });

  // roundtrip
  it('a, b = s where s was built as a literal', () => {
    expect(outputs[7]).toEqual({ id: '8', 'bv-a': { sum: 'Integer' }, re: { sum: 11 }, to: 'c' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture — Structure coercion + named-field destructure
//
// s : Structure = val : Type wraps a single value in a 1-arity structure.
// Named-field destructure from Structure literal.
// ═══════════════════════════════════════════════════════════════════════════════

describe('Structure coercion + named-field destructure', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      @coerceInt
        =
        s : Structure = 42 : Integer
        -> ...s

      @coerceText
        =
        s : Structure = "hello" : Text
        -> ...s

      @namedFieldOk
        =
        :a, :b = Structure(a: 1 : Integer, b: 2 : Integer)
        -> sum: a + b : Integer
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: 'coerceInt', from: 'c' },
        { id: '2', op: 'coerceText', from: 'c' },
        { id: '3', op: 'namedFieldOk', from: 'c' },
      ],
    });
  });

  it('s : Structure = 42 : Integer wraps in 1-arity structure', () => {
    expect(outputs[0]).toEqual({ id: '1', re: [42], to: 'c' });
  });

  it('s : Structure = "hello" : Text wraps in 1-arity structure', () => {
    expect(outputs[1]).toEqual({ id: '2', re: ['hello'], to: 'c' });
  });

  it('(:a, :b) = Structure(a: 1, b: 2) succeeds', () => {
    expect(outputs[2]).toEqual({ id: '3', 'bv-a': { sum: 'Integer' }, re: { sum: 3 }, to: 'c' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Compile checks (no build needed — instant)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Structure — compile-time checks', () => {
  it('a = Structure(x, y) — 2-arity assign to plain var throws', () => {
    expect(() => compile(`
      @test
        =
        a = Structure(1 : Integer, 2 : Integer)
        -> result: a
    `)).toThrow(/Cannot assign 2-arity Structure/);
  });

  it('a = Structure(x, y, z) — 3-arity assign to plain var throws', () => {
    expect(() => compile(`
      @test
        =
        a = Structure(1 : Integer, 2 : Integer, 3 : Integer)
        -> result: a
    `)).toThrow(/Cannot assign 3-arity Structure/);
  });

  it('a : Type = Structure(x : Type) — single positional is OK', () => {
    expect(() => compile(`
      @test
        =
        a : Integer = Structure(42 : Integer)
        -> result: a
    `)).not.toThrow();
  });

  it('(:a, :b) = Structure(a: 1) — missing field b throws', () => {
    expect(() => compile(`
      @test
        =
        :a, :b = Structure(a: 1 : Integer)
        -> result: a
    `)).toThrow(/Field 'b' not found in Structure literal/);
  });

  it('(:a) = Structure(a: 1, b: 2) — under-destructuring is OK', () => {
    expect(() => compile(`
      @test
        =
        :a = Structure(a: 1 : Integer, b: 2 : Integer)
        -> result: a
    `)).not.toThrow();
  });
});
