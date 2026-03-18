import compile from '../index.js';
import { runActor } from './helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture — Param styles
//
// Single actor exercising every param form:
//   no-arg (single =), no-arg (double =),
//   single positional, multiple positional,
//   named (sigil), mixed positional + named, key-mapped.
// ═══════════════════════════════════════════════════════════════════════════════

describe('spacious function — param styles', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      --- handlers — one per param form under test ---

      @noArgSingle()
        result: x : Integer = getFortyTwo()
        -> :x

      @noArgDouble()
        result: x : Integer = getFortyTwoExplicit()
        -> :x

      @singlePos()
        result: x : Integer = double(5)
        -> :x

      @multiPos()
        result: s : Integer = add(3, 4)
        -> :s

      @named()
        result: msg : Text = greet(name: "world")
        -> :msg

      @mixed()
        result: x : Integer = mix(10, label: "hi")
        -> :x

      @keyed()
        result: x : Text = extract(tag: "hello")
        -> :x

      --- functions — each exercises one param form ---

      getFortyTwo
        =
        -> result: 42 : Integer

      getFortyTwoExplicit
        =
        =
        -> result: 42 : Integer

      double
        =
        n : Integer
        =
        -> result: n * 2 : Integer

      add
        =
        a : Integer
        b : Integer
        =
        -> result: a + b : Integer

      greet
        =
        :name : Text
        =
        -> result: name : Text

      mix
        =
        n : Integer
        :label : Text
        =
        -> result: n : Integer

      extract
        =
        tag: t : Text
        =
        -> result: t : Text
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: 'noArgSingle', from: 'c' },
        { id: '2', op: 'noArgDouble', from: 'c' },
        { id: '3', op: 'singlePos', from: 'c' },
        { id: '4', op: 'multiPos', from: 'c' },
        { id: '5', op: 'named', from: 'c' },
        { id: '6', op: 'mixed', from: 'c' },
        { id: '7', op: 'keyed', from: 'c' },
      ],
    });
  });

  // no-arg: single = opens the body directly (no params to delimit)
  it('no-arg — single =', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { x: 'Integer' }, re: { x: 42 }, to: 'c' });
  });

  // no-arg: = = explicitly marks an empty param section
  it('no-arg — double =', () => {
    expect(outputs[1]).toEqual({ id: '2', 'bv-a': { x: 'Integer' }, re: { x: 42 }, to: 'c' });
  });

  // single positional param: n : Integer between = delimiters
  it('single positional param', () => {
    expect(outputs[2]).toEqual({ id: '3', 'bv-a': { x: 'Integer' }, re: { x: 10 }, to: 'c' });
  });

  // two positional params: a : Integer, b : Integer
  it('multiple positional params', () => {
    expect(outputs[3]).toEqual({ id: '4', 'bv-a': { s: 'Integer' }, re: { s: 7 }, to: 'c' });
  });

  // named param via sigil: :name : Text
  it('named param (sigil)', () => {
    expect(outputs[4]).toEqual({ id: '5', 'bv-a': { msg: 'Text' }, re: { msg: 'world' }, to: 'c' });
  });

  // mixed: positional n : Integer + named :label : Text
  it('mixed positional + named', () => {
    expect(outputs[5]).toEqual({ id: '6', 'bv-a': { x: 'Integer' }, re: { x: 10 }, to: 'c' });
  });

  // key-mapped: outer key "tag" bound to inner name "t"
  it('key-mapped param', () => {
    expect(outputs[6]).toEqual({ id: '7', 'bv-a': { x: 'Text' }, re: { x: 'hello' }, to: 'c' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture — Body and return forms
//
// Multi-statement body (assignments before return) and spacious return
// (-> on its own line, fields below, blank-line terminated).
// ═══════════════════════════════════════════════════════════════════════════════

describe('spacious function — body and return forms', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      @multiStmt()
        result: x : Integer = compute(5)
        -> :x

      @spaciousReturn()
        x: a : Integer, y: b : Text = info(5)
        -> :a, :b

      --- compute: multi-statement body — assignments before return ---

      compute
        =
        n : Integer
        =
        doubled : Integer = n * 2
        -> result: doubled : Integer

      --- info: spacious return — -> on its own line, fields below ---

      info
        =
        n : Integer
        =
        doubled : Integer = n * 2
        ->
          x: doubled : Integer
          y: "hello" : Text

    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: 'multiStmt', from: 'c' },
        { id: '2', op: 'spaciousReturn', from: 'c' },
      ],
    });
  });

  // body has an intermediate assignment (doubled = n * 2) before the return
  it('multi-statement body', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { x: 'Integer' }, re: { x: 10 }, to: 'c' });
  });

  // -> on its own line; fields x and y below, terminated by blank line
  it('spacious return (-> on own line, fields below)', () => {
    expect(outputs[1]).toEqual({ id: '2', 'bv-a': { a: 'Integer', b: 'Text' }, re: { a: 10, b: 'hello' }, to: 'c' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture — Composition
//
// Multiple spacious functions in one actor, function-calls-function,
// and spacious + dense coexistence (top-level function alongside
// inline dense |a| { ... } lambda in handler body).
// ═══════════════════════════════════════════════════════════════════════════════

describe('spacious function — composition', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      --- multiple functions: handler calls double and triple ---

      @multiFn()
        result: a : Integer = double(5)
        result: b : Integer = triple(5)
        -> sum: a + b : Integer

      --- cross-call: quad calls double internally ---

      @crossCall()
        result: x : Integer = quad(5)
        -> :x

      --- dense + spacious: handler uses inline lambda alongside top-level fn ---

      @denseSpacious()
        fn = |a| { a + 1 }
        result: base : Integer = square(5)
        extra : Integer = fn(base)
        -> :extra

      --- shared functions ---

      double
        =
        n : Integer
        =
        -> result: n * 2 : Integer

      triple
        =
        n : Integer
        =
        -> result: n * 3 : Integer

      quad
        =
        n : Integer
        =
        result: d : Integer = double(n)
        -> result: d * 2 : Integer

      square
        =
        n : Integer
        =
        -> result: n * n : Integer
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: 'multiFn', from: 'c' },
        { id: '2', op: 'crossCall', from: 'c' },
        { id: '3', op: 'denseSpacious', from: 'c' },
      ],
    });
  });

  // double(5) = 10, triple(5) = 15, sum = 25
  it('multiple spacious functions in same actor', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { sum: 'Integer' }, re: { sum: 25 }, to: 'c' });
  });

  // quad(5) → double(5)=10 → 10*2=20
  it('spacious function calls another spacious function', () => {
    expect(outputs[1]).toEqual({ id: '2', 'bv-a': { x: 'Integer' }, re: { x: 20 }, to: 'c' });
  });

  // square(5)=25, then dense lambda |a|{a+1} applied → 26
  it('spacious top-level + dense lambda in handler', () => {
    expect(outputs[2]).toEqual({ id: '3', 'bv-a': { extra: 'Integer' }, re: { extra: 26 }, to: 'c' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture — Silent function (. stop)
//
// Side-effect-only function terminated with dot.
// spawn is required because silent procs don't return a value.
// ═══════════════════════════════════════════════════════════════════════════════

describe('spacious function — silent (. stop)', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      @go()
        spawn fire()
        -> answer: "ok" : Text

      fire
        =
        .
    `;

    outputs = await runActor({
      source,
      receive: [{ id: '1', op: 'go', from: 'c' }],
    });
  });

  // fire() runs silently; handler still returns its own reply
  it('side-effect-only function with dot', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { answer: 'Text' }, re: { answer: 'ok' }, to: 'c' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture — Compile errors (no build needed — instant)
// ═══════════════════════════════════════════════════════════════════════════════

describe('spacious function — compile errors', () => {
  it('assigning result of silent function is a compile error', () => {
    const source = `
      @test()
        result : Integer = fire()
        -> result : Integer

      fire
        =
        .
    `;
    expect(() => compile(source)).toThrow(/Silent proc/);
  });

  it.todo('top-level func cannot close over handler-scope variable');
});
