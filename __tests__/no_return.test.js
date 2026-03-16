import { expectReply } from './helpers.js';

// ── Silent functions — `: .` return type ────────────────────────────────────
//
// A function that performs side effects and returns nothing declares `: .`
// as its return type, mirroring the `-> .` in callable signatures.

describe('no-return function — inline, same line', () => {
  it('fn = |x| effect(x) : .', async () => {
    const source = `
      init
        $last : Integer = 0

      on test()
        apply = |x| ($last = x) : .
        apply(42)
        reply $last : Integer
    `;
    await expectReply({
      source,
      receive: [
        { id: 'init-0', cam: 'init', from: 'system' },
        { id: '1', op: 'test', from: 'caller' },
      ],
      reply: { id: '1', 'bv-a': ['Integer'], re: [42], to: 'caller' },
    });
  });
});

describe('no-return function — inline, next line', () => {
  it('fn = |x| effect(x)\\n  : .', async () => {
    const source = `
      init
        $last : Integer = 0

      on test()
        apply = |x| ($last = x)
          : .
        apply(42)
        reply $last : Integer
    `;
    await expectReply({
      source,
      receive: [
        { id: 'init-0', cam: 'init', from: 'system' },
        { id: '1', op: 'test', from: 'caller' },
      ],
      reply: { id: '1', 'bv-a': ['Integer'], re: [42], to: 'caller' },
    });
  });
});

describe('no-return function — curly brace body', () => {
  it('fn = |x| { effect1(x); effect2(x) } : .', async () => {
    const source = `
      init
        $a : Integer = 0
        $b : Integer = 0

      on test()
        apply = |x| { $a = x; $b = x + 1 } : .
        apply(10)
        reply a: $a, b: $b : Integer, Integer
    `;
    await expectReply({
      source,
      receive: [
        { id: 'init-0', cam: 'init', from: 'system' },
        { id: '1', op: 'test', from: 'caller' },
      ],
      reply: { id: '1', 'bv-a': [{ a: 'Integer', b: 'Integer' }], re: [{ a: 10, b: 11 }], to: 'caller' },
    });
  });
});

// ── No whitespace before dot ────────────────────────────────────────────────

describe('no-return function — compact :. form', () => {
  it('fn = |x| effect(x):.', async () => {
    const source = `
      init
        $last : Integer = 0

      on test()
        apply = |x| ($last = x):.
        apply(42)
        reply $last : Integer
    `;
    await expectReply({
      source,
      receive: [
        { id: 'init-0', cam: 'init', from: 'system' },
        { id: '1', op: 'test', from: 'caller' },
      ],
      reply: { id: '1', 'bv-a': ['Integer'], re: [42], to: 'caller' },
    });
  });

  it('fn = |x| { effects }:.', async () => {
    const source = `
      init
        $a : Integer = 0
        $b : Integer = 0

      on test()
        apply = |x| { $a = x; $b = x + 1 }:.
        apply(10)
        reply a: $a, b: $b : Integer, Integer
    `;
    await expectReply({
      source,
      receive: [
        { id: 'init-0', cam: 'init', from: 'system' },
        { id: '1', op: 'test', from: 'caller' },
      ],
      reply: { id: '1', 'bv-a': [{ a: 'Integer', b: 'Integer' }], re: [{ a: 10, b: 11 }], to: 'caller' },
    });
  });
});
