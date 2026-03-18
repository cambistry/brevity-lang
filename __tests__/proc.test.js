import compile from '../index.js';
import { expectReply } from './helpers.js';

describe('proc — basic call from handler', () => {
  it('handler calls proc, destructures result', async () => {
    const source = `
      on foo()
        result: x : Integer = square(10)
        -> :x

      proc square(num : Integer)
        sq : Integer = num * num
        ->(result: sq : Integer)
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'foo', from: 'caller' },
      reply: { id: '1', 'bv-a': { x: 'Integer' }, re: { x: 100 }, to: 'caller' },
    });
  });

  it('proc result assigned as whole Structure, then destructured', async () => {
    const source = `
      on foo()
        s : Structure = square(10)
        result: x : Integer = s
        -> :x

      proc square(num : Integer)
        sq : Integer = num * num
        ->(result: sq : Integer)
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'foo', from: 'caller' },
      reply: { id: '1', 'bv-a': { x: 'Integer' }, re: { x: 100 }, to: 'caller' },
    });
  });

  it('proc with named arg', async () => {
    const source = `
      on greet(:name : Text)
        result: msg : Text = format(name)
        -> :msg

      proc format(val : Text)
        ->(result: val : Text)
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{ name: 'world' }, 'greet'], 'bv-a': [{ name: 'Text' }], from: 'caller' },
      reply: { id: '1', 'bv-a': { msg: 'Text' }, re: { msg: 'world' }, to: 'caller' },
    });
  });

  it('proc called twice in same handler with different args', async () => {
    const source = `
      on foo()
        result: a : Integer = square(3)
        result: b : Integer = square(4)
        -> sum: a + b : Integer

      proc square(num : Integer)
        sq : Integer = num * num
        ->(result: sq : Integer)
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'foo', from: 'caller' },
      reply: { id: '1', 'bv-a': { sum: 'Integer' }, re: { sum: 25 }, to: 'caller' },
    });
  });
});

describe('proc — mixed destructure from proc result', () => {
  it('positional + named + key-mapped all bound correctly', async () => {
    const source = `
      on foo()
        a : Integer, b : Integer, :c : Text, d: x : Text = sub()
        -> pa: a + b : Integer, nc: c, nd: x

      proc sub

        ->
          10 : Integer
          20 : Integer
          c: "v1" : Text
          d: "v2" : Text
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'foo', from: 'caller' },
      reply: {
        id: '1', 'bv-a': { nc: 'Text', nd: 'Text', pa: 'Integer' }, re: { pa: 30, nc: 'v1', nd: 'v2' }, to: 'caller',
      },
    });
  });
});

describe('proc — namespace', () => {
  it('on and proc with the same name throws at compile time', () => {
    const source = `
      on square()
        -> result: 0 : Integer

      proc square(num : Integer)
        ->(result: num : Integer)
    `;
    expect(() => compile(source)).toThrow(/'square' is declared as both/);
  });
});

describe('proc — direct call harness', () => {
  it.todo('proc exposed as public method for direct testing');
});

describe('proc — plain assignment arity', () => {
  it('plain assign from proc returning 1 positional unwraps correctly', async () => {
    const source = `
      on test()
        a : Integer = getOne()
        -> result: a

      proc getOne

        -> 42 : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 42 }, to: 'caller' },
    });
  });

  it('plain assign from proc returning 2 positionals throws at runtime', async () => {
    const source = `
      on test()
        a : Integer = getTwo()
        -> result: a

      proc getTwo

        ->(1 : Integer, 2 : Integer)
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: { id: '1', ex: { test: 'error' }, to: 'caller' },
    });
  });
});

// ─── whitespace-only blank line ───────────────────────────────────────────────

describe('proc — spacious proc with whitespace-only blank line', () => {
  it('whitespace-only blank line terminates spacious proc param block', async () => {
    const source = `
      on go()
        doubled : Integer = double(5)
        -> :doubled

      double
        =
        n : Integer
        =
        -> n * 2 : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: {
        id: '1', 'bv-a': { doubled: 'Integer' }, re: { doubled: 10 }, to: 'caller',
      },
    });
  });
});
