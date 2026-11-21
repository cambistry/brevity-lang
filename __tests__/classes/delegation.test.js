import { expectBehavior } from '../helpers.js';

// A class block's functions aren't copied into the blocks that extend it. A call to a
// block for a name it doesn't define is delegated to its base with `as`: the base runs
// its own definition for that context, and each public or protected name it reaches
// resolves through the context's override table, an override or a redeclared cell
// being a callback to the block that sent it. A middle block resolves a callback for
// its extender or passes it on. `T.f()` named explicitly runs as the parent.
// See notes/opre-extend-and-as-2026-11-20.md ("as: a delegated call", "Grandparents").

const levels = `
  @T = *{} ^ {
    timeout *Integer = 30
    h = -> 1
    @connect = { x Integer = timeout * 10 + h(); return x }
    @bump! = { timeout <- timeout + 1 }
    @timeout = -> timeout
  }
  @V = @T ^ {
    h = -> 2
    @asParent = { x Integer = @T.connect(); return x }
  }
  @W = @V ^ {
    timeout *Integer = 5
  }
  @X = @W ^ {
    h = -> 3
  }
  @t = { x Integer = @T.connect(); return x }
  @v = { x Integer = @V.connect(); return x }
  @w = { x Integer = @W.connect(); return x }
  @x = { x Integer = @X.connect(); return x }
  @asParent = { x Integer = @V.asParent(); return x }
  @bumpW! = { @W.bump!(); a Integer = @W.timeout(); b Integer = @T.timeout(); return a * 100 + b }
`;

describe('delegated calls', () => {
  it('the parent runs its own definition for itself', async () => {
    await expectBehavior(levels,
      { input: { id: '1', op: 't', from: 'c' } },
      { output: { id: '1', re: [301], ty: ['Integer'], to: 'c' } },
    );
  });

  it("an inherited function run for the child sees the child's override", async () => {
    await expectBehavior(levels,
      { input: { id: '1', op: 'v', from: 'c' } },
      { output: { id: '1', re: [302], ty: ['Integer'], to: 'c' } },
    );
  });

  it('two levels: a redeclared cell below, an override in the middle', async () => {
    await expectBehavior(levels,
      { input: { id: '1', op: 'w', from: 'c' } },
      { output: { id: '1', re: [52], ty: ['Integer'], to: 'c' } },
    );
  });

  it('three levels, an override at each', async () => {
    await expectBehavior(levels,
      { input: { id: '1', op: 'x', from: 'c' } },
      { output: { id: '1', re: [53], ty: ['Integer'], to: 'c' } },
    );
  });

  it("the parent's code writes the cell the child redeclares, not its own", async () => {
    await expectBehavior(levels,
      { input: { id: '1', op: 'bumpW!', from: 'c' } },
      { output: { id: '1', re: [630], ty: ['Integer'], to: 'c' } },
    );
  });

  it('T.f() named explicitly from the child runs as the parent', async () => {
    await expectBehavior(levels,
      { input: { id: '1', op: 'asParent', from: 'c' } },
      { output: { id: '1', re: [301], ty: ['Integer'], to: 'c' } },
    );
  });
});

describe('delegated calls — the context', () => {
  it('an as naming a context no one registered fails', async () => {
    await expectBehavior(levels,
      { input: { id: '1', op: 'connect', to: ':T', from: 'c', as: 'elsewhere' } },
      { output: { id: '1', ex: { connect: 'unknown_context' }, to: 'c', from: ':T' } },
    );
  });

  it("an as from an actor that never extended fails, even its own address", async () => {
    await expectBehavior(levels,
      { input: { id: '1', op: 'connect', to: ':T', from: 'c', as: 'c' } },
      { output: { id: '1', ex: { connect: 'unknown_context' }, to: 'c', from: ':T' } },
    );
  });
});
