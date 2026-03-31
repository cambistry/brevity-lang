import { expectBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// ref + put (no shared state across tests)
// ═══════════════════════════════════════════════════════════════════════════════

describe('repeat while — ref + put', () => {
  const script = `
    @countdown
      =
      x *Integer = 5
      repeat while x > 0 {
        x <- x - 1
      }
      -> :x

    @parenCondition
      =
      x *Integer = 4
      repeat while (x > 0) {
        x <- x - 1
      }
      -> :x

    @singleLinePut
      =
      x *Integer = 3
      repeat while x > 0 x <- x - 1
      -> :x

    @nullNeverRuns
      =
      fn = {
        repeat while false { }
      } as Integer | null
      result Integer | null = fn()
      -> :result
  `;

  it('counts down with ref and put', async () => {
    await expectBehavior(script, { input: { id: '1', op: '@countdown', from: 'c' } }, { output: { id: '1', 'bv-a': { x: 'Integer' }, re: { x: 0 }, to: 'c' } });
  });

  it('parens around condition with block body', async () => {
    await expectBehavior(script, { input: { id: '2', op: '@parenCondition', from: 'c' } }, { output: { id: '2', 'bv-a': { x: 'Integer' }, re: { x: 0 }, to: 'c' } });
  });

  it('single-line put form', async () => {
    await expectBehavior(script, { input: { id: '3', op: '@singleLinePut', from: 'c' } }, { output: { id: '3', 'bv-a': { x: 'Integer' }, re: { x: 0 }, to: 'c' } });
  });

  it('at end of function returns null (block never runs)', async () => {
    await expectBehavior(script, { input: { id: '4', op: '@nullNeverRuns', from: 'c' } }, { output: { id: '4', 'bv-a': { result: 'Integer | null' }, re: { result: null }, to: 'c' } });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Stateful tests — actor-level ref state, shared fixture
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
    -> x, y as Integer

  @parenStateful
    =
    x <- 3
    repeat while (x > 0) {
      x <- x - 1
    }
    -> x as Integer

  @parenSingleLine
    =
    x <- 3
    repeat while (x > 0) x <- x - 1
    -> x as Integer

  @bareSingleLine
    =
    x <- 5
    repeat while x > 0 x <- x - 1
    -> x as Integer

  @lexicalBlock
    =
    step Integer
    =
    repeat while x < 9 {
      x <- x + step
    }
    -> x as Integer

  @lexicalSingleLine
    =
    limit Integer
    =
    repeat while x < limit x <- x + 1
    -> x as Integer

  @nullRuns
    =
    x <- 3
    fn = {
      repeat while x > 0 {
        x <- x - 1
      }
    } as Integer | null
    result Integer | null = fn()
    -> x, :result
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

describe('repeat while — evaluates to null (stateful)', () => {
  it('at end of function returns null (block runs)', async () => {
    await expectBehavior(statefulScript, { input: { id: '1', op: '@nullRuns', from: 'c' } }, { output: expect.objectContaining({ id: '1', re: [0, { result: null }], to: 'c' }) });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Compile errors
// ═══════════════════════════════════════════════════════════════════════════════

describe('repeat while — compile errors', () => {
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

  it('non-nullable return type from while → compile error', () => {
    expect(() => compileSource(`
      @test
        =
        fn = {
          repeat while false { }
        } as Integer
        result Integer = fn()
        -> :result
    `)).toThrow(/while always evaluates to null/i);
  });
});
