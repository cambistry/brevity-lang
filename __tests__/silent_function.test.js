import compile from '../index.js';
import { runActor } from './helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture — Silent public functions + type matching
//
// Silent functions terminate with `.` and produce no output.
// Replying functions, type mismatches, and unknown ops still produce output.
// Also covers spawn + silent private function (stateless).
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
      @overloaded = |:msg : Text| -> ack: "noted" : Text

      --- replying function alongside silent ones ---

      @add = |:a : Integer, :b : Integer| -> sum: a + b : Integer

      --- spawn + silent private function ---

      @spawnTest
        =
        spawn fire()
        -> answer: "ok" : Text

      fire
        =
        .
    `;

    // Replying messages first, then silent messages last
    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: [{ a: 3, b: 4 }, 'add'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'c' },
        { id: '2', op: [{ msg: 'hello' }, 'overloaded'], 'bv-a': [{ msg: 'Text' }], from: 'c' },
        { id: '3', op: 'spawnTest', from: 'c' },
        { id: '4', op: [{ msg: 42 }, 'notify'], 'bv-a': [{ msg: 'Integer' }], from: 'c' },
        { id: '5', op: 'unknown', from: 'c' },
        { id: '6', op: [{ msg: 'attention' }, 'notify'], 'bv-a': [{ msg: 'Text' }], from: 'c' },
        { id: '7', op: [{ info: 'hello' }, 'log'], 'bv-a': [{ info: 'Text' }], from: 'c' },
        { id: '8', op: [{ msg: 42 }, 'overloaded'], 'bv-a': [{ msg: 'Integer' }], from: 'c' },
      ],
    });
  });

  // replying function works alongside silent functions
  it('replying function still works alongside silent function', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { sum: 'Integer' }, re: { sum: 7 }, to: 'c' });
  });

  // overloaded: Text message routes to replying overload
  it('overloaded — Text message gets reply', () => {
    expect(outputs[1]).toEqual({ id: '2', 'bv-a': { ack: 'Text' }, re: { ack: 'noted' }, to: 'c' });
  });

  // spawn + silent private function — public function still returns
  it('spawn + silent private function — reply ok', () => {
    expect(outputs[2]).toEqual({ id: '3', 'bv-a': { answer: 'Text' }, re: { answer: 'ok' }, to: 'c' });
  });

  // type mismatch → ex unhandled
  it('type mismatch → unhandled', () => {
    expect(outputs[3]).toEqual({ id: '4', ex: { notify: 'unhandled' }, to: 'c' });
  });

  // unknown op → ex unhandled (distinguished from silent)
  it('unhandled op is still distinguished from silent function', () => {
    expect(outputs[4]).toEqual({ id: '5', ex: { unknown: 'unhandled' }, to: 'c' });
  });

  // silent functions produce no output — exactly 5 replying messages
  it('silent messages produce no output', () => {
    expect(outputs).toHaveLength(5);
  });

  // inline form — type match, no post
  it('inline notify — type match, no post', () => {
    expect(outputs.find(o => o.id === '6')).toBeUndefined();
  });

  // spacious form (dot on own line) — no post
  it('spacious log — dot on own line, no post', () => {
    expect(outputs.find(o => o.id === '7')).toBeUndefined();
  });

  // overloaded: Integer message routes to silent overload — no post
  it('overloaded — Integer message, silent, no post', () => {
    expect(outputs.find(o => o.id === '8')).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture — Stateful silent functions + silent lambdas
//
// Silent functions and lambdas that perform side effects on actor state.
// Store/check pattern verifies dot-on-same-line with state mutation.
// Four lambda forms: inline same-line, inline next-line, curly body, curly single-line.
// ═══════════════════════════════════════════════════════════════════════════════

describe('stateful silent functions + lambdas', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      init
        $last : Text = ""
        $lastInt : Integer = 0
        $a : Integer = 0
        $b : Integer = 0

      --- store: dot on same line as state mutation ---

      @store
        =
        :msg : Text
        =
        $last = msg .

      @check
        =
        -> last: $last : Text

      --- lambdas: four syntactic forms ---

      @lambdaInline
        =
        apply = |x| $lastInt = x .
        apply(42)
        -> $lastInt : Integer

      @lambdaNextLine
        =
        apply = |x| $lastInt = x
          .
        apply(99)
        -> $lastInt : Integer

      @lambdaCurly
        =
        apply = |x| {
          $a = x
          $b = x + 1
          .
        }
        apply(10)
        -> a: $a : Integer, b: $b : Integer

      @lambdaCurlySingle
        =
        apply = |x| { $a = x . }
        apply(77)
        -> a: $a : Integer
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: 'init-0', cam: 'init', from: 'system' },
        { id: 's1', op: [{ msg: 'hello' }, 'store'], 'bv-a': [{ msg: 'Text' }], from: 'c' },
        { id: 'c1', op: 'check', from: 'c' },
        { id: 'l1', op: 'lambdaInline', from: 'c' },
        { id: 'l2', op: 'lambdaNextLine', from: 'c' },
        { id: 'l3', op: 'lambdaCurly', from: 'c' },
        { id: 'l4', op: 'lambdaCurlySingle', from: 'c' },
      ],
    });
  });

  // store is silent — no output for that message
  it('dot on same line — store is silent', () => {
    expect(outputs.find(o => o.id === 's1')).toBeUndefined();
  });

  // check reads $last after store mutated it
  it('dot on same line — state persists after silent store', () => {
    expect(outputs.find(o => o.id === 'c1')).toEqual(
      expect.objectContaining({ id: 'c1', re: { last: 'hello' }, to: 'c' }),
    );
  });

  // fn = |x| $lastInt = x .  (dot on same line as statement)
  it('lambda — inline same line', () => {
    expect(outputs.find(o => o.id === 'l1')).toEqual(
      expect.objectContaining({ id: 'l1', re: [42], to: 'c' }),
    );
  });

  // fn = |x| $lastInt = x\n  .  (dot on next line)
  it('lambda — inline next line', () => {
    expect(outputs.find(o => o.id === 'l2')).toEqual(
      expect.objectContaining({ id: 'l2', re: [99], to: 'c' }),
    );
  });

  // fn = |x| { ...\n. }  (curly brace body, multi-line)
  it('lambda — curly brace body', () => {
    expect(outputs.find(o => o.id === 'l3')).toEqual(
      expect.objectContaining({ id: 'l3', re: { a: 10, b: 11 }, to: 'c' }),
    );
  });

  // fn = |x| { ... . }  (curly brace body, single line)
  it('lambda — curly brace single line', () => {
    expect(outputs.find(o => o.id === 'l4')).toEqual(
      expect.objectContaining({ id: 'l4', re: { a: 77 }, to: 'c' }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Standalone — side-effect spawn with busy-wait
//
// Spawn fires a silent function that mutates state; public function
// busy-waits via __tick__ until state changes.
// ═══════════════════════════════════════════════════════════════════════════════

describe('silent private — side-effect spawn with __tick__', () => {
  it('dot on same line — side-effect function sets state', async () => {
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
        -> answer: "done" : Text

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
