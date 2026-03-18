import compile from '../index.js';
import { expectReply } from './helpers.js';

describe('function — curly-brace body', () => {
  it('|a| { a + 1 } binds single positional', async () => {
    const source = `
      @go
        =
        fn = |a| { a + 1 }
        result : Integer = fn(5)
        -> :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 6 }, to: 'caller' },
    });
  });

  it('|a, b| { a + b } binds two positionals', async () => {
    const source = `
      @go
        =
        fn = |a, b| { a + b }
        result : Integer = fn(3, 4)
        -> :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'caller' },
    });
  });

  it('|a, b| { a * b } multiplies', async () => {
    const source = `
      @go
        =
        fn = |a, b| { a * b }
        result : Integer = fn(6, 7)
        -> :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 42 }, to: 'caller' },
    });
  });
});

describe('function — single-expr body (no curlies)', () => {
  it('|a| a + 1 parses expr to EOL', async () => {
    const source = `
      @go
        =
        fn = |a| a + 1
        result : Integer = fn(10)
        -> :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 11 }, to: 'caller' },
    });
  });

  it('|a : Integer| a * 2 with typed param', async () => {
    const source = `
      @go
        =
        fn = |a : Integer| a * 2
        result : Integer = fn(7)
        -> :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 14 }, to: 'caller' },
    });
  });

  it('|a, b| a - b with two params', async () => {
    const source = `
      @go
        =
        fn = |a, b| a - b
        result : Integer = fn(10, 3)
        -> :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'caller' },
    });
  });
});

describe('function — return type annotation', () => {
  it('|a, b| { a / b } : Float compiles and returns correct value', async () => {
    const source = `
      @go
        =
        fn = |a, b| { a / b } : Float
        result : Integer = fn(10, 2)
        -> :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 5 }, to: 'caller' },
    });
  });
});

describe('function — closures', () => {
  it('function reads outer-scope variable', async () => {
    const source = `
      @go
        =
        x : Integer = 7 : Integer
        fn = |a| a + x
        result : Integer = fn(3)
        -> :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { result: 'Integer' },
        re: { result: 10 },
        to: 'caller',
      },
    });
  });

  it('function body shadows outer-scope variable; outer value is unchanged', async () => {
    const source = `
      @go
        =
        x : Integer = 10 : Integer
        fn = {
          x : Integer = 99 : Integer
        }
        result : Integer = fn()
        -> :x, :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { x: 'Integer', result: 'Integer' },
        re: { x: 10, result: 99 },
        to: 'caller',
      },
    });
  });

  it('plain assignment to outer-scope variable inside function → compile error', () => {
    expect(() => compile(`
      @go
        =
        x : Integer = 0 : Integer
        fn = {
          x = 1
        }
        -> :x
    `)).toThrow(/re-bind.*'x'|'x'.*re-bind|cannot re-bind/i);
  });
});

describe('function — called multiple times', () => {
  it('same function called twice gives independent results', async () => {
    const source = `
      @go
        =
        fn = |a| { a * a }
        x : Integer = fn(3)
        y : Integer = fn(5)
        -> :x, :y
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { x: 'Integer', y: 'Integer' }, re: { x: 9, y: 25 }, to: 'caller' },
    });
  });

  it('two distinct functions in same handler', async () => {
    const source = `
      @go
        =
        double = |a| a * 2
        triple = |a| a * 3
        x : Integer = double(4)
        y : Integer = triple(4)
        -> :x, :y
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { x: 'Integer', y: 'Integer' }, re: { x: 8, y: 12 }, to: 'caller' },
    });
  });
});
