import { expectBehavior, createActor, expectActorBehavior, compileSource } from '../helpers.js';

// A constructor block returns no value: its result is the actor. A bare `return` ends
// construction there, and a value in the block projects nothing
// (notes/constructor-tail-and-ingest-retired-2026-11-26.md).

describe('return in a class constructor block', () => {
  const script = `
    @Box = (k Integer) *{
      n *Integer = 0
      if (k < 0) return
      n <- k
      if k > 100 {
        n <- 100
        return
      }
      n <- n + 1
      "a value here is a statement"
      @n = () -> n
      self as Integer = () -> k * 3
    }
  `;

  it('a bare return in an if ends construction, and the caller gets the actor', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[-1], '$new'], ty: [['Integer']], to: ':Box', from: 'c' } },
      { output: { id: '1', re: ['#<:Box:1>'], ty: [':Box'], to: 'c' } },
      { input: { id: '2', op: 'n', to: ':Box:1', from: 'c' } },
      { output: { id: '2', re: [0], ty: ['Integer'], to: 'c', from: ':Box:1' } },
    );
  });

  it('a return in a block branch, after a write there', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[500], '$new'], ty: [['Integer']], to: ':Box', from: 'c' } },
      { output: { id: '1', re: ['#<:Box:1>'], ty: [':Box'], to: 'c' } },
      { input: { id: '2', op: 'n', to: ':Box:1', from: 'c' } },
      { output: { id: '2', re: [100], ty: ['Integer'], to: 'c', from: ':Box:1' } },
    );
  });

  it('with no return taken, construction runs to the end', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[5], '$new'], ty: [['Integer']], to: ':Box', from: 'c' } },
      { output: { id: '1', re: ['#<:Box:1>'], ty: [':Box'], to: 'c' } },
      { input: { id: '2', op: 'n', to: ':Box:1', from: 'c' } },
      { output: { id: '2', re: [6], ty: ['Integer'], to: 'c', from: ':Box:1' } },
    );
  });

  it('a projection reads a constructor param; a value in the block projects nothing', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[5], '$new'], ty: [['Integer']], to: ':Box', from: 'c' } },
      { output: { id: '1', re: ['#<:Box:1>'], ty: [':Box'], to: 'c' } },
      { input: { id: '2', op: ['Integer', '$as'], to: ':Box:1', from: 'c' } },
      { output: { id: '2', re: [15], ty: ['Integer'], to: 'c', from: ':Box:1' } },
      { input: { id: '3', op: ['Text', '$as'], to: ':Box:1', from: 'c' } },
      { output: { id: '3', ex: { $as: 'unhandled' }, to: 'c', from: ':Box:1' } },
    );
  });
});

describe('return in a file constructor block', () => {
  const script = `
    *
      factor Integer
    *
    m *Integer = 0
    if (factor < 0) return
    m <- factor
    @m = () -> m
    self as Integer = () -> factor * 3
  `;

  it('runs to the end with no return taken; a projection reads the param', async () => {
    const actor = await createActor(script, { constructorArgs: { factor: 10 } });
    await expectActorBehavior(actor,
      { input: { id: '1', op: 'm', from: 'c' } },
      { output: { id: '1', re: [10], ty: ['Integer'], to: 'c' } },
      { input: { id: '2', op: ['Integer', '$as'], from: 'c' } },
      { output: { id: '2', re: [30], ty: ['Integer'], to: 'c' } },
    );
  });

  it('a bare return ends construction', async () => {
    const actor = await createActor(script, { constructorArgs: { factor: -1 } });
    await expectActorBehavior(actor,
      { input: { id: '1', op: 'm', from: 'c' } },
      { output: { id: '1', re: [0], ty: ['Integer'], to: 'c' } },
    );
  });
});

describe('return in a constructor block — compile errors', () => {
  const rule = "A constructor block returns no value: 'return' here stands alone";

  it('return with a value', () => {
    expect(() => compileSource(`
      @Box = *{
        n Integer = 1
        return n
      }
    `)).toThrow(rule);
  });

  it('return self', () => {
    expect(() => compileSource(`
      @Box = *{
        @n = () -> 1
        return self
      }
    `)).toThrow(rule);
  });

  it('return ()', () => {
    expect(() => compileSource(`
      @Box = *{
        @n = () -> 1
        return ()
      }
    `)).toThrow(rule);
  });

  it('return with a value in a branch', () => {
    expect(() => compileSource(`
      @Box = (k Integer) *{
        if (k < 0) return 0
        @n = () -> k
      }
    `)).toThrow(rule);
  });

  it('the file opener return with a value', () => {
    expect(() => compileSource(`
      *
        x Integer
      *
      return x
    `)).toThrow(rule);
  });

  it('`ingest` is not a form', () => {
    expect(() => compileSource(`
      @Base = *{
        label Text = ingest
        @label = () -> label
      }
    `)).toThrow();
  });

  it('a return before super leaves the base unbuilt', () => {
    expect(() => compileSource(`
      @Base = (n Integer) *{ @n = () -> n }
      @Sub = @Base ^ (k Integer) *{
        if (k < 0) return
        super(k * 10)
        @k = () -> k
      }
    `)).toThrow("'return' in '@Sub' leaves before 'super' builds the base");
  });
});

describe('return after super in a constructor block', () => {
  const script = `
    @Base = (n Integer) *{ @n = () -> n }
    @Sub = @Base ^ (k Integer) *{
      seen *Integer = 0
      if (k < 0) {
        super(0)
        return
      }
      super(k * 10)
      seen <- 1
      @seen = () -> seen
    }
  `;

  it('the base is built on the path that returns', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[-1], '$new'], ty: [['Integer']], to: ':Sub', from: 'c' } },
      { output: { id: '1', re: ['#<:Sub:1>'], ty: [':Sub'], to: 'c' } },
      { input: { id: '2', op: 'n', to: ':Sub:1', from: 'c' } },
      { output: { id: '2', re: [0], ty: ['Integer'], to: 'c', from: ':Sub:1' } },
      { input: { id: '3', op: 'seen', to: ':Sub:1', from: 'c' } },
      { output: { id: '3', re: [0], ty: ['Integer'], to: 'c', from: ':Sub:1' } },
      { input: { id: '4', op: [[2], '$new'], ty: [['Integer']], to: ':Sub', from: 'c' } },
      { output: { id: '4', re: ['#<:Sub:2>'], ty: [':Sub'], to: 'c' } },
      { input: { id: '5', op: 'n', to: ':Sub:2', from: 'c' } },
      { output: { id: '5', re: [20], ty: ['Integer'], to: 'c', from: ':Sub:2' } },
      { input: { id: '6', op: 'seen', to: ':Sub:2', from: 'c' } },
      { output: { id: '6', re: [1], ty: ['Integer'], to: 'c', from: ':Sub:2' } },
    );
  });
});
