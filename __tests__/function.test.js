import compile from '../index.js';
import { expectActorReply } from './helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Lambda body forms, closures, and multi-call
// ═══════════════════════════════════════════════════════════════════════════════

describe('function — all forms', () => {
  const script = `
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

  it('|a| { a + 1 } — single positional', async () => {
    await expectActorReply({
      script, receive: { id: '1', op: '@curlyOne', from: 'c' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 6 }, to: 'c' },
    });
  });

  it('|a, b| { a + b } — two positionals', async () => {
    await expectActorReply({
      script, receive: { id: '2', op: '@curlyTwo', from: 'c' },
      reply: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'c' },
    });
  });

  it('|a, b| { a * b } — multiplication', async () => {
    await expectActorReply({
      script, receive: { id: '3', op: '@curlyMult', from: 'c' },
      reply: { id: '3', 'bv-a': { result: 'Integer' }, re: { result: 42 }, to: 'c' },
    });
  });

  it('|a| a + 1 — expr to EOL', async () => {
    await expectActorReply({
      script, receive: { id: '4', op: '@exprOne', from: 'c' },
      reply: { id: '4', 'bv-a': { result: 'Integer' }, re: { result: 11 }, to: 'c' },
    });
  });

  it('|a : Integer| a * 2 — typed param', async () => {
    await expectActorReply({
      script, receive: { id: '5', op: '@exprTyped', from: 'c' },
      reply: { id: '5', 'bv-a': { result: 'Integer' }, re: { result: 14 }, to: 'c' },
    });
  });

  it('|a, b| a - b — two params', async () => {
    await expectActorReply({
      script, receive: { id: '6', op: '@exprTwo', from: 'c' },
      reply: { id: '6', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'c' },
    });
  });

  it('|a, b| { a / b } : Float — return type annotation', async () => {
    await expectActorReply({
      script, receive: { id: '7', op: '@returnAnnotation', from: 'c' },
      reply: { id: '7', 'bv-a': { result: 'Integer' }, re: { result: 5 }, to: 'c' },
    });
  });

  it('function reads outer-scope variable', async () => {
    await expectActorReply({
      script, receive: { id: '8', op: '@closureRead', from: 'c' },
      reply: { id: '8', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' },
    });
  });

  it('function body shadows outer variable; outer unchanged', async () => {
    await expectActorReply({
      script, receive: { id: '9', op: '@closureShadow', from: 'c' },
      reply: { id: '9', 'bv-a': { x: 'Integer', result: 'Integer' }, re: { x: 10, result: 99 }, to: 'c' },
    });
  });

  it('same function called twice gives independent results', async () => {
    await expectActorReply({
      script, receive: { id: '10', op: '@calledTwice', from: 'c' },
      reply: { id: '10', 'bv-a': { x: 'Integer', y: 'Integer' }, re: { x: 9, y: 25 }, to: 'c' },
    });
  });

  it('two distinct functions in same public function', async () => {
    await expectActorReply({
      script, receive: { id: '11', op: '@twoFunctions', from: 'c' },
      reply: { id: '11', 'bv-a': { x: 'Integer', y: 'Integer' }, re: { x: 8, y: 12 }, to: 'c' },
    });
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
