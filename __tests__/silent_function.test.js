import compile from '../index.js';
import { runActor } from './helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture — Silent public functions + type matching
// ═══════════════════════════════════════════════════════════════════════════════

describe('silent public functions + type matching', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
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
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: [{ a: 3, b: 4 }, '@add'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'c' },
        { id: '2', op: [{ msg: 'hello' }, '@overloaded'], 'bv-a': [{ msg: 'Text' }], from: 'c' },
        { id: '3', op: '@spawnTest', from: 'c' },
        { id: '4', op: [{ msg: 42 }, '@notify'], 'bv-a': [{ msg: 'Integer' }], from: 'c' },
        { id: '5', op: '@unknown', from: 'c' },
        { id: '6', op: [{ msg: 'attention' }, '@notify'], 'bv-a': [{ msg: 'Text' }], from: 'c' },
        { id: '7', op: [{ info: 'hello' }, '@log'], 'bv-a': [{ info: 'Text' }], from: 'c' },
        { id: '8', op: [{ msg: 42 }, '@overloaded'], 'bv-a': [{ msg: 'Integer' }], from: 'c' },
      ],
    });
  });

  it('replying function still works alongside silent function', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { sum: 'Integer' }, re: { sum: 7 }, to: 'c' });
  });

  it('overloaded — Text message gets reply', () => {
    expect(outputs[1]).toEqual({ id: '2', 'bv-a': { ack: 'Text' }, re: { ack: 'noted' }, to: 'c' });
  });

  it('spawn + silent private function — reply ok', () => {
    expect(outputs[2]).toEqual({ id: '3', 'bv-a': { answer: 'Text' }, re: { answer: 'ok' }, to: 'c' });
  });

  it('type mismatch → unhandled', () => {
    expect(outputs[3]).toEqual({ id: '4', ex: { '@notify': 'unhandled' }, to: 'c' });
  });

  it('unhandled op is still distinguished from silent function', () => {
    expect(outputs[4]).toEqual({ id: '5', ex: { '@unknown': 'unhandled' }, to: 'c' });
  });

  it('silent messages produce no output', () => {
    expect(outputs).toHaveLength(5);
  });

  it('inline notify — type match, no post', () => {
    expect(outputs.find(o => o.id === '6')).toBeUndefined();
  });

  it('spacious log — dot on own line, no post', () => {
    expect(outputs.find(o => o.id === '7')).toBeUndefined();
  });

  it('overloaded — Integer message, silent, no post', () => {
    expect(outputs.find(o => o.id === '8')).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture — Stateful silent functions + silent lambdas
// ═══════════════════════════════════════════════════════════════════════════════

describe('stateful silent functions + lambdas', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
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
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: 's1', op: [{ msg: 'hello' }, '@store'], 'bv-a': [{ msg: 'Text' }], from: 'c' },
        { id: 'c1', op: '@check', from: 'c' },
        { id: 'l1', op: '@lambdaInline', from: 'c' },
        { id: 'l2', op: '@lambdaNextLine', from: 'c' },
        { id: 'l3', op: '@lambdaCurly', from: 'c' },
        { id: 'l4', op: '@lambdaCurlySingle', from: 'c' },
      ],
    });
  });

  it('dot on same line — store is silent', () => {
    expect(outputs.find(o => o.id === 's1')).toBeUndefined();
  });

  it('dot on same line — state persists after silent store', () => {
    expect(outputs.find(o => o.id === 'c1')).toEqual(
      expect.objectContaining({ id: 'c1', re: { last: 'hello' }, to: 'c' }),
    );
  });

  it('lambda — inline same line', () => {
    expect(outputs.find(o => o.id === 'l1')).toEqual(
      expect.objectContaining({ id: 'l1', re: [42], to: 'c' }),
    );
  });

  it('lambda — inline next line', () => {
    expect(outputs.find(o => o.id === 'l2')).toEqual(
      expect.objectContaining({ id: 'l2', re: [99], to: 'c' }),
    );
  });

  it('lambda — curly brace body', () => {
    expect(outputs.find(o => o.id === 'l3')).toEqual(
      expect.objectContaining({ id: 'l3', re: { a: 10, b: 11 }, to: 'c' }),
    );
  });

  it('lambda — curly brace single line', () => {
    expect(outputs.find(o => o.id === 'l4')).toEqual(
      expect.objectContaining({ id: 'l4', re: { a: 77 }, to: 'c' }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Standalone — side-effect spawn with busy-wait
// ═══════════════════════════════════════════════════════════════════════════════

describe('silent private — side-effect spawn with __tick__', () => {
  it('dot on same line — side-effect function sets state', async () => {
    const posts = await runActor({
      source: `
        ref x : Integer = 0

        @test
          =
          spawn fire()
          repeat while (x == 0) __tick__()
          -> x : Integer

        fire
          =
          x <- 1 .
      `,
      receive: [{ id: '1', op: '@test', from: 'c' }],
    });
    expect(posts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: '1', re: [1], to: 'c' }),
    ]));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture — -> . synonym for . (arrow-dot silent terminator)
// ═══════════════════════════════════════════════════════════════════════════════

describe('silent function — -> . synonym', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      --- spacious private function with -> . ---

      @spaciousArrowDot
        =
        spawn fireArrow()
        -> answer: "ok" as Text

      fireArrow
        =
        -> .

    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: '@spaciousArrowDot', from: 'c' },
      ],
    });
  });

  it('spacious private function — -> . is silent', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { answer: 'Text' }, re: { answer: 'ok' }, to: 'c' });
  });

});

// ═══════════════════════════════════════════════════════════════════════════════
// Compile errors (no build needed — instant)
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
