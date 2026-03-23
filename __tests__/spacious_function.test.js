import compile from '../index.js';
import { compileActor, createActor, expectActorReply } from './helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Param styles
// ═══════════════════════════════════════════════════════════════════════════════

describe('lineal function — param styles', () => {
  let actor;

  beforeAll(async () => {
    actor = await createActor(`
      @noArgSingle
        =
        result: x : Integer = getFortyTwo()
        -> :x

      @noArgDouble
        =
        result: x : Integer = getFortyTwoExplicit()
        -> :x

      @singlePos
        =
        result: x : Integer = double(5)
        -> :x

      @multiPos
        =
        result: s : Integer = add(3, 4)
        -> :s

      @named
        =
        result: msg : Text = greet(name: "world")
        -> :msg

      @mixed
        =
        result: x : Integer = mix(10, label: "hi")
        -> :x

      @keyed
        =
        result: x : Text = extract(tag: "hello")
        -> :x

      getFortyTwo
        =
        -> result: 42 as Integer

      getFortyTwoExplicit
        =
        =
        -> result: 42 as Integer

      double
        =
        n : Integer
        =
        -> result: (n * 2) as Integer

      add
        =
        a : Integer
        b : Integer
        =
        -> result: (a + b) as Integer

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
        -> result: n as Integer

      extract
        =
        tag: t : Text
        =
        -> result: t : Text
    `);
  });

  it('no-arg — single =', async () => {
    await expectActorReply({ actor, receive: { id: '1', op: '@noArgSingle', from: 'c' }, reply: { id: '1', 'bv-a': { x: 'Integer' }, re: { x: 42 }, to: 'c' } });
  });

  it('no-arg — double =', async () => {
    await expectActorReply({ actor, receive: { id: '2', op: '@noArgDouble', from: 'c' }, reply: { id: '2', 'bv-a': { x: 'Integer' }, re: { x: 42 }, to: 'c' } });
  });

  it('single positional param', async () => {
    await expectActorReply({ actor, receive: { id: '3', op: '@singlePos', from: 'c' }, reply: { id: '3', 'bv-a': { x: 'Integer' }, re: { x: 10 }, to: 'c' } });
  });

  it('multiple positional params', async () => {
    await expectActorReply({ actor, receive: { id: '4', op: '@multiPos', from: 'c' }, reply: { id: '4', 'bv-a': { s: 'Integer' }, re: { s: 7 }, to: 'c' } });
  });

  it('named param (sigil)', async () => {
    await expectActorReply({ actor, receive: { id: '5', op: '@named', from: 'c' }, reply: { id: '5', 'bv-a': { msg: 'Text' }, re: { msg: 'world' }, to: 'c' } });
  });

  it('mixed positional + named', async () => {
    await expectActorReply({ actor, receive: { id: '6', op: '@mixed', from: 'c' }, reply: { id: '6', 'bv-a': { x: 'Integer' }, re: { x: 10 }, to: 'c' } });
  });

  it('key-mapped param', async () => {
    await expectActorReply({ actor, receive: { id: '7', op: '@keyed', from: 'c' }, reply: { id: '7', 'bv-a': { x: 'Text' }, re: { x: 'hello' }, to: 'c' } });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Body and return forms
// ═══════════════════════════════════════════════════════════════════════════════

describe('lineal function — body and return forms', () => {
  let actor;

  beforeAll(async () => {
    actor = await createActor(`
      @multiStmt
        =
        result: x : Integer = compute(5)
        -> :x

      @spaciousReturn
        =
        x: a : Integer, y: b : Text = info(5)
        -> :a, :b

      @denseInline
        =
        p : Integer, q : Integer, :sum : Integer, product: prod : Integer = denseReturnInline(3, 4)
        -> :p, :q, :sum, :prod

      @denseMulti
        =
        v : Integer, :doubled : Integer, label: lbl : Text = denseReturnMulti(5)
        -> :v, :doubled, :lbl

      compute
        =
        n : Integer
        =
        doubled : Integer = n * 2
        -> result: doubled : Integer

      info
        =
        n : Integer
        =
        doubled : Integer = n * 2
        ->
          x: doubled : Integer
          y: "hello" as Text

      denseReturnInline
        =
        a : Integer
        b : Integer
        =
        sum : Integer = a + b
        ->(a : Integer, b : Integer, :sum : Integer, product: (a * b) as Integer)

      denseReturnMulti
        =
        n : Integer
        =
        doubled : Integer = n * 2
        ->(
          n : Integer,
          :doubled : Integer,
          label: "done" as Text
        )
    `);
  });

  it('multi-statement body', async () => {
    await expectActorReply({ actor, receive: { id: '1', op: '@multiStmt', from: 'c' }, reply: { id: '1', 'bv-a': { x: 'Integer' }, re: { x: 10 }, to: 'c' } });
  });

  it('lineal return (-> on own line, fields below)', async () => {
    await expectActorReply({ actor, receive: { id: '2', op: '@spaciousReturn', from: 'c' }, reply: { id: '2', 'bv-a': { a: 'Integer', b: 'Text' }, re: { a: 10, b: 'hello' }, to: 'c' } });
  });

  it('delimited return — single-line ->(…)', async () => {
    await expectActorReply({
      actor, receive: { id: '3', op: '@denseInline', from: 'c' },
      reply: { id: '3', 'bv-a': { p: 'Integer', q: 'Integer', sum: 'Integer', prod: 'Integer' }, re: { p: 3, q: 4, sum: 7, prod: 12 }, to: 'c' },
    });
  });

  it('delimited return — multiline ->(…)', async () => {
    await expectActorReply({
      actor, receive: { id: '4', op: '@denseMulti', from: 'c' },
      reply: { id: '4', 'bv-a': { v: 'Integer', doubled: 'Integer', lbl: 'Text' }, re: { v: 5, doubled: 10, lbl: 'done' }, to: 'c' },
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Composition
// ═══════════════════════════════════════════════════════════════════════════════

describe('lineal function — composition', () => {
  let actor;

  beforeAll(async () => {
    actor = await createActor(`
      @multiFn
        =
        result: a : Integer = double(5)
        result: b : Integer = triple(5)
        -> sum: (a + b) as Integer

      @crossCall
        =
        result: x : Integer = quad(5)
        -> :x

      @denseSpacious
        =
        fn = |a| { a + 1 }
        result: base : Integer = square(5)
        extra : Integer = fn(base)
        -> :extra

      double
        =
        n : Integer
        =
        -> result: (n * 2) as Integer

      triple
        =
        n : Integer
        =
        -> result: (n * 3) as Integer

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
        -> result: (n * n) as Integer
    `);
  });

  it('multiple lineal functions in same actor', async () => {
    await expectActorReply({ actor, receive: { id: '1', op: '@multiFn', from: 'c' }, reply: { id: '1', 'bv-a': { sum: 'Integer' }, re: { sum: 25 }, to: 'c' } });
  });

  it('lineal function calls another lineal function', async () => {
    await expectActorReply({ actor, receive: { id: '2', op: '@crossCall', from: 'c' }, reply: { id: '2', 'bv-a': { x: 'Integer' }, re: { x: 20 }, to: 'c' } });
  });

  it('lineal top-level + delimited lambda in public function', async () => {
    await expectActorReply({ actor, receive: { id: '3', op: '@denseSpacious', from: 'c' }, reply: { id: '3', 'bv-a': { extra: 'Integer' }, re: { extra: 26 }, to: 'c' } });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Silent function (. stop)
// ═══════════════════════════════════════════════════════════════════════════════

describe('lineal function — silent (. stop)', () => {
  it('side-effect-only function with dot', async () => {
    const actor = await createActor(`
      @go
        =
        spawn fire()
        -> answer: "ok" as Text

      fire
        =
        .
    `);
    await expectActorReply({ actor, receive: { id: '1', op: '@go', from: 'c' }, reply: { id: '1', 'bv-a': { answer: 'Text' }, re: { answer: 'ok' }, to: 'c' } });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Compile errors
// ═══════════════════════════════════════════════════════════════════════════════

describe('lineal function — compile errors', () => {
  it('assigning result of silent function is a compile error', () => {
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

  it('public and private function with same base name can coexist', () => {
    expect(() => compile(`
      @square
        =
        -> result: 0 as Integer

      square
        =
        num : Integer
        =
        ->(result: num as Integer)
    `)).not.toThrow();
  });

  it('missing second = delimiter throws', () => {
    expect(() => compile(`
      @go
        =
        result: x : Integer = double(5)
        -> :x

      double
        =
        n : Integer
        -> result: (n * 2) as Integer
    `)).toThrow();
  });

  it('// with content does not substitute for = delimiter', () => {
    expect(() => compile(`
      @go
        =
        result: x : Integer = inc(1)
        -> :x

      inc
        =
        n : Integer
        // done
        -> result: (n + 1) as Integer
    `)).toThrow();
  });

  it('-- with content does not substitute for = delimiter', () => {
    expect(() => compile(`
      @go
        =
        result: x : Integer = inc(1)
        -> :x

      inc
        =
        n : Integer
        -- done
        -> result: (n + 1) as Integer
    `)).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe('lineal function — edge cases', () => {
  it('result assigned as whole Structure, then destructured', async () => {
    const actor = await createActor(`
      @foo
        =
        s : Structure = square(10)
        result: x : Integer = s
        -> :x

      square
        =
        num : Integer
        =
        sq : Integer = num * num
        ->(result: sq : Integer)
    `);
    await expectActorReply({
      actor, receive: { id: '1', op: '@foo', from: 'caller' },
      reply: { id: '1', 'bv-a': { x: 'Integer' }, re: { x: 100 }, to: 'caller' },
    });
  });

  it('same function called twice with different args', async () => {
    const actor = await createActor(`
      @foo
        =
        result: a : Integer = square(3)
        result: b : Integer = square(4)
        -> sum: (a + b) as Integer

      square
        =
        num : Integer
        =
        sq : Integer = num * num
        ->(result: sq : Integer)
    `);
    await expectActorReply({
      actor, receive: { id: '1', op: '@foo', from: 'caller' },
      reply: { id: '1', 'bv-a': { sum: 'Integer' }, re: { sum: 25 }, to: 'caller' },
    });
  });

  it('plain assign from function returning 1 positional unwraps correctly', async () => {
    const actor = await createActor(`
      @test
        =
        a : Integer = getOne()
        -> result: a

      getOne
        =
        -> 42 as Integer
    `);
    await expectActorReply({
      actor, receive: { id: '1', op: '@test', from: 'caller' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 42 }, to: 'caller' },
    });
  });

  it('plain assign from function returning 2 positionals throws at runtime', async () => {
    const actor = await createActor(`
      @test
        =
        a : Integer = getTwo()
        -> result: a

      getTwo
        =
        ->(1 : Integer, 2 : Integer)
    `);
    await expectActorReply({
      actor, receive: { id: '1', op: '@test', from: 'caller' },
      reply: { id: '1', ex: { '@test': 'error' }, to: 'caller' },
    });
  });
});
