import compile from '../index.js';
import { expectReply } from './helpers.js';

// ── No-arg spacious function ──────────────────────────────────────────────────

describe('spacious function — no-arg', () => {
  it('single = opens body directly', async () => {
    const source = `
      @go()
        result: x : Integer = f()
        -> :x

      f
        =
        -> result: 42 : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { x: 'Integer' }, re: { x: 42 }, to: 'caller' },
    });
  });

  it('double = explicitly marks empty params', async () => {
    const source = `
      @go()
        result: x : Integer = f()
        -> :x

      f
        =
        =
        -> result: 42 : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { x: 'Integer' }, re: { x: 42 }, to: 'caller' },
    });
  });
});

// ── Positional params ─────────────────────────────────────────────────────────

describe('spacious function — positional params', () => {
  it('single positional param', async () => {
    const source = `
      @go()
        result: x : Integer = double(5)
        -> :x

      double
        =
        n : Integer
        =
        -> result: n * 2 : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { x: 'Integer' }, re: { x: 10 }, to: 'caller' },
    });
  });

  it('multiple positional params', async () => {
    const source = `
      @go()
        result: s : Integer = add(3, 4)
        -> :s

      add
        =
        a : Integer
        b : Integer
        =
        -> result: a + b : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { s: 'Integer' }, re: { s: 7 }, to: 'caller' },
    });
  });
});

// ── Named and key-mapped params ───────────────────────────────────────────────

describe('spacious function — named and key-mapped params', () => {
  it('named param (sigil)', async () => {
    const source = `
      @go()
        result: msg : Text = greet(name: "world")
        -> :msg

      greet
        =
        :name : Text
        =
        -> result: name : Text
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { msg: 'Text' }, re: { msg: 'world' }, to: 'caller' },
    });
  });

  it('mixed positional + named params', async () => {
    const source = `
      @go()
        result: x : Integer = mix(10, label: "hi")
        -> :x

      mix
        =
        n : Integer
        :label : Text
        =
        -> result: n : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { x: 'Integer' }, re: { x: 10 }, to: 'caller' },
    });
  });

  it('key-mapped param (outer: inner : Type)', async () => {
    const source = `
      @go()
        result: x : Text = keyed(tag: "hello")
        -> :x

      keyed
        =
        tag: t : Text
        =
        -> result: t : Text
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { x: 'Text' }, re: { x: 'hello' }, to: 'caller' },
    });
  });
});

// ── Multi-statement body ──────────────────────────────────────────────────────

describe('spacious function — multi-statement body', () => {
  it('assignments before return', async () => {
    const source = `
      @go()
        result: x : Integer = compute(5)
        -> :x

      compute
        =
        n : Integer
        =
        doubled : Integer = n * 2
        -> result: doubled : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { x: 'Integer' }, re: { x: 10 }, to: 'caller' },
    });
  });
});

// ── Spacious return ───────────────────────────────────────────────────────────

describe('spacious function — spacious return', () => {
  it('-> on its own line, fields below, blank-line terminated', async () => {
    const source = `
      @go()
        x: a : Integer, y: b : Text = compute(5)
        -> :a, :b

      compute
        =
        n : Integer
        =
        doubled : Integer = n * 2
        ->
          x: doubled : Integer
          y: "hello" : Text

    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { a: 'Integer', b: 'Text' }, re: { a: 10, b: 'hello' }, to: 'caller' },
    });
  });
});

// ── Silent function ───────────────────────────────────────────────────────────

describe('spacious function — silent (. stop)', () => {
  it('side-effect-only function with dot', async () => {
    const source = `
      @test()
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

  it('compile error: assigning result of silent function', () => {
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
});

// ── Multiple functions in same actor ──────────────────────────────────────────

describe('spacious function — multiple in same actor', () => {
  it('double + triple, both called from handler', async () => {
    const source = `
      @go()
        result: a : Integer = double(5)
        result: b : Integer = triple(5)
        -> sum: a + b : Integer

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
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { sum: 'Integer' }, re: { sum: 25 }, to: 'caller' },
    });
  });
});

// ── Function calling another function ─────────────────────────────────────────

describe('spacious function — calling another spacious function', () => {
  it('quad calls double internally', async () => {
    const source = `
      @go()
        result: x : Integer = quad(5)
        -> :x

      double
        =
        n : Integer
        =
        -> result: n * 2 : Integer

      quad
        =
        n : Integer
        =
        result: d : Integer = double(n)
        -> result: d * 2 : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { x: 'Integer' }, re: { x: 20 }, to: 'caller' },
    });
  });
});

// ── Spacious + dense coexistence ──────────────────────────────────────────────

describe('spacious function — coexistence with dense lambda', () => {
  it('spacious top-level + dense |a| { ... } in handler body', async () => {
    const source = `
      @go()
        fn = |a| { a + 1 }
        result: base : Integer = square(5)
        extra : Integer = fn(base)
        -> :extra

      square
        =
        n : Integer
        =
        -> result: n * n : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { extra: 'Integer' }, re: { extra: 26 }, to: 'caller' },
    });
  });
});

// ── Closure — compile error ───────────────────────────────────────────────────

describe('spacious function — closure restriction', () => {
  it.todo('top-level func cannot close over handler-scope variable');
});
