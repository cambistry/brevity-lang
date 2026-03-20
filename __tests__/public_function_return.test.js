import compile from '../index.js';
import { runActor } from './helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture — Same-line + dense return forms
//
// -> field field on same line as body, and dense ->(…) paren style.
// Typed positional, bare positional, sigil, key-value, computed,
// multi-positional dense, named dense.
// ═══════════════════════════════════════════════════════════════════════════════

describe('public function return — same-line + dense', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      --- same-line no-paren ---

      @typedPos
        =
        :n : Integer
        =
        -> n : Integer

      @twoBarePos
        =
        :x : Integer
        :y : Integer
        =
        -> x, y

      @sigilReturn
        =
        :a : Integer
        :b : Integer
        =
        -> :a, :b

      @keyValueReturn
        =
        :a : Integer
        :b : Integer
        =
        -> result: (a + b) as Integer

      --- dense paren style ---

      @denseComputed = |:a : Integer, :b : Integer|
        ->(c: (a + b) as Integer)

      @denseMultiPos = |:a : Integer, :b : Integer|
        ->(a : Integer, b : Integer)

      @denseNamedParen = |:a : Integer, :b : Integer|
        ->(:a, :b)
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: [{ n: 7 }, 'typedPos'], 'bv-a': [{ n: 'Integer' }], from: 'c' },
        { id: '2', op: [{ x: 3, y: 4 }, 'twoBarePos'], 'bv-a': [{ x: 'Integer', y: 'Integer' }], from: 'c' },
        { id: '3', op: [{ a: 10, b: 20 }, 'sigilReturn'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'c' },
        { id: '4', op: [{ a: 5, b: 6 }, 'keyValueReturn'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'c' },
        { id: '5', op: [{ a: 3, b: 4 }, 'denseComputed'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'c' },
        { id: '6', op: [{ a: 8, b: 9 }, 'denseMultiPos'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'c' },
        { id: '7', op: [{ a: 11, b: 22 }, 'denseNamedParen'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'c' },
      ],
    });
  });

  it('-> n : Integer — typed positional', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': ['Integer'], re: [7], to: 'c' });
  });

  it('-> x, y — two bare positionals', () => {
    expect(outputs[1]).toEqual({ id: '2', 'bv-a': ['Integer', 'Integer'], re: [3, 4], to: 'c' });
  });

  it('-> :a, :b — sigil no-paren', () => {
    expect(outputs[2]).toEqual({ id: '3', 'bv-a': { a: 'Integer', b: 'Integer' }, re: { a: 10, b: 20 }, to: 'c' });
  });

  it('-> result: (a + b) as Integer — key-value', () => {
    expect(outputs[3]).toEqual({ id: '4', 'bv-a': { result: 'Integer' }, re: { result: 11 }, to: 'c' });
  });

  it('->(c: (a + b) as Integer) — dense computed', () => {
    expect(outputs[4]).toEqual({ id: '5', 'bv-a': { c: 'Integer' }, re: { c: 7 }, to: 'c' });
  });

  it('->(a : Integer, b : Integer) — dense multi-positional', () => {
    expect(outputs[5]).toEqual({ id: '6', 'bv-a': ['Integer', 'Integer'], re: [8, 9], to: 'c' });
  });

  it('->(:a, :b) — dense named paren', () => {
    expect(outputs[6]).toEqual({ id: '7', 'bv-a': { a: 'Integer', b: 'Integer' }, re: { a: 11, b: 22 }, to: 'c' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture — Spacious return style
//
// -> on its own line, fields below, terminated by blank line or --.
// Also ->() empty parens and whitespace-only blank line termination.
// ═══════════════════════════════════════════════════════════════════════════════

describe('public function return — spacious style', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      --- single named field on next line ---

      @spaciousSingle
        =
        :a : Integer
        =
        ->
        :a

      --- two named fields, blank-line terminated ---

      @spaciousTwo
        =
        :a : Integer
        :b : Integer
        =
        ->
        :a
        :b

      --- spacious with typed key-value via private function ---

      @spaciousKeyValue
        =
        result: x = sub()
        -> :x

      sub
        =
        ->
          result: 99 as Integer

      --- terminated by -- comment ---

      @spaciousDashTerm
        =
        :a : Integer
        =
        ->
        :a
        --

      --- ->() empty parens — next function follows immediately ---

      @emptyParens
        =
        ->()
      @afterEmpty
        =
        -> answer: "pong" as Text

      --- -- terminator allows next function to follow ---

      @spaciousDashNext
        =
        result: x = val()
        ->
        :x
        --
      val
        =
        -> result: 5 : Integer

      --- whitespace-only blank line terminates ---

      @greet
        =
        ->
        msg: "hello" as Text
      ${'  '}
      @ping
        =
        -> status: "ok" as Text
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: [{ a: 7 }, 'spaciousSingle'], 'bv-a': [{ a: 'Integer' }], from: 'c' },
        { id: '2', op: [{ a: 3, b: 4 }, 'spaciousTwo'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'c' },
        { id: '3', op: 'spaciousKeyValue', from: 'c' },
        { id: '4', op: [{ a: 21 }, 'spaciousDashTerm'], 'bv-a': [{ a: 'Integer' }], from: 'c' },
        { id: '5', op: 'afterEmpty', from: 'c' },
        { id: '6', op: 'spaciousDashNext', from: 'c' },
        { id: '7', op: 'greet', from: 'c' },
        { id: '8', op: 'ping', from: 'c' },
      ],
    });
  });

  it('-> \\n :a — single named field on next line', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { a: 'Integer' }, re: { a: 7 }, to: 'c' });
  });

  it('-> \\n :a \\n :b — two named fields, blank-line terminated', () => {
    expect(outputs[1]).toEqual({ id: '2', 'bv-a': { a: 'Integer', b: 'Integer' }, re: { a: 3, b: 4 }, to: 'c' });
  });

  it('spacious -> with typed key-value from private function', () => {
    expect(outputs[2]).toEqual({ id: '3', re: { x: 99 }, to: 'c' });
  });

  it('spacious -> terminated by -- comment', () => {
    expect(outputs[3]).toEqual({ id: '4', 'bv-a': { a: 'Integer' }, re: { a: 21 }, to: 'c' });
  });

  it('->() empty parens — next function follows immediately', () => {
    expect(outputs[4]).toEqual({ id: '5', 'bv-a': { answer: 'Text' }, re: { answer: 'pong' }, to: 'c' });
  });

  it('-- terminator allows next function to follow', () => {
    expect(outputs[5]).toEqual({ id: '6', re: { x: 5 }, to: 'c' });
  });

  it('whitespace-only blank line terminates spacious reply', () => {
    expect(outputs[6]).toEqual({ id: '7', 'bv-a': { msg: 'Text' }, re: { msg: 'hello' }, to: 'c' });
    expect(outputs[7]).toEqual({ id: '8', 'bv-a': { status: 'Text' }, re: { status: 'ok' }, to: 'c' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Compile errors (no build needed — instant)
// ═══════════════════════════════════════════════════════════════════════════════

describe('public function return — compile errors', () => {
  it('same-line field then continuation on next line → ambiguous', () => {
    expect(() => compile(`
      @go
        =
        :a : Integer
        :b : Integer
        =
        -> :a
        :b
    `)).toThrow();
  });

  it('spacious -> not terminated before next declaration', () => {
    expect(() => compile(`
      @go
        =
        result: x = val()
        ->
        :x
      val
        =
        -> result: 5 : Integer
    `)).toThrow();
  });
});
