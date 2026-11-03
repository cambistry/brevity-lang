import { expectBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Silent public functions + type matching
// ═══════════════════════════════════════════════════════════════════════════════

describe('silent public functions + type matching', () => {
  const script = `
    --- silent public functions: inline and lineal forms ---

    @notify. = (msg: Text) {}

    @log.
      =
      info: Text
      =

    --- silence is per name: the silent and replying ops are distinct ---

    @overloaded. = (msg: Integer) {}
    @overloaded = (msg: Text) -> ack: "noted"

    --- replying function alongside silent ones ---

    @add = (a: Integer, b: Integer) -> sum: (a + b)

    --- spawn + silent private function ---

    @spawnTest!
      =
      spawn fire.()
      return answer: "ok"

    fire. = {}
  `;

  it('replying function still works alongside silent function', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [{ a: 3, b: 4 }, '@add'], 'ty': [{ a: 'Integer', b: 'Integer' }], from: 'c' } },
      { output: { id: '1', 'ty': { sum: 'Integer' }, re: { sum: 7 }, to: 'c' } },
    );
  });

  it('overloaded — Text message gets reply', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: [{ msg: 'hello' }, '@overloaded'], 'ty': [{ msg: 'Text' }], from: 'c' } },
      { output: { id: '2', 'ty': { ack: 'Text' }, re: { ack: 'noted' }, to: 'c' } },
    );
  });

  it('spawn + silent private function — reply ok', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: '@spawnTest!', from: 'c' } },
      { output: { id: '3', 'ty': { answer: 'Text' }, re: { answer: 'ok' }, to: 'c' } },
    );
  });

  it('type mismatch → unhandled', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: [{ msg: 42 }, '@notify.'], 'ty': [{ msg: 'Integer' }], from: 'c' } },
      { output: { id: '4', ex: { '@notify.': 'unhandled' }, to: 'c' } },
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
      { input: { id: '6', op: [{ msg: 'attention' }, '@notify.'], 'ty': [{ msg: 'Text' }], from: 'c' } },
      { input: { id: '7', op: [{ info: 'hello' }, '@log.'], 'ty': [{ info: 'Text' }], from: 'c' } },
      { input: { id: '8', op: [{ msg: 42 }, '@overloaded.'], 'ty': [{ msg: 'Integer' }], from: 'c' } },
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

    @store.
      =
      msg: Text
      =
      last <- msg

    @check
      =
      -> last: last

    --- lambdas: four syntactic forms ---

    @lambdaInline!
      =
      apply! = (x) ->  lastInt <- x .
      apply!(42)
      return lastInt
    @lambdaNextLine!
      =
      apply! = (x) ->  lastInt <- x
        .
      apply!(99)
      return lastInt
    @lambdaCurly!
      =
      apply! = (x) {
        a <- x
        b <- x + 1
        .
      }
      apply!(10)
      return a: a, b: b

    @lambdaCurlySingle!
      =
      apply! = (x) { a <- x . }
      apply!(77)
      return a: a
  `;

  it('dot on same line — store is silent, state persists', async () => {
    await expectBehavior(script,
      { input: { id: 's1', op: [{ msg: 'hello' }, '@store.'], 'ty': [{ msg: 'Text' }], from: 'c' } },
      { input: { id: 'c1', op: '@check', from: 'c' } },
      { output: expect.objectContaining({ id: 'c1', re: { last: 'hello' }, to: 'c' }) },
    );
  });

  it('lambda — inline same line', async () => {
    await expectBehavior(script,
      { input: { id: 'l1', op: '@lambdaInline!', from: 'c' } },
      { output: expect.objectContaining({ id: 'l1', re: [42], to: 'c' }) },
    );
  });

  it('lambda — inline next line', async () => {
    await expectBehavior(script,
      { input: { id: 'l2', op: '@lambdaNextLine!', from: 'c' } },
      { output: expect.objectContaining({ id: 'l2', re: [99], to: 'c' }) },
    );
  });

  it('lambda — curly brace body', async () => {
    await expectBehavior(script,
      { input: { id: 'l3', op: '@lambdaCurly!', from: 'c' } },
      { output: expect.objectContaining({ id: 'l3', re: { a: 10, b: 11 }, to: 'c' }) },
    );
  });

  it('lambda — curly brace single line', async () => {
    await expectBehavior(script,
      { input: { id: 'l4', op: '@lambdaCurlySingle!', from: 'c' } },
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

      @test!
        =
        spawn fire.()
        repeat while (x == 0) __tick__()
        return x
      fire.
        =
        x <- 1
    `;
    await expectBehavior(script,
      { input: { id: '1', op: '@test!', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [1], to: 'c' }) },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Empty lineal silent body: the blank line after `=` ends it
// ═══════════════════════════════════════════════════════════════════════════════

describe('silent function — empty lineal body', () => {
  const script = `
    @spaciousEmpty!
      =
      spawn fireEmpty.()
      return answer: "ok"

    fireEmpty.
      =

    @after = -> 1
  `;

  it('lineal private function — empty body is silent', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@spaciousEmpty!', from: 'c' } },
      { output: { id: '1', 'ty': { answer: 'Text' }, re: { answer: 'ok' }, to: 'c' } },
    );
  });

  it('`-> .` in a named function is an error naming the fix', () => {
    expect(() => compileSource(`
      fireArrow
        =
        -> .
      @go = -> 1
    `)).toThrow(/name it 'fireArrow\.' and drop the '\.'/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Compile errors
// ═══════════════════════════════════════════════════════════════════════════════

describe('silent function — compile errors', () => {
  it('calling silent private function without `...` → compile error', () => {
    expect(() => compileSource(`
      @test
        =
        fire.()
        return answer: "done"

      fire. = {}
    `)).toThrow(/'fire\.' is silent — call it 'fire\.\(…\)\.\.\.'/);
  });

  it('assigning result of silent private function → compile error', () => {
    expect(() => compileSource(`
      @test
        =
        result Integer = fire.()
        return result
      fire. = {}
    `)).toThrow(/'fire\.' is silent/);
  });

  it('assigning result of silent lambda → compile error', () => {
    expect(() => compileSource(`
      x *Integer = 0

      @test
        =
        apply! = (x) ->  x <- x .
        result Integer = apply!(42)
        return x
    `)).toThrow(/Cannot assign result of silent function/);
  });

  it('silent function used in expression → compile error', () => {
    expect(() => compileSource(`
      @test
        =
        x Integer = 1 + fire.()
        return :x

      fire. = {}
    `)).toThrow(/Silent function 'fire\.' cannot be used in an expression/);
  });

  it('silent function used as argument → compile error', () => {
    expect(() => compileSource(`
      @test
        =
        double = (n) ->  n * 2
        result Integer = double(fire.())
        return :result

      fire. = {}
    `)).toThrow(/Silent function 'fire\.' cannot be used as an argument/);
  });

  it('silent function used as return value → compile error', () => {
    expect(() => compileSource(`
      @test
        =
        -> fire.()

      fire. = {}
    `)).toThrow(/Silent function 'fire\.' cannot be used as a return value/);
  });
});
