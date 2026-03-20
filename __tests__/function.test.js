import compile from '../index.js';
import { runActor } from './helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture — Lambda body forms, closures, and multi-call
// ═══════════════════════════════════════════════════════════════════════════════

describe('function — all forms', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      --- curly-brace body ---

      @curlyOne
        =
        fn = |a| { a + 1 }
        result : Integer = fn(5)
        -> :result

      @curlyTwo
        =
        fn = |a, b| { a + b }
        result : Integer = fn(3, 4)
        -> :result

      @curlyMult
        =
        fn = |a, b| { a * b }
        result : Integer = fn(6, 7)
        -> :result

      --- single-expr body (no curlies) ---

      @exprOne
        =
        fn = |a| a + 1
        result : Integer = fn(10)
        -> :result

      @exprTyped
        =
        fn = |a : Integer| a * 2
        result : Integer = fn(7)
        -> :result

      @exprTwo
        =
        fn = |a, b| a - b
        result : Integer = fn(10, 3)
        -> :result

      --- return type annotation ---

      @returnAnnotation
        =
        fn = |a, b| { a / b } : Float
        result : Integer = fn(10, 2)
        -> :result

      --- closures ---

      @closureRead
        =
        x : Integer = 7
        fn = |a| a + x
        result : Integer = fn(3)
        -> :result

      @closureShadow
        =
        x : Integer = 10
        fn = {
          x : Integer = 99
        }
        result : Integer = fn()
        -> :x, :result

      --- called multiple times ---

      @calledTwice
        =
        fn = |a| { a * a }
        x : Integer = fn(3)
        y : Integer = fn(5)
        -> :x, :y

      @twoFunctions
        =
        double = |a| a * 2
        triple = |a| a * 3
        x : Integer = double(4)
        y : Integer = triple(4)
        -> :x, :y
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: 'curlyOne', from: 'c' },
        { id: '2', op: 'curlyTwo', from: 'c' },
        { id: '3', op: 'curlyMult', from: 'c' },
        { id: '4', op: 'exprOne', from: 'c' },
        { id: '5', op: 'exprTyped', from: 'c' },
        { id: '6', op: 'exprTwo', from: 'c' },
        { id: '7', op: 'returnAnnotation', from: 'c' },
        { id: '8', op: 'closureRead', from: 'c' },
        { id: '9', op: 'closureShadow', from: 'c' },
        { id: '10', op: 'calledTwice', from: 'c' },
        { id: '11', op: 'twoFunctions', from: 'c' },
      ],
    });
  });

  // curly-brace body
  it('|a| { a + 1 } — single positional', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { result: 'Integer' }, re: { result: 6 }, to: 'c' });
  });

  it('|a, b| { a + b } — two positionals', () => {
    expect(outputs[1]).toEqual({ id: '2', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'c' });
  });

  it('|a, b| { a * b } — multiplication', () => {
    expect(outputs[2]).toEqual({ id: '3', 'bv-a': { result: 'Integer' }, re: { result: 42 }, to: 'c' });
  });

  // single-expr body
  it('|a| a + 1 — expr to EOL', () => {
    expect(outputs[3]).toEqual({ id: '4', 'bv-a': { result: 'Integer' }, re: { result: 11 }, to: 'c' });
  });

  it('|a : Integer| a * 2 — typed param', () => {
    expect(outputs[4]).toEqual({ id: '5', 'bv-a': { result: 'Integer' }, re: { result: 14 }, to: 'c' });
  });

  it('|a, b| a - b — two params', () => {
    expect(outputs[5]).toEqual({ id: '6', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'c' });
  });

  // return type annotation
  it('|a, b| { a / b } : Float — return type annotation', () => {
    expect(outputs[6]).toEqual({ id: '7', 'bv-a': { result: 'Integer' }, re: { result: 5 }, to: 'c' });
  });

  // closures
  it('function reads outer-scope variable', () => {
    expect(outputs[7]).toEqual({ id: '8', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' });
  });

  it('function body shadows outer variable; outer unchanged', () => {
    expect(outputs[8]).toEqual({
      id: '9', 'bv-a': { x: 'Integer', result: 'Integer' }, re: { x: 10, result: 99 }, to: 'c',
    });
  });

  // called multiple times
  it('same function called twice gives independent results', () => {
    expect(outputs[9]).toEqual({ id: '10', 'bv-a': { x: 'Integer', y: 'Integer' }, re: { x: 9, y: 25 }, to: 'c' });
  });

  it('two distinct functions in same public function', () => {
    expect(outputs[10]).toEqual({ id: '11', 'bv-a': { x: 'Integer', y: 'Integer' }, re: { x: 8, y: 12 }, to: 'c' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Compile errors
// ═══════════════════════════════════════════════════════════════════════════════

describe('function — compile errors', () => {
  it('plain assignment to outer-scope variable inside function → compile error', () => {
    expect(() => compile(`
      @go
        =
        x : Integer = 0
        fn = {
          x = 1
        }
        -> :x
    `)).toThrow(/re-bind.*'x'|'x'.*re-bind|cannot re-bind/i);
  });
});
