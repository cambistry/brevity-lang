import { expectBehavior } from '../helpers.js';

// An `as` on a call's arg (`f(x as T)`) passes x as T, as `y = x as T; f(y)` does:
// an actor's projection to T. The arg is bound first (src/validate.js hoistArgAs).

describe('as in an argument', () => {
  const script = `
    use Svc = "svc.bv" as {
      take (Point) -> ()
      put (p: Point) -> ()
    }
    type Point(Integer, Integer)
    C = *(x Integer) { self as Point = () -> Point(x, x) }
    pass = (p Point) -> { Svc.take(p) }
    @inArg = {
      c = C(3)
      Svc.take(c as Point)
    }
    @bound = {
      c = C(4)
      q = c as Point
      Svc.take(q)
    }
    @named = {
      c = C(5)
      Svc.put(p: c as Point)
    }
    @own = {
      c = C(6)
      pass(c as Point)
    }
    @inBranch = (n Integer) -> {
      if (n > 0) {
        c = C(n)
        pass(c as Point)
      }
      return n
    }
  `;

  it("an actor's projection, passed as an arg", async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'inArg', from: 'c' } },
      { output: expect.objectContaining({ op: [[[3, 3]], 'take'], ty: [[':Point']], to: 'svc.bv' }) },
    );
  });

  it('the same as binding it first', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'bound', from: 'c' } },
      { output: expect.objectContaining({ op: [[[4, 4]], 'take'], ty: [[':Point']], to: 'svc.bv' }) },
    );
  });

  it('as a named arg', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'named', from: 'c' } },
      { output: expect.objectContaining({ op: [[{ p: [5, 5] }], 'put'], to: 'svc.bv' }) },
    );
  });

  it('to an own function', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'own', from: 'c' } },
      { output: expect.objectContaining({ op: [[[6, 6]], 'take'], ty: [[':Point']], to: 'svc.bv' }) },
    );
  });

  it('in a branch, where the branch runs', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[7], 'inBranch'], ty: [['Integer']], from: 'c' } },
      { output: expect.objectContaining({ op: [[[7, 7]], 'take'], ty: [[':Point']], to: 'svc.bv' }) },
      { input: { id: '2', op: [[0], 'inBranch'], ty: [['Integer']], from: 'c' } },
      { output: { id: '2', re: [0], ty: ['Integer'], to: 'c' } },
    );
  });
});
