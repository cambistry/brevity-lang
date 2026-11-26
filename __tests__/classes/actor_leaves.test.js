import { expectBehavior } from '../helpers.js';

// An actor built in-process (not through a `$new` message) goes out as its
// address the first time it leaves, under its class: whoever built it, it lives
// where its class is declared. Its type is its class's address.
// See notes/class-of-and-self-return-2026-11-23.md.

describe('an actor of a file class leaves the file', () => {
  const script = `
    @Box = *{
      n *Integer = 7
      @get = -> n
      @bump! = { n <- n + 1 }
    }
    C = *{ @get = -> 8 }

    @W = *{
      @make = -> @Box()
    }

    @one = {
      b = @Box()
      return b
    }
    @withValue = {
      b = @Box()
      return b, 1
    }
    @named = {
      b = @Box()
      return box: b
    }
    @typed = {
      b @Box = @Box()
      return b
    }
    @twice = {
      b = @Box()
      return first: b, again: b
    }
    @used = {
      b = @Box()
      b.bump!()
      return b
    }
    @private = {
      c = C()
      return c
    }
    @byAnInstance = {
      w = @W()
      return w.make()
    }
  `;

  it('as its address under its class, typed by its class', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'one', from: 'c' } },
      { output: { id: '1', re: ['#<:Box:1>'], ty: [':Box'], to: 'c' } },
    );
  });

  it('beside another value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'withValue', from: 'c' } },
      { output: { id: '1', re: ['#<:Box:1>', 1], ty: [':Box', 'Integer'], to: 'c' } },
    );
  });

  it('as a named value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'named', from: 'c' } },
      { output: { id: '1', re: [{ box: '#<:Box:1>' }], ty: [{ box: ':Box' }], to: 'c' } },
    );
  });

  it('bound with its class as its type', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'typed', from: 'c' } },
      { output: { id: '1', re: ['#<:Box:1>'], ty: [':Box'], to: 'c' } },
    );
  });

  it('once: the same actor is the same address', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'twice', from: 'c' } },
      { output: { id: '1', re: [{ first: '#<:Box:1>', again: '#<:Box:1>' }], ty: [{ first: ':Box', again: ':Box' }], to: 'c' } },
    );
  });

  it('each actor its own address', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'one', from: 'c' } },
      { output: { id: '1', re: ['#<:Box:1>'], ty: [':Box'], to: 'c' } },
      { input: { id: '2', op: 'one', from: 'c' } },
      { output: { id: '2', re: ['#<:Box:2>'], ty: [':Box'], to: 'c' } },
    );
  });

  it('and answers at that address, with the state it had', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'used', from: 'c' } },
      { output: { id: '1', re: ['#<:Box:1>'], ty: [':Box'], to: 'c' } },
      { input: { id: '2', op: 'get', to: ':Box:1', from: 'c' } },
      { output: { id: '2', re: [8], ty: ['Integer'], to: 'c', from: ':Box:1' } },
    );
  });

  it('of a protected class', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'private', from: 'c' } },
      { output: { id: '1', re: ['#<:~C:1>'], ty: [':~C'], to: 'c' } },
    );
  });

  it('built by an instance of another class: still under its own class', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'byAnInstance', from: 'c' } },
      { output: { id: '1', re: ['#<:Box:1>'], ty: [':Box'], to: 'c' } },
    );
  });
});

describe('an actor of a class declared in a class leaves the file', () => {
  const script = `
    A = *{
      @make = -> B()
    } ^ {
      B = *{
        n *Integer = 7
        @get = -> n
      }
    }

    Outer = (k Integer) *{
      Inner = *{ @get = -> k }
      @make = -> Inner()
    }

    @inBlock = {
      a = A()
      return a.make()
    }
    @theInstance = {
      a = A()
      return a
    }
    @inInstance = {
      o = Outer(5)
      return o.make()
    }
    @twoInstances = {
      o = Outer(1)
      p = Outer(2)
      return first: o.make(), second: p.make()
    }
  `;

  it('in a class block: under its class, whose class block declares it', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'inBlock', from: 'c' } },
      { output: { id: '1', re: ['#<:~A:~B:1>'], ty: [':~A:~B'], to: 'c' } },
      { input: { id: '2', op: 'get', to: ':~A:~B:1', from: 'c' } },
      { output: { id: '2', re: [7], ty: ['Integer'], to: 'c', from: ':~A:~B:1' } },
    );
  });

  it('the class with the block: under its class', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'theInstance', from: 'c' } },
      { output: { id: '1', re: ['#<:~A:1>'], ty: [':~A'], to: 'c' } },
    );
  });

  it('from an actor of ours answering a caller itself', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'theInstance', from: 'c' } },
      { output: { id: '1', re: ['#<:~A:1>'], ty: [':~A'], to: 'c' } },
      { input: { id: '2', op: 'make', to: ':~A:1', from: 'c' } },
      { output: { id: '2', re: ['#<:~A:~B:1>'], ty: [':~A:~B'], to: 'c', from: ':~A:1' } },
    );
  });

  it('in an instance body: under that instance, which is published with it', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'inInstance', from: 'c' } },
      { output: { id: '1', re: ['#<:~Outer:1:~Inner:1>'], ty: [':~Outer:1:~Inner'], to: 'c' } },
      { input: { id: '2', op: 'get', to: ':~Outer:1:~Inner:1', from: 'c' } },
      { output: { id: '2', re: [5], ty: ['Integer'], to: 'c', from: ':~Outer:1:~Inner:1' } },
    );
  });

  it('in an instance body: each instance its own class', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'twoInstances', from: 'c' } },
      { output: { id: '1', re: [{ first: '#<:~Outer:1:~Inner:1>', second: '#<:~Outer:2:~Inner:1>' }], ty: [{ first: ':~Outer:1:~Inner', second: ':~Outer:2:~Inner' }], to: 'c' } },
    );
  });
});

describe('an actor of ours leaves as an arg', () => {
  const script = `
    use Sink = "Sink" as { take (b: Actor) -> () }
    @Box = *{ @get = -> 7 }
    @W = *{
      @hand = {
        b = @Box()
        Sink.take(b: b)
        return 1
      }
    }
    @forward = {
      b = @Box()
      Sink.take(b: b)
      return b
    }
    @byAnInstance = {
      w = @W()
      x Integer = w.hand()
      return x
    }
  `;

  it('as its address and type, and the same one when it leaves again', async () => {
    await expectBehavior(script,
      { input: { id: '9', op: 'forward', from: 'c' } },
      { output: { id: '1', op: [[{ b: '#<:Box:1>' }], 'take'], ty: [[{ b: ':Box' }]], to: 'Sink' } },
      { input: { id: '1', re: [], from: 'Sink' } },
      { output: { id: '9', re: ['#<:Box:1>'], ty: [':Box'], to: 'c' } },
    );
  });

  it('from a send an actor of ours makes', async () => {
    await expectBehavior(script,
      { input: { id: '9', op: 'byAnInstance', from: 'c' } },
      { output: expect.objectContaining({ op: [[{ b: '#<:Box:1>' }], 'take'], ty: [[{ b: ':Box' }]], to: 'Sink' }) },
    );
  });
});
