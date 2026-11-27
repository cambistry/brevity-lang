import { expectBehavior } from '../helpers.js';

// Arithmetic on call results computes in the type it's assigned to: a reply has no
// type of its own until then. `x Integer = f() + g()`.

describe('arithmetic on untyped call results', () => {
  const script = `
    f = { 2 }
    g = { 3 }

    @own = {
      x Integer = f() + g() * f()
      return x
    }

    C = *{
      own = () -> 1
      @outer = {
        x Integer = f() + g()
        return x
      }
      @viaClass = {
        x Integer = class::h() - own() + C::h()
        return x
      }
    } ^ {
      h = () -> 4
    }

    @outer = {
      c = C()
      return c.outer()
    }

    @viaClass = {
      c = C()
      return c.viaClass()
    }
  `;

  it('own functions', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'own', from: 'c' } },
      { output: { id: '1', ty: ['Integer'], re: [8], to: 'c' } },
    );
  });

  it('an enclosing actor\'s functions, from a class', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'outer', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [5], to: 'c' }) },
    );
  });

  it('the class block\'s functions, through `class::` and `C::`', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'viaClass', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [7], to: 'c' }) },
    );
  });
});

// Where nothing types the operands (a call to a function that passes its untyped
// param back, or a recursive call, which doesn't type itself) or the result (a
// private function's reply), the runtime picks the arithmetic: an Integer past
// 64 bits stays whole.
describe('arithmetic on call results nothing types', () => {
  const script = `
    same = (x) -> x
    big = (n Integer) {
      if n > 0 { return big(n - 1) }
      return 9223372036854775807
    }

    sum = { return same(9223372036854775807) + same(1) }
    product = { return big(2) * big(1) }

    @passedBack = {
      x Integer = sum()
      return x
    }
    @recursive = {
      x Integer = product()
      return x
    }
  `;

  it('a function that passes its untyped param back', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'passedBack', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [9223372036854775808n], to: 'c' }) },
    );
  });

  it('a recursive function', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'recursive', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [85070591730234615847396907784232501249n], to: 'c' }) },
    );
  });
});
