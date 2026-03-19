import compile from '../index.js';
import { expectReply, runActor } from './helpers.js';

// ── Silent functions — `.` return type ────────────────────────────────────
//
// A function that performs side effects and returns nothing must terminate with `.`,
// mirroring the `-> .` in function signatures.

// ── Silent public functions ─────────────────────────────────────────────────

describe('silent public function — dot terminator', () => {
  it('inline form — no post fired', async () => {
    const source = '@notify = |:msg : Text| .\n';
    await expectReply({
      source,
      receive: { id: '123', op: [{ msg: 'attention' }, 'notify'], 'bv-a': [{ msg: 'Text' }], from: 'caller' },
    });
  });

  it('dot @own line — no post fired', async () => {
    const source = `
      @log
        =
        :info : Text
        =
        .
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{ info: 'hello' }, 'log'], 'bv-a': [{ info: 'Text' }], from: 'caller' },
    });
  });

  it('dot @same line as last statement', async () => {
    const posts = await runActor({
      source: `
        init
          $last : Text = ""

        @store
          =
          :msg : Text
          =
          $last = msg .

        @check
          =
          -> last: $last : Text
      `,
      receive: [
        { id: 'init-0', cam: 'init', from: 'system' },
        { id: '1', op: [{ msg: 'hello' }, 'store'], 'bv-a': [{ msg: 'Text' }], from: 'caller' },
        { id: '2', op: 'check', from: 'caller' },
      ],
    });
    expect(posts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: '2', re: { last: 'hello' } }),
    ]));
  });

  it('multi — silent public function suppresses post', async () => {
    const source = `
      @notify = |:msg : Text| .
      @add = |:a : Integer, :b : Integer| -> sum: a + b : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{ msg: 'hi' }, 'notify'], 'bv-a': [{ msg: 'Text' }], from: 'caller' },
    });
  });

  it('multi — replying function still works alongside silent function', async () => {
    const source = `
      @notify = |:msg : Text| .
      @add = |:a : Integer, :b : Integer| -> sum: a + b : Integer
    `;
    await expectReply({
      source,
      receive: { id: '2', op: [{ a: 3, b: 4 }, 'add'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'caller' },
      reply: {
        id: '2', 'bv-a': { sum: 'Integer' }, re: { sum: 7 }, to: 'caller',
      },
    });
  });

  it('unhandled op is still distinguished from silent public function', async () => {
    const source = '@notify = |:msg : Text| .\n';
    await expectReply({
      source,
      receive: { id: '9', op: 'unknown', from: 'caller' },
      reply: {
        id: '9', ex: { unknown: 'unhandled' }, to: 'caller',
      },
    });
  });
});

// ── Silent public function + type matching ──────────────────────────────────

describe('silent public function + type matching', () => {
  it('type match → no post', async () => {
    const source = '@notify = |:msg : Text| .\n';
    await expectReply({
      source,
      receive: { id: '1', op: [{ msg: 'hello' }, 'notify'], 'bv-a': [{ msg: 'Text' }], from: 'caller' },
    });
  });

  it('type mismatch → ex unhandled', async () => {
    const source = '@notify = |:msg : Text| .\n';
    await expectReply({
      source,
      receive: { id: '1', op: [{ msg: 42 }, 'notify'], 'bv-a': [{ msg: 'Integer' }], from: 'caller' },
      reply: { id: '1', ex: { notify: 'unhandled' }, to: 'caller' },
    });
  });

  it('overloaded: silent Integer, replying Text — Integer message: no post', async () => {
    const source = `
      @notify = |:msg : Integer| .
      @notify = |:msg : Text| -> ack: "noted" : Text
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{ msg: 42 }, 'notify'], 'bv-a': [{ msg: 'Integer' }], from: 'caller' },
    });
  });

  it('overloaded: silent Integer, replying Text — Text message: gets reply', async () => {
    const source = `
      @notify = |:msg : Integer| .
      @notify = |:msg : Text| -> ack: "noted" : Text
    `;
    await expectReply({
      source,
      receive: { id: '2', op: [{ msg: 'hello' }, 'notify'], 'bv-a': [{ msg: 'Text' }], from: 'caller' },
      reply: { id: '2', 'bv-a': { ack: 'Text' }, re: { ack: 'noted' }, to: 'caller' },
    });
  });
});

// ── Silent private functions ────────────────────────────────────────────────

describe('silent private function — dot terminator', () => {
  it('compiler error when calling silent function without spawn', () => {
    expect(() => compile(`
      @test
        =
        fire()
        -> answer: "done" : Text

      fire
        =
        .
    `)).toThrow(/Silent function invocation requires 'spawn'/);
  });

  it('inline form — spawn + silent function', async () => {
    const source = `
      @test
        =
        spawn fire()
        -> answer: "ok" : Text

      fire
        =
        .
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: { id: '1', 'bv-a': { answer: 'Text' }, re: { answer: 'ok' }, to: 'caller' },
    });
  });

  it('dot @own line — spawn + silent function', async () => {
    const source = `
      @test
        =
        spawn fire()
        -> answer: "ok" : Text

      fire
        =
        .
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: { id: '1', 'bv-a': { answer: 'Text' }, re: { answer: 'ok' }, to: 'caller' },
    });
  });

  it('dot @same line as last statement — side-effect function', async () => {
    const posts = await runActor({
      source: `
        init
          $x : Integer = 0

        @test
          =
          spawn fire()
          repeat while ($x == 0) __tick__()
          -> $x : Integer

        fire
          =
          $x = 1 .
      `,
      receive: [
        { id: 'init-0', cam: 'init', from: 'system' },
        { id: '1', op: 'test', from: 'caller' },
      ],
    });
    expect(posts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: '1', re: [1], to: 'caller' }),
    ]));
  });

  it('assigning result of silent private function is a compile error', () => {
    expect(() => compile(`
      @test
        =
        result : Integer = fire()
        -> result : Integer
      fire
        =
        .
    `)).toThrow(/Silent function/);
  });
});

// ── Silent lambdas ──────────────────────────────────────────────────────────

describe('silent lambda — inline, same line', () => {
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

describe('silent lambda — inline, next line', () => {
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

describe('silent lambda — curly brace body', () => {
  it('fn = |x| { ...\\n. }', async () => {
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

describe('silent lambda — curly brace body, single line', () => {
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

describe('silent lambda — compile errors', () => {
  it('assigning result of silent lambda is a compile error', () => {
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
