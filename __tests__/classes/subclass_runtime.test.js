import { expectBehavior } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Subclass consumption — runtime behavior across targets
//
// Compile-time discipline is covered by subclass_consumption.test.js. This file
// asserts that the runtime dispatch actually produces the right value on every
// target, so any future parity drift between js / erlang / rust is caught.
// Synthetic domain-neutral types.
// ═══════════════════════════════════════════════════════════════════════════════

describe('subclass runtime — inherited method on subclass value', () => {
  const script = `
    T = (x Integer) *{
      @a = -> result: x as Integer
    }
    U = (T ++ y Integer) *{
      @b = -> result: y as Integer
    }

    @callInherited
      =
      u = U(11, 13)
      :result Integer = u.a()
      return :result as Integer

    @callOwn
      =
      u = U(11, 13)
      :result Integer = u.b()
      return :result as Integer
  `;

  it('inherited method returns the superclass-declared value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'callInherited', from: 'c' } },
      { output: { id: '1', 'ty': { result: 'Integer' }, re: { result: 11 }, to: 'c' } },
    );
  });

  it('own method returns the subclass-declared value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'callOwn', from: 'c' } },
      { output: { id: '1', 'ty': { result: 'Integer' }, re: { result: 13 }, to: 'c' } },
    );
  });
});

// Static narrowing (`u T = U(...)`) is exercised at compile time in
// subclass_consumption.test.js (the validator rejects subclass-only method
// calls on a superclass-narrowed value). The runtime currently rejects the
// narrowed assignment itself with an unrelated error, so that combination
// is not asserted here.

describe('subclass runtime — override fires on the subclass actor', () => {
  // U overrides @a. A direct call on a U actor runs U's implementation,
  // even though @a is also defined on the superclass.
  const script = `
    T = * {
      @a = -> result: 1
    }
    U = (T++) *{
      @a = -> result: 2
    }

    @superCall
      =
      t = T()
      :result Integer = t.a()
      return :result as Integer

    @subCall
      =
      u = U()
      :result Integer = u.a()
      return :result as Integer
  `;

  it('superclass actor runs superclass @a', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'superCall', from: 'c' } },
      { output: { id: '1', 'ty': { result: 'Integer' }, re: { result: 1 }, to: 'c' } },
    );
  });

  it('subclass actor runs subclass override of @a', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'subCall', from: 'c' } },
      { output: { id: '1', 'ty': { result: 'Integer' }, re: { result: 2 }, to: 'c' } },
    );
  });
});

describe('subclass runtime — inherited method that writes the superclass\'s state', () => {
  it('writes the subclass actor\'s own copy', async () => {
    await expectBehavior(`
      Counter = *{
        a *Integer = 0
        @add! = (i Integer) { a <- a + i }
        @get = { return a }
      }

      Sub = (Counter++) *{
        @more = { return 10 }
      }

      @go = {
        s = Sub()
        s.add!(4)
        n Integer = s.get()
        return n
      }
    `,
      { input: { id: '1', op: 'go', from: 'c' } },
      { output: { id: '1', re: [4], 'ty': ['Integer'], to: 'c' } },
    );
  });
});

describe('subclass runtime — inherited state', () => {
  const COUNTER = `
    Counter = *{
      a *Integer = 0
      @add! = (i Integer) { a <- a + i }
      @get = { return a }
    }
  `;

  it('each subclass actor has its own copy', async () => {
    await expectBehavior(`${COUNTER}
      Sub = (Counter++) *{}

      @go = {
        s = Sub()
        t = Sub()
        s.add!(4)
        t.add!(5)
        x Integer = s.get()
        y Integer = t.get()
        return x * 10 + y
      }
    `,
      { input: { id: '1', op: 'go', from: 'c' } },
      { output: { id: '1', re: [45], 'ty': ['Integer'], to: 'c' } },
    );
  });

  it('reaches through a grandparent', async () => {
    await expectBehavior(`${COUNTER}
      Mid = (Counter++) *{}
      Leaf = (Mid++) *{}

      @go = {
        s = Leaf()
        s.add!(4)
        n Integer = s.get()
        return n
      }
    `,
      { input: { id: '1', op: 'go', from: 'c' } },
      { output: { id: '1', re: [4], 'ty': ['Integer'], to: 'c' } },
    );
  });

  it('starts from the value the subclass declares', async () => {
    await expectBehavior(`${COUNTER}
      Sub = (Counter++) *{
        a *Integer = 100
      }

      @go = {
        s = Sub()
        s.add!(4)
        n Integer = s.get()
        return n
      }
    `,
      { input: { id: '1', op: 'go', from: 'c' } },
      { output: { id: '1', re: [104], 'ty': ['Integer'], to: 'c' } },
    );
  });

  it('the nearest class\'s value wins through a chain', async () => {
    await expectBehavior(`${COUNTER}
      Mid = (Counter++) *{
        a *Integer = 50
      }
      Leaf = (Mid++) *{}

      @go = {
        s = Leaf()
        s.add!(4)
        n Integer = s.get()
        return n
      }
    `,
      { input: { id: '1', op: 'go', from: 'c' } },
      { output: { id: '1', re: [54], 'ty': ['Integer'], to: 'c' } },
    );
  });

  it('the parent\'s constructor body runs before the subclass\'s', async () => {
    await expectBehavior(`
      Counter = *{
        a *Integer = 2
      }
      Sub = (Counter++) *{
        b *Integer = a * 10
        @get = { return b }
      }

      @go = {
        s = Sub()
        n Integer = s.get()
        return n
      }
    `,
      { input: { id: '1', op: 'go', from: 'c' } },
      { output: { id: '1', re: [20], 'ty': ['Integer'], to: 'c' } },
    );
  });

  it('an ingest slot and ordinary state coexist', async () => {
    await expectBehavior(`
      Base = *{
        label Integer = ingest
        n *Integer = 3
        @sum = { return label + n }
      }
      Sub = (Base++) *{ 40 }

      @go = {
        s = Sub()
        v Integer = s.sum()
        return v
      }
    `,
      { input: { id: '1', op: 'go', from: 'c' } },
      { output: { id: '1', re: [43], 'ty': ['Integer'], to: 'c' } },
    );
  });

  it('a subclass method reads the inherited state', async () => {
    await expectBehavior(`${COUNTER}
      Sub = (Counter++) *{
        @twice = { return a * 2 }
      }

      @go = {
        s = Sub()
        s.add!(4)
        n Integer = s.twice()
        return n
      }
    `,
      { input: { id: '1', op: 'go', from: 'c' } },
      { output: { id: '1', re: [8], 'ty': ['Integer'], to: 'c' } },
    );
  });

  it('a published state field is inherited', async () => {
    await expectBehavior(`
      Counter = *{
        @a *Integer = 3
      }
      Sub = (Counter++) *{}

      @go = {
        s = Sub()
        x Integer = s.a()
        s.a <- 9
        y Integer = s.a()
        return x * 10 + y
      }
    `,
      { input: { id: '1', op: 'go', from: 'c' } },
      { output: { id: '1', re: [39], 'ty': ['Integer'], to: 'c' } },
    );
  });

  it('a state param of the parent still seeds the copy', async () => {
    await expectBehavior(`
      Counter = (n Integer) *{
        a *Integer = n
        @get = { return a }
      }
      Sub = (Counter++) *{}

      @go = {
        s = Sub(7)
        v Integer = s.get()
        return v
      }
    `,
      { input: { id: '1', op: 'go', from: 'c' } },
      { output: { id: '1', re: [7], 'ty': ['Integer'], to: 'c' } },
    );
  });
});
