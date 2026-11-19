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
      own = -> 1
      @outer = {
        x Integer = f() + g()
        return x
      }
      @viaClass = {
        x Integer = class::h() - own() + C::h()
        return x
      }
    } ^ {
      h = -> 4
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
