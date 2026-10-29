import { expectBehavior } from '../helpers.js';

// Returning a sole Object-typed value returns it as the reply: its
// positional and named fields spread, exactly like `return ...r`. This makes
// `r Object = f(); return r` a transparent forward of f's reply (a typed
// Object bind takes the whole reply). Explicit and implicit forms agree.

describe('returning an Object spreads its fields', () => {
  const script = `
    g = (n Integer) { return x: n }
    f = (n Integer) { r Object = g(n); return r }
    fi = (n Integer) { r Object = g(n); r }

    @testReturn = { :x Integer = f(1); return result: x }

    @testImplicit = { :x Integer = fi(2); return result: x }

    @testLambda = {
      fl = () { r Object = g(3); r }
      :x Integer = fl()
      return result: x
    }

    fp = (r Object) { r }
    @testParam = {
      t Object = fp(Object(4, 5))
      return t
    }

    @testPositional = {
      r Object = Object(100, 200)
      return r
    }

    @testMixed = {
      r Object = Object(1, 2, x: "extra")
      return r
    }

    @testNotSole = {
      r Object = Object(100)
      return r, 7
    }
  `;

  const run = (op, re, input = {}) => expectBehavior(script,
    { input: { id: '1', op, from: 'c', ...input } },
    { output: expect.objectContaining({ id: '1', re, to: 'c' }) },
  );

  it('return r — names reach the caller', async () => { await run('@testReturn', { result: 1 }); });
  it('implicit r — names reach the caller', async () => { await run('@testImplicit', { result: 2 }); });
  it('implicit r in a lambda', async () => { await run('@testLambda', { result: 3 }); });
  it('an Object param returned whole', async () => {
    await run('@testParam', [4, 5]);
  });
  it('positional Object spreads its positionals', async () => { await run('@testPositional', [100, 200]); });
  it('mixed Object spreads both', async () => { await run('@testMixed', [1, 2, { x: 'extra' }]); });
  it('an Object among several values stays one value', async () => { await run('@testNotSole', [[100], 7]); });
});
