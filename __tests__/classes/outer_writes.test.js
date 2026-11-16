import { compileSource, expectBehavior } from '../helpers.js';

// A class closes over the actors it's declared in, as a closure closes over its
// enclosing scope. A read of an enclosing actor's cell is a message to that actor;
// so is a write (`total <- total + 1`, a `$set`) and a call to one of its functions.
// Only a `*` cell can be set. See notes/class-singleton-forms-2026-11-13.md.

const script = `
  total *Integer = 0
  @tally *Integer = 0

  helper = (x Integer) -> total + x
  @twice = (x Integer) -> x * 2
  inc! = { total <- total + 1 }

  @W = *{
    @bump! = { total <- total + 1 }
    @tally! = { @tally <- @tally + 5 }
    @readsOwnWrite! = {
      total <- total + 100
      return total
    }
    @viaHelper = {
      x Integer = helper(10)
      return x
    }
    @viaTwice = {
      x Integer = @twice(21)
      return x
    }
    @viaInc! = { inc!() }
  }

  @Made! = *{
    total <- total + 7
    seen Integer = helper(1)
    @seen = { return seen }
  }

  @Defaulted = (a Integer, b Integer = helper(a)) *{
    @b = { return b }
  }

  @Outer = *{
    n *Integer = 0
    #f = (x Integer) -> n + x

    In = *{
      @bump! = { n <- n + 1 }
      @f = {
        x Integer = #f(100)
        return x
      }
    }
    i = In()

    @bump! = { i.bump!() }
    @f = {
      x Integer = i.f()
      return x
    }
    @n = { return n }
  }

  @total = { return total }
`;

describe('a class writes its enclosing actor\'s cells', () => {
  it('writes a file cell', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '$new', to: ':W', from: 'c' } },
      { output: { id: '1', re: '#<:W:1>', ty: ':W', to: 'c' } },
      { input: { id: '2', op: 'bump!', to: ':W:1', from: 'c' } },
      { output: { id: '2', re: '#<:W:1>', ty: ':W', to: 'c', from: ':W:1' } },
      { input: { id: '3', op: 'total', from: 'c' } },
      { output: { id: '3', re: [1], ty: ['Integer'], to: 'c' } },
    );
  });

  it('writes a published file cell', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '$new', to: ':W', from: 'c' } },
      { output: { id: '1', re: '#<:W:1>', ty: ':W', to: 'c' } },
      { input: { id: '2', op: 'tally!', to: ':W:1', from: 'c' } },
      { output: { id: '2', re: '#<:W:1>', ty: ':W', to: 'c', from: ':W:1' } },
      { input: { id: '3', op: 'tally', from: 'c' } },
      { output: { id: '3', re: [5], ty: ['Integer'], to: 'c' } },
    );
  });

  it('reads its own write', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '$new', to: ':W', from: 'c' } },
      { output: { id: '1', re: '#<:W:1>', ty: ':W', to: 'c' } },
      { input: { id: '2', op: 'readsOwnWrite!', to: ':W:1', from: 'c' } },
      { output: { id: '2', re: [100], ty: ['Integer'], to: 'c', from: ':W:1' } },
    );
  });

  it('writes from its constructor block', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '$new', to: ':Made!', from: 'c' } },
      { output: { id: '1', re: '#<:Made!:1>', ty: ':Made!', to: 'c' } },
      { input: { id: '2', op: 'total', from: 'c' } },
      { output: { id: '2', re: [7], ty: ['Integer'], to: 'c' } },
    );
  });

  it('writes a cell of the class it\'s declared in', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '$new', to: ':Outer', from: 'c' } },
      { output: { id: '1', re: '#<:Outer:1>', ty: ':Outer', to: 'c' } },
      { input: { id: '2', op: 'bump!', to: ':Outer:1', from: 'c' } },
      { output: { id: '2', re: '#<:Outer:1>', ty: ':Outer', to: 'c', from: ':Outer:1' } },
      { input: { id: '3', op: 'n', to: ':Outer:1', from: 'c' } },
      { output: { id: '3', re: [1], ty: ['Integer'], to: 'c', from: ':Outer:1' } },
    );
  });
});

describe('a class calls its enclosing actor\'s functions', () => {
  it('calls a private file function', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '$new', to: ':W', from: 'c' } },
      { output: { id: '1', re: '#<:W:1>', ty: ':W', to: 'c' } },
      { input: { id: '2', op: 'viaHelper', to: ':W:1', from: 'c' } },
      { output: { id: '2', re: [10], ty: ['Integer'], to: 'c', from: ':W:1' } },
    );
  });

  it('calls a public file function', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '$new', to: ':W', from: 'c' } },
      { output: { id: '1', re: '#<:W:1>', ty: ':W', to: 'c' } },
      { input: { id: '2', op: 'viaTwice', to: ':W:1', from: 'c' } },
      { output: { id: '2', re: [42], ty: ['Integer'], to: 'c', from: ':W:1' } },
    );
  });

  it('calls a file function that writes', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '$new', to: ':W', from: 'c' } },
      { output: { id: '1', re: '#<:W:1>', ty: ':W', to: 'c' } },
      { input: { id: '2', op: 'viaInc!', to: ':W:1', from: 'c' } },
      { output: { id: '2', re: '#<:W:1>', ty: ':W', to: 'c', from: ':W:1' } },
      { input: { id: '3', op: 'total', from: 'c' } },
      { output: { id: '3', re: [1], ty: ['Integer'], to: 'c' } },
    );
  });

  it('calls from its constructor block, after its write', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '$new', to: ':Made!', from: 'c' } },
      { output: { id: '1', re: '#<:Made!:1>', ty: ':Made!', to: 'c' } },
      { input: { id: '2', op: 'seen', to: ':Made!:1', from: 'c' } },
      { output: { id: '2', re: [8], ty: ['Integer'], to: 'c', from: ':Made!:1' } },
    );
  });

  it('calls from a param default', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[3], '$new'], ty: [['Integer']], to: ':Defaulted', from: 'c' } },
      { output: { id: '1', re: '#<:Defaulted:1>', ty: ':Defaulted', to: 'c' } },
      { input: { id: '2', op: 'b', to: ':Defaulted:1', from: 'c' } },
      { output: { id: '2', re: [3], ty: ['Integer'], to: 'c', from: ':Defaulted:1' } },
    );
  });

  it('calls a private function of the class it\'s declared in', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '$new', to: ':Outer', from: 'c' } },
      { output: { id: '1', re: '#<:Outer:1>', ty: ':Outer', to: 'c' } },
      { input: { id: '2', op: 'bump!', to: ':Outer:1', from: 'c' } },
      { output: { id: '2', re: '#<:Outer:1>', ty: ':Outer', to: 'c', from: ':Outer:1' } },
      { input: { id: '3', op: 'f', to: ':Outer:1', from: 'c' } },
      { output: { id: '3', re: [101], ty: ['Integer'], to: 'c', from: ':Outer:1' } },
    );
  });
});

describe('a class can\'t set a cell that isn\'t `*`', () => {
  it('a file constant is a compile error', () => {
    expect(() => compileSource(`
      fixed = 5
      W = *{ @reset! = { fixed <- 2 } }
    `)).toThrow(/Cannot set 'fixed' — it's a cell of this file that isn't '\*'/);
  });

  it('a class constant is a compile error', () => {
    expect(() => compileSource(`
      A = *{
        k Integer = 1
        In = *{ @reset! = { k <- 2 } }
      }
    `)).toThrow(/Cannot set 'k' — it's a cell of 'A' that isn't '\*'/);
  });
});
