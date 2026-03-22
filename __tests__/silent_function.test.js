import compile from '../index.js';
import { createActor, expectActorReply } from './helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Silent public functions + type matching
// ═══════════════════════════════════════════════════════════════════════════════

describe('silent public functions + type matching', () => {
  let actor;

  beforeAll(async () => {
    actor = await createActor(`
      --- silent public functions: inline and spacious forms ---

      @notify = |:msg : Text| .

      @log
        =
        :info : Text
        =
        .

      --- overloaded: silent for Integer, replying for Text ---

      @overloaded = |:msg : Integer| .
      @overloaded = |:msg : Text| -> ack: "noted" as Text

      --- replying function alongside silent ones ---

      @add = |:a : Integer, :b : Integer| -> sum: (a + b) as Integer

      --- spawn + silent private function ---

      @spawnTest
        =
        spawn fire()
        -> answer: "ok" as Text

      fire
        =
        .
    `);
  });

  it('replying function still works alongside silent function', async () => {
    await expectActorReply({
      actor, receive: { id: '1', op: [{ a: 3, b: 4 }, '@add'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'c' },
      reply: { id: '1', 'bv-a': { sum: 'Integer' }, re: { sum: 7 }, to: 'c' },
    });
  });

  it('overloaded — Text message gets reply', async () => {
    await expectActorReply({
      actor, receive: { id: '2', op: [{ msg: 'hello' }, '@overloaded'], 'bv-a': [{ msg: 'Text' }], from: 'c' },
      reply: { id: '2', 'bv-a': { ack: 'Text' }, re: { ack: 'noted' }, to: 'c' },
    });
  });

  it('spawn + silent private function — reply ok', async () => {
    await expectActorReply({
      actor, receive: { id: '3', op: '@spawnTest', from: 'c' },
      reply: { id: '3', 'bv-a': { answer: 'Text' }, re: { answer: 'ok' }, to: 'c' },
    });
  });

  it('type mismatch → unhandled', async () => {
    await expectActorReply({
      actor, receive: { id: '4', op: [{ msg: 42 }, '@notify'], 'bv-a': [{ msg: 'Integer' }], from: 'c' },
      reply: { id: '4', ex: { '@notify': 'unhandled' }, to: 'c' },
    });
  });

  it('unhandled op is still distinguished from silent function', async () => {
    await expectActorReply({
      actor, receive: { id: '5', op: '@unknown', from: 'c' },
      reply: { id: '5', ex: { '@unknown': 'unhandled' }, to: 'c' },
    });
  });

  it('silent messages produce no output', async () => {
    const before = actor.posts.length;
    await actor.sendAsync({ id: '6', op: [{ msg: 'attention' }, '@notify'], 'bv-a': [{ msg: 'Text' }], from: 'c' });
    await actor.sendAsync({ id: '7', op: [{ info: 'hello' }, '@log'], 'bv-a': [{ info: 'Text' }], from: 'c' });
    await actor.sendAsync({ id: '8', op: [{ msg: 42 }, '@overloaded'], 'bv-a': [{ msg: 'Integer' }], from: 'c' });
    const newPosts = actor.posts.slice(before);
    expect(newPosts.find(o => o.id === '6')).toBeUndefined();
    expect(newPosts.find(o => o.id === '7')).toBeUndefined();
    expect(newPosts.find(o => o.id === '8')).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Stateful silent functions + silent lambdas
// ═══════════════════════════════════════════════════════════════════════════════

describe('stateful silent functions + lambdas', () => {
  let actor;

  beforeAll(async () => {
    actor = await createActor(`
      ref last : Text = ""
      ref lastInt : Integer = 0
      ref a : Integer = 0
      ref b : Integer = 0

      --- store: dot on same line as state mutation ---

      @store
        =
        :msg : Text
        =
        last <- msg .

      @check
        =
        -> last: last : Text

      --- lambdas: four syntactic forms ---

      @lambdaInline
        =
        apply = |x| lastInt <- x .
        apply(42)
        -> lastInt : Integer

      @lambdaNextLine
        =
        apply = |x| lastInt <- x
          .
        apply(99)
        -> lastInt : Integer

      @lambdaCurly
        =
        apply = |x| {
          a <- x
          b <- x + 1
          .
        }
        apply(10)
        -> a: a : Integer, b: b : Integer

      @lambdaCurlySingle
        =
        apply = |x| { a <- x . }
        apply(77)
        -> a: a : Integer
    `);
  });

  it('dot on same line — store is silent, state persists', async () => {
    const before = actor.posts.length;
    await actor.sendAsync({ id: 's1', op: [{ msg: 'hello' }, '@store'], 'bv-a': [{ msg: 'Text' }], from: 'c' });
    expect(actor.posts.slice(before).find(o => o.id === 's1')).toBeUndefined();
    await expectActorReply({
      actor, receive: { id: 'c1', op: '@check', from: 'c' },
      reply: expect.objectContaining({ id: 'c1', re: { last: 'hello' }, to: 'c' }),
    });
  });

  it('lambda — inline same line', async () => {
    await expectActorReply({
      actor, receive: { id: 'l1', op: '@lambdaInline', from: 'c' },
      reply: expect.objectContaining({ id: 'l1', re: [42], to: 'c' }),
    });
  });

  it('lambda — inline next line', async () => {
    await expectActorReply({
      actor, receive: { id: 'l2', op: '@lambdaNextLine', from: 'c' },
      reply: expect.objectContaining({ id: 'l2', re: [99], to: 'c' }),
    });
  });

  it('lambda — curly brace body', async () => {
    await expectActorReply({
      actor, receive: { id: 'l3', op: '@lambdaCurly', from: 'c' },
      reply: expect.objectContaining({ id: 'l3', re: { a: 10, b: 11 }, to: 'c' }),
    });
  });

  it('lambda — curly brace single line', async () => {
    await expectActorReply({
      actor, receive: { id: 'l4', op: '@lambdaCurlySingle', from: 'c' },
      reply: expect.objectContaining({ id: 'l4', re: { a: 77 }, to: 'c' }),
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Side-effect spawn with busy-wait
// ═══════════════════════════════════════════════════════════════════════════════

describe('silent private — side-effect spawn with __tick__', () => {
  it('dot on same line — side-effect function sets state', async () => {
    const actor = await createActor(`
      ref x : Integer = 0

      @test
        =
        spawn fire()
        repeat while (x == 0) __tick__()
        -> x : Integer

      fire
        =
        x <- 1 .
    `);
    const before = actor.posts.length;
    await actor.sendAsync({ id: '1', op: '@test', from: 'c' });
    const newPosts = actor.posts.slice(before);
    expect(newPosts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: '1', re: [1], to: 'c' }),
    ]));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// -> . synonym for . (arrow-dot silent terminator)
// ═══════════════════════════════════════════════════════════════════════════════

describe('silent function — -> . synonym', () => {
  let actor;

  beforeAll(async () => {
    actor = await createActor(`
      @spaciousArrowDot
        =
        spawn fireArrow()
        -> answer: "ok" as Text

      fireArrow
        =
        -> .
    `);
  });

  it('spacious private function — -> . is silent', async () => {
    await expectActorReply({
      actor, receive: { id: '1', op: '@spaciousArrowDot', from: 'c' },
      reply: { id: '1', 'bv-a': { answer: 'Text' }, re: { answer: 'ok' }, to: 'c' },
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Compile errors
// ═══════════════════════════════════════════════════════════════════════════════

describe('silent function — compile errors', () => {
  it('calling silent private function without spawn → compile error', () => {
    expect(() => compile(`
      @test
        =
        fire()
        -> answer: "done" as Text

      fire
        =
        .
    `)).toThrow(/Silent function invocation requires 'spawn'/);
  });

  it('assigning result of silent private function → compile error', () => {
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

  it('assigning result of silent lambda → compile error', () => {
    expect(() => compile(`
      ref x : Integer = 0

      @test
        =
        apply = |x| x <- x .
        result : Integer = apply(42)
        -> x : Integer
    `)).toThrow(/Cannot assign result of silent function/);
  });

  it('silent function used in expression → compile error', () => {
    expect(() => compile(`
      @test
        =
        x : Integer = 1 + fire()
        -> :x

      fire
        =
        .
    `)).toThrow(/Silent function 'fire' cannot be used in an expression/);
  });

  it('silent function used as argument → compile error', () => {
    expect(() => compile(`
      @test
        =
        double = |n| n * 2
        result : Integer = double(fire())
        -> :result

      fire
        =
        .
    `)).toThrow(/Silent function 'fire' cannot be used as an argument/);
  });

  it('silent function used as return value → compile error', () => {
    expect(() => compile(`
      @test
        =
        -> fire()

      fire
        =
        .
    `)).toThrow(/Silent function 'fire' cannot be used as a return value/);
  });
});
