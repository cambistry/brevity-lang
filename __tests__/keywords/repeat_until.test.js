import { expectBehavior, compileSource } from '../helpers.js';

describe('repeat until', () => {
  const script = `
    @blockBody
      =
      x *Integer = 5
      repeat until x <= 0 {
        x <- x - 1
      }
      -> :x

    @singleLine
      =
      x *Integer = 3
      repeat until x <= 0 x <- x - 1
      -> :x

    @parenCondition
      =
      x *Integer = 4
      repeat until (x <= 0) {
        x <- x - 1
      }
      -> :x

    @accumulator
      =
      limit Integer
      =
      x *Integer = 0
      repeat until x >= limit {
        x <- x + 1
      }
      -> :x
  `;

  it('block body — repeat until x <= 0', async () => {
    await expectBehavior(script, { input: { id: '1', op: '@blockBody', from: 'c' } }, { output: { id: '1', 'bv-a': { x: 'Integer' }, re: { x: 0 }, to: 'c' } });
  });

  it('single-line body', async () => {
    await expectBehavior(script, { input: { id: '2', op: '@singleLine', from: 'c' } }, { output: { id: '2', 'bv-a': { x: 'Integer' }, re: { x: 0 }, to: 'c' } });
  });

  it('parenthesized condition', async () => {
    await expectBehavior(script, { input: { id: '3', op: '@parenCondition', from: 'c' } }, { output: { id: '3', 'bv-a': { x: 'Integer' }, re: { x: 0 }, to: 'c' } });
  });

  it('accumulator — repeat until x >= limit', async () => {
    await expectBehavior(script, { input: { id: '4', op: [[5], '@accumulator'], 'bv-a': [['Integer']], from: 'c' } }, { output: { id: '4', 'bv-a': { x: 'Integer' }, re: { x: 5 }, to: 'c' } });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tail-repeat as Void return — symmetrical to repeat_while.
// ═══════════════════════════════════════════════════════════════════════════════

describe('repeat until — tail repeat → Void (re: [])', () => {
  const script = `
    x *Integer = 0

    @publicTailBlock
      =
      x <- 3
      repeat until x <= 0 {
        x <- x - 1
      }

    @publicTailSingleLine
      =
      x <- 3
      repeat until x <= 0 x <- x - 1

    @callPrivateTailLambda
      =
      x <- 3
      fn = {
        repeat until x <= 0 {
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

  it('private lambda with tail repeat — call completes void', async () => {
    await expectBehavior(script, { input: { id: '3', op: '@callPrivateTailLambda', from: 'c' } }, { output: expect.objectContaining({ id: '3', re: { ack: 'ok' }, to: 'c' }) });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Compile errors — repeat is non-assignable.
// ═══════════════════════════════════════════════════════════════════════════════

describe('repeat until — compile errors (repeat is non-assignable)', () => {
  it('cannot bind a `repeat until` to a name', () => {
    expect(() => compileSource(`
      @test
        =
        x *Integer = 5
        y = repeat until x <= 0 { x <- x - 1 }
        -> :y
    `)).toThrow(/repeat|unexpected.*expression/i);
  });

  it('cannot use a `repeat until` as a reply field value', () => {
    expect(() => compileSource(`
      @test
        =
        x *Integer = 5
        -> result: (repeat until x <= 0 { x <- x - 1 })
    `)).toThrow(/repeat|unexpected.*expression/i);
  });

  it('cannot bind the result of a tail-repeat-until lambda (void)', () => {
    expect(() => compileSource(`
      @test
        =
        x *Integer = 5
        fn = {
          repeat until x <= 0 {
            x <- x - 1
          }
        }
        result = fn()
        -> :result
    `)).toThrow(/cannot.*bind|unassignable|\(\)/i);
  });
});
