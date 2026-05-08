import { expectBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Stateful tests — actor-level ref state, shared fixture.
// Each handler explicitly replies AFTER the loop, so the wire form is the
// reply, not the loop result.
// ═══════════════════════════════════════════════════════════════════════════════

const statefulScript = `
  x *Integer = 0
  y *Integer = 0

  @drain
    =
    x <- 10
    repeat while x > 0 {
      x <- x - 1
      y <- y + 1
    }
    -> x, y

  @parenStateful
    =
    x <- 3
    repeat while (x > 0) {
      x <- x - 1
    }
    -> x

  @parenSingleLine
    =
    x <- 3
    repeat while (x > 0) x <- x - 1
    -> x

  @bareSingleLine
    =
    x <- 5
    repeat while x > 0 x <- x - 1
    -> x

  @lexicalBlock
    =
    step Integer
    =
    repeat while x < 9 {
      x <- x + step
    }
    -> x

  @lexicalSingleLine
    =
    limit Integer
    =
    repeat while x < limit x <- x + 1
    -> x
`;

describe('repeat while — state mutation loop', () => {
  it('drains x to 0 and accumulates y to 10', async () => {
    await expectBehavior(statefulScript, { input: { id: '1', op: '@drain', from: 'c' } }, { output: expect.objectContaining({ id: '1', re: [0, 10], to: 'c' }) });
  });
});

describe('repeat while — parenthesized condition (stateful)', () => {
  it('parens around condition with block body', async () => {
    await expectBehavior(statefulScript, { input: { id: '1', op: '@parenStateful', from: 'c' } }, { output: expect.objectContaining({ id: '1', re: [0], to: 'c' }) });
  });

  it('parens around condition with single-line body', async () => {
    await expectBehavior(statefulScript, { input: { id: '1', op: '@parenSingleLine', from: 'c' } }, { output: expect.objectContaining({ id: '1', re: [0], to: 'c' }) });
  });
});

describe('repeat while — single-line body (stateful)', () => {
  it('bare condition with single-line put', async () => {
    await expectBehavior(statefulScript, { input: { id: '1', op: '@bareSingleLine', from: 'c' } }, { output: expect.objectContaining({ id: '1', re: [0], to: 'c' }) });
  });
});

describe('repeat while — lexical scope', () => {
  it('reads and writes actor state inside block body', async () => {
    await expectBehavior(statefulScript, { input: { id: '1', op: [[3], '@lexicalBlock'], 'bv-a': [['Integer']], from: 'c' } }, { output: expect.objectContaining({ id: '1', re: [9], to: 'c' }) });
  });

  it('reads and writes actor state inside single-line body', async () => {
    await expectBehavior(statefulScript, { input: { id: '1', op: [[5], '@lexicalSingleLine'], 'bv-a': [['Integer']], from: 'c' } }, { output: expect.objectContaining({ id: '1', re: [5], to: 'c' }) });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tail-repeat as Void return — a function whose tail is `repeat …` answers
// `re: []` on the wire (loops yield no value). Works for public handlers and
// private lambdas alike. The loop runs for its side effects; the void return
// is implicit.
// ═══════════════════════════════════════════════════════════════════════════════

describe('repeat while — tail repeat → Void (re: [])', () => {
  const script = `
    x *Integer = 0

    @publicTailBlock
      =
      x <- 3
      repeat while x > 0 {
        x <- x - 1
      }

    @publicTailSingleLine
      =
      x <- 3
      repeat while x > 0 x <- x - 1

    @publicTailParen
      =
      x <- 3
      repeat while (x > 0) {
        x <- x - 1
      }

    @callPrivateTailLambda
      =
      x <- 3
      fn = {
        repeat while x > 0 {
          x <- x - 1
        }
      }
      fn()
      -> ack: "ok"
  `;

  it('public handler, tail repeat block — re: []', async () => {
    await expectBehavior(script, { input: { id: '1', op: '@publicTailBlock', from: 'c' } }, { output: expect.objectContaining({ id: '1', re: [], to: 'c' }) });
  });

  it('public handler, tail repeat single-line — re: []', async () => {
    await expectBehavior(script, { input: { id: '2', op: '@publicTailSingleLine', from: 'c' } }, { output: expect.objectContaining({ id: '2', re: [], to: 'c' }) });
  });

  it('public handler, tail repeat with parenthesized cond — re: []', async () => {
    await expectBehavior(script, { input: { id: '3', op: '@publicTailParen', from: 'c' } }, { output: expect.objectContaining({ id: '3', re: [], to: 'c' }) });
  });

  it('private lambda with tail repeat — call completes void', async () => {
    await expectBehavior(script, { input: { id: '4', op: '@callPrivateTailLambda', from: 'c' } }, { output: expect.objectContaining({ id: '4', re: { ack: 'ok' }, to: 'c' }) });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Compile errors — repeat is unassignable. Like the bare `()` literal, it
// cannot appear in expression position. The implicit-tail return is a
// "nothing here" report on the wire, not a value.
// ═══════════════════════════════════════════════════════════════════════════════

describe('repeat while — compile errors (repeat is non-assignable)', () => {
  it('plain assignment to outer-scope variable in block body → compile error', () => {
    expect(() => compileSource(`
      @test
        =
        x Integer = 0
        repeat while true {
          x = 1
        }
        -> :x
    `)).toThrow(/re-bind.*'x'|'x'.*re-bind|cannot re-bind/i);
  });

  it('plain assignment to outer-scope variable in single-line body → compile error', () => {
    expect(() => compileSource(`
      @test
        =
        x Integer = 0
        repeat while true x = 1
        -> :x
    `)).toThrow(/re-bind.*'x'|'x'.*re-bind|cannot re-bind/i);
  });

  it('cannot bind a `repeat` to a name (RHS of `=`)', () => {
    expect(() => compileSource(`
      @test
        =
        x *Integer = 5
        y = repeat while x > 0 { x <- x - 1 }
        -> :y
    `)).toThrow(/repeat|unexpected.*expression/i);
  });

  it('cannot wrap a `repeat` in parens as an expression value', () => {
    expect(() => compileSource(`
      @test
        =
        x *Integer = 5
        -> result: (repeat while x > 0 { x <- x - 1 })
    `)).toThrow(/repeat|unexpected.*expression/i);
  });

  it('cannot use a `repeat` as a function argument', () => {
    expect(() => compileSource(`
      noop = (a) -> a
      @test
        =
        x *Integer = 5
        result = noop(repeat while x > 0 { x <- x - 1 })
        -> :result
    `)).toThrow(/repeat|unexpected.*expression/i);
  });

  it('cannot bind the result of a tail-repeat lambda (void)', () => {
    expect(() => compileSource(`
      @test
        =
        x *Integer = 5
        fn = {
          repeat while x > 0 {
            x <- x - 1
          }
        }
        result = fn()
        -> :result
    `)).toThrow(/cannot.*bind|unassignable|\(\)/i);
  });
});
