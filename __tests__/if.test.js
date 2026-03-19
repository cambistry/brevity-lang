import compile from '../index.js';
import { runActor } from './helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture — Boolean literals (truthiness)
//
// Only false and null are falsy. Integer zero is truthy.
// ═══════════════════════════════════════════════════════════════════════════════

describe('Boolean literals', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      @boolTrue
        =
        result : Integer = if true 1 : Integer else 0 : Integer
        -> :result

      @boolFalse
        =
        result : Integer = if false 1 : Integer else 0 : Integer
        -> :result

      @nullFalsy
        =
        cond : Integer | null = null
        result : Integer = if cond 1 : Integer else 0 : Integer
        -> :result

      @zeroTruthy
        =
        result : Integer = if 0 : Integer 1 : Integer else 99 : Integer
        -> :result
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: 'boolTrue', from: 'c' },
        { id: '2', op: 'boolFalse', from: 'c' },
        { id: '3', op: 'nullFalsy', from: 'c' },
        { id: '4', op: 'zeroTruthy', from: 'c' },
      ],
    });
  });

  it('true literal is truthy', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' });
  });

  it('false literal is falsy', () => {
    expect(outputs[1]).toEqual({ id: '2', 'bv-a': { result: 'Integer' }, re: { result: 0 }, to: 'c' });
  });

  it('null is falsy', () => {
    expect(outputs[2]).toEqual({ id: '3', 'bv-a': { result: 'Integer' }, re: { result: 0 }, to: 'c' });
  });

  it('0 (integer zero) is truthy', () => {
    expect(outputs[3]).toEqual({ id: '4', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture — Comparison operators
//
// ==, !=, >, <, >=, <= — each tested in the true case.
// ═══════════════════════════════════════════════════════════════════════════════

describe('Comparison operators', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      @eqTrue
        =
        x : Integer = 5 : Integer
        result : Integer = if x == 5 1 : Integer else 0 : Integer
        -> :result

      @neqTrue
        =
        x : Integer = 5 : Integer
        result : Integer = if x != 3 1 : Integer else 0 : Integer
        -> :result

      @gtTrue
        =
        x : Integer = 10 : Integer
        result : Integer = if x > 5 1 : Integer else 0 : Integer
        -> :result

      @ltTrue
        =
        x : Integer = 3 : Integer
        result : Integer = if x < 5 1 : Integer else 0 : Integer
        -> :result

      @gteTrue
        =
        x : Integer = 5 : Integer
        result : Integer = if x >= 5 1 : Integer else 0 : Integer
        -> :result

      @lteTrue
        =
        x : Integer = 5 : Integer
        result : Integer = if x <= 5 1 : Integer else 0 : Integer
        -> :result
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: 'eqTrue', from: 'c' },
        { id: '2', op: 'neqTrue', from: 'c' },
        { id: '3', op: 'gtTrue', from: 'c' },
        { id: '4', op: 'ltTrue', from: 'c' },
        { id: '5', op: 'gteTrue', from: 'c' },
        { id: '6', op: 'lteTrue', from: 'c' },
      ],
    });
  });

  it('== true case', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' });
  });

  it('!= true case', () => {
    expect(outputs[1]).toEqual({ id: '2', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' });
  });

  it('> true case', () => {
    expect(outputs[2]).toEqual({ id: '3', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' });
  });

  it('< true case', () => {
    expect(outputs[3]).toEqual({ id: '4', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' });
  });

  it('>= true case', () => {
    expect(outputs[4]).toEqual({ id: '5', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' });
  });

  it('<= true case', () => {
    expect(outputs[5]).toEqual({ id: '6', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture — if/else expression forms
//
// Single-line, block form, else-if chain, inner-scope shadowing,
// and reading outer-scope variables from a block.
// ═══════════════════════════════════════════════════════════════════════════════

describe('if/else expression', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      @singleLine
        =
        cond : Boolean = true
        x : Integer = if cond 10 : Integer else 20 : Integer
        -> result: x

      @blockForm
        =
        x : Integer = 1 : Integer
        result : Text = if x == 1 {
          "abc" : Text
        } else {
          "def" : Text
        }
        -> :result

      @elseIf
        =
        x : Integer = 2 : Integer
        result : Integer = if x == 1 10 : Integer else if x == 2 20 : Integer else 30 : Integer
        -> :result

      @shadow
        =
        x : Integer = 10 : Integer
        result : Integer = if true {
          x : Integer = 99 : Integer
        } else {
          0 : Integer
        }
        -> :x, :result

      @readOuter
        =
        x : Integer = 7 : Integer
        result : Integer = if true {
          x
        } else {
          0 : Integer
        }
        -> :result
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: 'singleLine', from: 'c' },
        { id: '2', op: 'blockForm', from: 'c' },
        { id: '3', op: 'elseIf', from: 'c' },
        { id: '4', op: 'shadow', from: 'c' },
        { id: '5', op: 'readOuter', from: 'c' },
      ],
    });
  });

  it('single-line with type annotation on both branches', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' });
  });

  it('block form — last expression is the value', () => {
    expect(outputs[1]).toEqual({ id: '2', 'bv-a': { result: 'Text' }, re: { result: 'abc' }, to: 'c' });
  });

  it('else if chain', () => {
    expect(outputs[2]).toEqual({ id: '3', 'bv-a': { result: 'Integer' }, re: { result: 20 }, to: 'c' });
  });

  it('inner block shadows outer variable; outer value is unchanged', () => {
    expect(outputs[3]).toEqual({
      id: '4', 'bv-a': { x: 'Integer', result: 'Integer' }, re: { x: 10, result: 99 }, to: 'c',
    });
  });

  it('block reads outer scope variables', () => {
    expect(outputs[4]).toEqual({ id: '5', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'c' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture — if without else + function call in branch
//
// No-else → null (false condition returns null, true returns value).
// Function call inside an if block branch.
// ═══════════════════════════════════════════════════════════════════════════════

describe('if without else + function call', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      @noElseFalse
        =
        result : Integer | null = if false 42 : Integer
        -> :result

      @noElseTrue
        =
        result : Integer | null = if true 42 : Integer
        -> :result

      @fnCallInIf
        =
        x : Integer = 5 : Integer
        result : Integer = if x > 3 {
          result: sq : Integer = square(x)
          sq
        } else {
          0 : Integer
        }
        -> :result

      square
        =
        num : Integer
        =
        sq : Integer = num * num
        ->(result: sq : Integer)
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: 'noElseFalse', from: 'c' },
        { id: '2', op: 'noElseTrue', from: 'c' },
        { id: '3', op: 'fnCallInIf', from: 'c' },
      ],
    });
  });

  it('no-else if with false condition → result is null', () => {
    expect(outputs[0]).toEqual({
      id: '1', 'bv-a': { result: 'Integer | null' }, re: { result: null }, to: 'c',
    });
  });

  it('no-else if with true condition → result is value', () => {
    expect(outputs[1]).toEqual({
      id: '2', 'bv-a': { result: 'Integer | null' }, re: { result: 42 }, to: 'c',
    });
  });

  it('function call inside if block branch', () => {
    expect(outputs[2]).toEqual({ id: '3', 'bv-a': { result: 'Integer' }, re: { result: 25 }, to: 'c' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Compile errors (no build needed — instant)
// ═══════════════════════════════════════════════════════════════════════════════

describe('if — compile errors', () => {
  it('plain assignment to outer-scope variable inside block → compile error', () => {
    expect(() => compile(`
      @test
        =
        x : Integer = 0 : Integer
        result : Integer = if true {
          x = 1
        } else {
          x
        }
        -> :result
    `)).toThrow(/re-bind.*'x'|'x'.*re-bind|cannot re-bind/i);
  });

  it('if without else assigned to non-nullable type → compile error', () => {
    expect(() => compile(`
      @test
        =
        result : Integer = if true 42 : Integer
        -> :result
    `)).toThrow(/if without else can return null/i);
  });

  it('mismatched branch types → compile error', () => {
    expect(() => compile(`
      @test
        =
        result : Integer = if true 1 : Integer else "text" : Text
        -> :result
    `)).toThrow(/branch type mismatch/i);
  });
});
