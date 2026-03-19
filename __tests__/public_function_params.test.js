import compile from '../index.js';
import { runActor } from './helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture — Dense (pipe) param style
//
// @name = |params| body — params in vertical bars.
// Named sigil, positional, key-mapped, mixed.
// ═══════════════════════════════════════════════════════════════════════════════

describe('@params — dense (pipe)', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      --- named sigil ---

      @singleNamed = |:n : Integer| -> :n

      @twoNamed = |:n : Integer, :m : Integer| -> sum: n + m : Integer

      --- positional ---

      @singlePos = |n : Integer| -> n : Integer

      @twoPos = |a : Integer, b : Integer| -> sum: a + b : Integer

      --- key-mapped ---

      @keyMapped = |a: x : Integer| -> x : Integer

      --- mixed positional + named ---

      @mixedPosNamed = |a : Integer, :b : Integer| -> sum: a + b : Integer
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: [{ n: 42 }, 'singleNamed'], 'bv-a': [{ n: 'Integer' }], from: 'c' },
        { id: '2', op: [{ n: 3, m: 4 }, 'twoNamed'], 'bv-a': [{ n: 'Integer', m: 'Integer' }], from: 'c' },
        { id: '3', op: [[99], 'singlePos'], 'bv-a': [['Integer']], from: 'c' },
        { id: '4', op: [[5, 6], 'twoPos'], 'bv-a': [['Integer', 'Integer']], from: 'c' },
        { id: '5', op: [{ a: 77 }, 'keyMapped'], 'bv-a': [{ a: 'Integer' }], from: 'c' },
        { id: '6', op: [[3, { b: 4 }], 'mixedPosNamed'], 'bv-a': [['Integer', { b: 'Integer' }]], from: 'c' },
      ],
    });
  });

  it('single named param :n : Integer', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { n: 'Integer' }, re: { n: 42 }, to: 'c' });
  });

  it('two named params :n : Integer, :m : Integer', () => {
    expect(outputs[1]).toEqual({ id: '2', 'bv-a': { sum: 'Integer' }, re: { sum: 7 }, to: 'c' });
  });

  it('positional param n : Integer', () => {
    expect(outputs[2]).toEqual({ id: '3', 'bv-a': ['Integer'], re: [99], to: 'c' });
  });

  it('two positional params a : Integer, b : Integer', () => {
    expect(outputs[3]).toEqual({ id: '4', 'bv-a': { sum: 'Integer' }, re: { sum: 11 }, to: 'c' });
  });

  it('key-mapped a: x : Integer', () => {
    expect(outputs[4]).toEqual({ id: '5', 'bv-a': ['Integer'], re: [77], to: 'c' });
  });

  it('mixed positional + named', () => {
    expect(outputs[5]).toEqual({ id: '6', 'bv-a': { sum: 'Integer' }, re: { sum: 7 }, to: 'c' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture — Open (spacious) param style
//
// @name\n=\nparam\nparam\n=\nbody — params between = delimiters.
// No params, single, two, key-mapped, mixed, multiple functions.
// ═══════════════════════════════════════════════════════════════════════════════

describe('@params — open style', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      --- no params ---

      @noParams
        =
        -> answer: "world" : Text

      --- single param ---

      @singleParam
        =
        :n : Integer
        =
        -> :n

      --- two params ---

      @twoParams
        =
        :a : Integer
        :b : Integer
        =
        -> sum: a + b : Integer

      --- key-mapped ---

      @keyMappedOpen
        =
        a: x : Integer
        =
        -> x : Integer

      --- mixed positional + named ---

      @mixedOpen
        =
        n : Integer
        :m : Integer
        =
        -> sum: n + m : Integer

      --- multiple functions don't bleed ---

      @foo
        =
        :x : Integer
        =
        -> :x

      @bar
        =
        :y : Integer
        =
        -> :y
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: 'noParams', from: 'c' },
        { id: '2', op: [{ n: 10 }, 'singleParam'], 'bv-a': [{ n: 'Integer' }], from: 'c' },
        { id: '3', op: [{ a: 10, b: 20 }, 'twoParams'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'c' },
        { id: '4', op: [{ a: 55 }, 'keyMappedOpen'], 'bv-a': [{ a: 'Integer' }], from: 'c' },
        { id: '5', op: [[3, { m: 4 }], 'mixedOpen'], 'bv-a': [['Integer', { m: 'Integer' }]], from: 'c' },
        { id: '6', op: [{ x: 1 }, 'foo'], 'bv-a': [{ x: 'Integer' }], from: 'c' },
        { id: '7', op: [{ y: 2 }, 'bar'], 'bv-a': [{ y: 'Integer' }], from: 'c' },
      ],
    });
  });

  it('no params — = opens body directly', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { answer: 'Text' }, re: { answer: 'world' }, to: 'c' });
  });

  it('single param :n : Integer', () => {
    expect(outputs[1]).toEqual({ id: '2', 'bv-a': { n: 'Integer' }, re: { n: 10 }, to: 'c' });
  });

  it('two params :a : Integer, :b : Integer', () => {
    expect(outputs[2]).toEqual({ id: '3', 'bv-a': { sum: 'Integer' }, re: { sum: 30 }, to: 'c' });
  });

  it('key-mapped a: x : Integer', () => {
    expect(outputs[3]).toEqual({ id: '4', 'bv-a': ['Integer'], re: [55], to: 'c' });
  });

  it('mixed positional + named', () => {
    expect(outputs[4]).toEqual({ id: '5', 'bv-a': { sum: 'Integer' }, re: { sum: 7 }, to: 'c' });
  });

  it('multiple functions — open style does not bleed into next', () => {
    expect(outputs[5]).toEqual({ id: '6', 'bv-a': { x: 'Integer' }, re: { x: 1 }, to: 'c' });
    expect(outputs[6]).toEqual({ id: '7', 'bv-a': { y: 'Integer' }, re: { y: 2 }, to: 'c' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Compile errors (no build needed — instant)
// ═══════════════════════════════════════════════════════════════════════════════

describe('@params — compile errors', () => {
  it('same-line params without pipes → compile error', () => {
    expect(() => compile('@go :n : Integer -> :n\n')).toThrow();
  });

  it('paren-style params → compile error', () => {
    expect(() => compile('@go(:n : Integer) -> :n\n')).toThrow(/Unexpected token after '@go'/);
  });

  it('// with content does not terminate open-style params', () => {
    expect(() => compile(`
      @go
        =
        :n : Integer
        // end params
        -> :n
    `)).toThrow();
  });

  it('-- with content does not terminate open-style params', () => {
    expect(() => compile(`
      @go
        =
        :n : Integer
        -- end params
        -> :n
    `)).toThrow();
  });
});
