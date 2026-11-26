import { expectBehavior } from '../helpers.js';

// A self-return is `re: ['#<:>']`, typed `:*`, `self::class`. The actor's host
// knows its class, so the reply leaves under the actor's address with the class's
// address as its type. A declared actor (a singleton, the file) knows its class is
// `*`, and says so itself. See notes/class-of-and-self-return-2026-11-23.md.

describe('a self-return, seen from outside', () => {
  const script = `
    @Box = *{
      n *Integer = 0
      @bump! = { n <- n + 1 }
      @pair = { return me: self, n: n }
    }

    A = *{
      @make = -> B()
    } ^ {
      B = *{
        k *Integer = 0
        @bump! = { k <- k + 1 }
      }
    }

    Outer = *{
      Inner = *{
        k *Integer = 0
        @bump! = { k <- k + 1 }
      }
      @make = -> Inner()
    }

    @s = actor {
      m *Integer = 0
      @bump! = { m <- m + 1 }
    }

    total *Integer = 0
    @bump! = { total <- total + 1 }

    @inBlock = {
      a = A()
      return a.make()
    }
    @inInstance = {
      o = Outer()
      return o.make()
    }
  `;

  it('from an instance: its address, typed with its class', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '$new', to: ':Box', from: 'c' } },
      { output: { id: '1', re: ['#<:Box:1>'], ty: [':Box'], to: 'c' } },
      { input: { id: '2', op: 'bump!', to: ':Box:1', from: 'c' } },
      { output: { id: '2', re: ['#<:Box:1>'], ty: [':Box'], to: 'c', from: ':Box:1' } },
    );
  });

  it('`self` in a slot beside another value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '$new', to: ':Box', from: 'c' } },
      { output: { id: '1', re: ['#<:Box:1>'], ty: [':Box'], to: 'c' } },
      { input: { id: '2', op: 'pair', to: ':Box:1', from: 'c' } },
      { output: { id: '2', re: [{ me: '#<:Box:1>', n: 0 }], ty: [{ me: ':Box', n: 'Integer' }], to: 'c', from: ':Box:1' } },
    );
  });

  it('from an instance of a class in a class block', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'inBlock', from: 'c' } },
      { output: { id: '1', re: ['#<:~A:~B:1>'], ty: [':~A:~B'], to: 'c' } },
      { input: { id: '2', op: 'bump!', to: ':~A:~B:1', from: 'c' } },
      { output: { id: '2', re: ['#<:~A:~B:1>'], ty: [':~A:~B'], to: 'c', from: ':~A:~B:1' } },
    );
  });

  it('from an instance of a class an instance declares', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'inInstance', from: 'c' } },
      { output: { id: '1', re: ['#<:~Outer:1:~Inner:1>'], ty: [':~Outer:1:~Inner'], to: 'c' } },
      { input: { id: '2', op: 'bump!', to: ':~Outer:1:~Inner:1', from: 'c' } },
      { output: { id: '2', re: ['#<:~Outer:1:~Inner:1>'], ty: [':~Outer:1:~Inner'], to: 'c', from: ':~Outer:1:~Inner:1' } },
    );
  });

  it('from a singleton: a declared actor, typed `*`', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'bump!', to: ':s', from: 'c' } },
      { output: { id: '1', re: ['#<:s>'], ty: ['*'], to: 'c', from: ':s' } },
    );
  });

  it('from the file: a declared actor, typed `*`', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'bump!', from: 'c' } },
      { output: { id: '1', re: ['#<:>'], ty: ['*'], to: 'c' } },
    );
  });
});
