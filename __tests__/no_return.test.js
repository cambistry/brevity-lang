import compile from '../index.js';
import { runActor } from './helpers.js';

// ── Silent functions — `: .` return type ────────────────────────────────────
//
// A function that performs side effects and returns nothing must terminate with `.`,
// mirroring the `-> .` in function signatures.

describe('no-return function — inline, same line', () => {
  it('fn = |x| effect(x) .', async () => {
    const source = `
      init
        $last : Integer = 0

      @test
        =
        apply = |x| $last = x .
        apply(42)
        -> $last : Integer
    `;
    const posts = await runActor({
      source,
      receive: [
        { id: 'init-0', cam: 'init', from: 'system' },
        { id: '1', op: 'test', from: 'caller' },
      ],
    });
    expect(posts[0]).toEqual({ id: 'init-0', re: 'init', to: 'system' });
    expect(posts[1]).toEqual(expect.objectContaining({ id: '1', re: [42], to: 'caller' }));
  });
});

describe('no-return function — inline, next line', () => {
  it('fn = |x| <effect>\\n.', async () => {
    const source = `
      init
        $last : Integer = 0

      @test
        =
        apply = |x| $last = x
          .
        apply(42)
        -> $last : Integer
    `;
    const posts = await runActor({
      source,
      receive: [
        { id: 'init-0', cam: 'init', from: 'system' },
        { id: '1', op: 'test', from: 'caller' },
      ],
    });
    expect(posts[0]).toEqual({ id: 'init-0', re: 'init', to: 'system' });
    expect(posts[1]).toEqual(expect.objectContaining({ id: '1', re: [42], to: 'caller' }));
  });
});

describe('no-return function — curly brace body', () => {
  it('fn = |x| { ...\n. }', async () => {
    const source = `
      init
        $a : Integer = 0
        $b : Integer = 0

      @test
        =
        apply = |x| {
          $a = x
          $b = x + 1
          .
        }
        apply(10)
        -> a: $a : Integer, b: $b : Integer
    `;
    const posts = await runActor({
      source,
      receive: [
        { id: 'init-0', cam: 'init', from: 'system' },
        { id: '1', op: 'test', from: 'caller' },
      ],
    });
    expect(posts[0]).toEqual({ id: 'init-0', re: 'init', to: 'system' });
    expect(posts[1]).toEqual(expect.objectContaining({ id: '1', re: { a: 10, b: 11 }, to: 'caller' }));
  });
});

describe('no-return function — curly brace body, single line', () => {
  it('fn = |x| { <...> . }', async () => {
    const source = `
      init
        $a : Integer = 0

      @test
        =
        apply = |x| { $a = x . }
        apply(10)
        -> a: $a : Integer
    `;
    const posts = await runActor({
      source,
      receive: [
        { id: 'init-0', cam: 'init', from: 'system' },
        { id: '1', op: 'test', from: 'caller' },
      ],
    });
    expect(posts[0]).toEqual({ id: 'init-0', re: 'init', to: 'system' });
    expect(posts[1]).toEqual(expect.objectContaining({ id: '1', re: { a: 10 }, to: 'caller' }));
  });
});

describe('no-return function — compile errors', () => {
  it('assigning result of silent function is a compile error', () => {
    expect(() => compile(`
      init
        $x : Integer = 0

      @test
        =
        apply = |x| $x = x .
        result : Integer = apply(42)
        -> $x : Integer
    `)).toThrow(/Cannot assign result of silent function/);
  });
});
