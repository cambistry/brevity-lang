import { expectBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Silent public functions + type matching
// ═══════════════════════════════════════════════════════════════════════════════

describe('silent public functions + type matching', () => {
  const script = `
    --- silent public functions: inline and lineal forms ---

    @notify = (msg: Text) .

    @log
      =
      info: Text
      =
      .

    --- overloaded: silent for Integer, replying for Text ---

    @overloaded = (msg: Integer) .
    @overloaded << (msg: Text) -> ack: "noted"

    --- replying function alongside silent ones ---

    @add = (a: Integer, b: Integer) -> sum: (a + b)

    --- spawn + silent private function ---

    @spawnTest
      =
      spawn fire()
      -> answer: "ok"

    fire
      =
      .
  `;

  it('replying function still works alongside silent function', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [{ a: 3, b: 4 }, '@add'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'c' } },
      { output: { id: '1', 'bv-a': { sum: 'Integer' }, re: { sum: 7 }, to: 'c' } },
    );
  });

  it('overloaded — Text message gets reply', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: [{ msg: 'hello' }, '@overloaded'], 'bv-a': [{ msg: 'Text' }], from: 'c' } },
      { output: { id: '2', 'bv-a': { ack: 'Text' }, re: { ack: 'noted' }, to: 'c' } },
    );
  });

  it('spawn + silent private function — reply ok', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: '@spawnTest', from: 'c' } },
      { output: { id: '3', 'bv-a': { answer: 'Text' }, re: { answer: 'ok' }, to: 'c' } },
    );
  });

  it('type mismatch → unhandled', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: [{ msg: 42 }, '@notify'], 'bv-a': [{ msg: 'Integer' }], from: 'c' } },
      { output: { id: '4', ex: { '@notify': 'unhandled' }, to: 'c' } },
    );
  });

  it('unhandled op is still distinguished from silent function', async () => {
    await expectBehavior(script,
      { input: { id: '5', op: '@unknown', from: 'c' } },
      { output: { id: '5', ex: { '@unknown': 'unhandled' }, to: 'c' } },
    );
  });

  it.skip('silent messages produce no output', async () => {
    await expectBehavior(script,
      { input: { id: '6', op: [{ msg: 'attention' }, '@notify'], 'bv-a': [{ msg: 'Text' }], from: 'c' } },
      { input: { id: '7', op: [{ info: 'hello' }, '@log'], 'bv-a': [{ info: 'Text' }], from: 'c' } },
      { input: { id: '8', op: [{ msg: 42 }, '@overloaded'], 'bv-a': [{ msg: 'Integer' }], from: 'c' } },
      // is this testing anything?
      { output: [] },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Stateful silent functions + silent lambdas
// ═══════════════════════════════════════════════════════════════════════════════

describe('stateful silent functions + lambdas', () => {
  const script = `
    last *Text = ""
    lastInt *Integer = 0
    a *Integer = 0
    b *Integer = 0

    --- store: dot on same line as state mutation ---

    @store
      =
      msg: Text
      =
      last <- msg .

    @check
      =
      -> last: last

    --- lambdas: four syntactic forms ---

    @lambdaInline
      =
      apply = (x) ->  lastInt <- x .
      apply(42)
      -> lastInt
    @lambdaNextLine
      =
      apply = (x) ->  lastInt <- x
        .
      apply(99)
      -> lastInt
    @lambdaCurly
      =
      apply = (x) {
        a <- x
        b <- x + 1
        .
      }
      apply(10)
      -> a: a, b: b

    @lambdaCurlySingle
      =
      apply = (x) { a <- x . }
      apply(77)
      -> a: a
  `;

  it('dot on same line — store is silent, state persists', async () => {
    await expectBehavior(script,
      { input: { id: 's1', op: [{ msg: 'hello' }, '@store'], 'bv-a': [{ msg: 'Text' }], from: 'c' } },
      { input: { id: 'c1', op: '@check', from: 'c' } },
      { output: expect.objectContaining({ id: 'c1', re: { last: 'hello' }, to: 'c' }) },
    );
  });

  it('lambda — inline same line', async () => {
    await expectBehavior(script,
      { input: { id: 'l1', op: '@lambdaInline', from: 'c' } },
      { output: expect.objectContaining({ id: 'l1', re: [42], to: 'c' }) },
    );
  });

  it('lambda — inline next line', async () => {
    await expectBehavior(script,
      { input: { id: 'l2', op: '@lambdaNextLine', from: 'c' } },
      { output: expect.objectContaining({ id: 'l2', re: [99], to: 'c' }) },
    );
  });

  it('lambda — curly brace body', async () => {
    await expectBehavior(script,
      { input: { id: 'l3', op: '@lambdaCurly', from: 'c' } },
      { output: expect.objectContaining({ id: 'l3', re: { a: 10, b: 11 }, to: 'c' }) },
    );
  });

  it('lambda — curly brace single line', async () => {
    await expectBehavior(script,
      { input: { id: 'l4', op: '@lambdaCurlySingle', from: 'c' } },
      { output: expect.objectContaining({ id: 'l4', re: { a: 77 }, to: 'c' }) },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Side-effect spawn with busy-wait
// ═══════════════════════════════════════════════════════════════════════════════

describe('silent private — side-effect spawn with __tick__', () => {
  it('dot on same line — side-effect function sets state', async () => {
    const script = `
      x *Integer = 0

      @test
        =
        spawn fire()
        repeat while (x == 0) __tick__()
        -> x
      fire
        =
        x <- 1 .
    `;
    await expectBehavior(script,
      { input: { id: '1', op: '@test', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [1], to: 'c' }) },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// -> . synonym for . (arrow-dot silent terminator)
// ═══════════════════════════════════════════════════════════════════════════════

describe('silent function — -> . synonym', () => {
  const script = `
    @spaciousArrowDot
      =
      spawn fireArrow()
      -> answer: "ok"

    fireArrow
      =
      -> .
  `;

  it('lineal private function — -> . is silent', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@spaciousArrowDot', from: 'c' } },
      { output: { id: '1', 'bv-a': { answer: 'Text' }, re: { answer: 'ok' }, to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Compile errors
// ═══════════════════════════════════════════════════════════════════════════════

describe('silent function — compile errors', () => {
  it('calling silent private function without spawn → compile error', () => {
    expect(() => compileSource(`
      @test
        =
        fire()
        -> answer: "done"

      fire
        =
        .
    `)).toThrow(/Silent function invocation requires 'spawn'/);
  });

  it('assigning result of silent private function → compile error', () => {
    expect(() => compileSource(`
      @test
        =
        result Integer = fire()
        -> result
      fire
        =
        .
    `)).toThrow(/Silent function/);
  });

  it('assigning result of silent lambda → compile error', () => {
    expect(() => compileSource(`
      x *Integer = 0

      @test
        =
        apply = (x) ->  x <- x .
        result Integer = apply(42)
        -> x
    `)).toThrow(/Cannot assign result of silent function/);
  });

  it('silent function used in expression → compile error', () => {
    expect(() => compileSource(`
      @test
        =
        x Integer = 1 + fire()
        -> :x

      fire
        =
        .
    `)).toThrow(/Silent function 'fire' cannot be used in an expression/);
  });

  it('silent function used as argument → compile error', () => {
    expect(() => compileSource(`
      @test
        =
        double = (n) ->  n * 2
        result Integer = double(fire())
        -> :result

      fire
        =
        .
    `)).toThrow(/Silent function 'fire' cannot be used as an argument/);
  });

  it('silent function used as return value → compile error', () => {
    expect(() => compileSource(`
      @test
        =
        -> fire()

      fire
        =
        .
    `)).toThrow(/Silent function 'fire' cannot be used as a return value/);
  });
});
