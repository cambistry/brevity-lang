import { compileSource, expectBehavior } from '../helpers.js';

// What a class's actors reach, nested and trailing, and what a closure in a class
// reaches. Two mechanisms:
//
// - Qualified access, `C.x`: a public member of the class block, from the class's
//   actors. The same in both forms: read, written and called, from the constructor
//   block, a method, and a closure in a method. After a dot a name is public; a
//   protected or private member, or a name the block doesn't declare, is an error.
// - Closure, a bare name: lexical. The nested constructor is inside the class block,
//   so it closes over every member, private ones included, and a member shadows a
//   name of the actor the class is declared in. The trailing constructor isn't, so it
//   closes over only that actor. A closure or lambda in a class reaches every name of
//   the actors the class is declared in.
//
// See notes/class-scope-and-inheritance-2026-11-16.md and
// notes/private-names-lexical-2026-11-16.md.

const script = `
  total *Integer = 7

  @Nested = actor {
    @pub *Integer = 1
    prot *Integer = 2
    total *Integer = 50
    #priv = () -> 3
    @pubFn = () -> 10
    protFn = () -> 20

    new = *(seed Integer) {
      built Integer = @Nested.pub + seed
      @built = { return built }
      @rPub = { return @Nested.pub }
      @cPubFn = {
        x Integer = @Nested.pubFn()
        return x
      }
      @setPub! = { @Nested.pub <- 5 }
      @updatePub! = { @Nested.pub <| 9 }
      @closure = {
        f = () -> @Nested.pub + 1
        x Integer = f()
        return x
      }
      @total = { return total }
      @bare = {
        x Integer = @pub + prot + #priv() + @pubFn() + protFn()
        return x
      }
      @bareClosure = {
        f = () -> prot + #priv()
        x Integer = f()
        return x
      }
      @bareSet! = { prot <- 8 }
      @rProt = { return prot }
    }
  }

  @Trailing = *(seed Integer) {
    built Integer = @Trailing.pub + seed
    @built = { return built }
    @rPub = { return @Trailing.pub }
    @cPubFn = {
      x Integer = @Trailing.pubFn()
      return x
    }
    @setPub! = { @Trailing.pub <- 5 }
    @updatePub! = { @Trailing.pub <| 9 }
    @closure = {
      f = () -> @Trailing.pub + 1
      x Integer = f()
      return x
    }
    @total = { return total }
  } ^ {
    @pub *Integer = 1
    prot *Integer = 2
    total *Integer = 50
    #priv = () -> 3
    @pubFn = () -> 10
    protFn = () -> 20
  }

  @Setter! = *(seed Integer) {
    @Setter.pub <- seed
  } ^ {
    @pub *Integer = 0
  }
`;

describe('class scope — a public member through the class, nested', () => {
  it('a cell, from a method', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[1], '$new'], ty: [['Integer']], to: ':Nested', from: 'c' } },
      { output: { id: '1', re: ['#<:Nested:1>'], ty: [':Nested'], to: 'c' } },
      { input: { id: '2', op: 'rPub', to: ':Nested:1', from: 'c' } },
      { output: { id: '2', re: [1], ty: ['Integer'], to: 'c', from: ':Nested:1' } },
    );
  });

  it('a cell, from the constructor block', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[4], '$new'], ty: [['Integer']], to: ':Nested', from: 'c' } },
      { output: { id: '1', re: ['#<:Nested:1>'], ty: [':Nested'], to: 'c' } },
      { input: { id: '2', op: 'built', to: ':Nested:1', from: 'c' } },
      { output: { id: '2', re: [5], ty: ['Integer'], to: 'c', from: ':Nested:1' } },
    );
  });

  it('a cell, from a closure in a method', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[1], '$new'], ty: [['Integer']], to: ':Nested', from: 'c' } },
      { output: { id: '1', re: ['#<:Nested:1>'], ty: [':Nested'], to: 'c' } },
      { input: { id: '2', op: 'closure', to: ':Nested:1', from: 'c' } },
      { output: { id: '2', re: [2], ty: ['Integer'], to: 'c', from: ':Nested:1' } },
    );
  });

  it('a function', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[1], '$new'], ty: [['Integer']], to: ':Nested', from: 'c' } },
      { output: { id: '1', re: ['#<:Nested:1>'], ty: [':Nested'], to: 'c' } },
      { input: { id: '2', op: 'cPubFn', to: ':Nested:1', from: 'c' } },
      { output: { id: '2', re: [10], ty: ['Integer'], to: 'c', from: ':Nested:1' } },
    );
  });
});

describe('class scope — a public member through the class, trailing', () => {
  it('a cell, from a method', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[1], '$new'], ty: [['Integer']], to: ':Trailing', from: 'c' } },
      { output: { id: '1', re: ['#<:Trailing:1>'], ty: [':Trailing'], to: 'c' } },
      { input: { id: '2', op: 'rPub', to: ':Trailing:1', from: 'c' } },
      { output: { id: '2', re: [1], ty: ['Integer'], to: 'c', from: ':Trailing:1' } },
    );
  });

  it('a cell, from the constructor block', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[4], '$new'], ty: [['Integer']], to: ':Trailing', from: 'c' } },
      { output: { id: '1', re: ['#<:Trailing:1>'], ty: [':Trailing'], to: 'c' } },
      { input: { id: '2', op: 'built', to: ':Trailing:1', from: 'c' } },
      { output: { id: '2', re: [5], ty: ['Integer'], to: 'c', from: ':Trailing:1' } },
    );
  });

  it('a cell, from a closure in a method', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[1], '$new'], ty: [['Integer']], to: ':Trailing', from: 'c' } },
      { output: { id: '1', re: ['#<:Trailing:1>'], ty: [':Trailing'], to: 'c' } },
      { input: { id: '2', op: 'closure', to: ':Trailing:1', from: 'c' } },
      { output: { id: '2', re: [2], ty: ['Integer'], to: 'c', from: ':Trailing:1' } },
    );
  });

  it('a function', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[1], '$new'], ty: [['Integer']], to: ':Trailing', from: 'c' } },
      { output: { id: '1', re: ['#<:Trailing:1>'], ty: [':Trailing'], to: 'c' } },
      { input: { id: '2', op: 'cPubFn', to: ':Trailing:1', from: 'c' } },
      { output: { id: '2', re: [10], ty: ['Integer'], to: 'c', from: ':Trailing:1' } },
    );
  });
});

describe('class scope — a public cell written through the class, and every actor sees it', () => {
  it('nested: <-', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[1], '$new'], ty: [['Integer']], to: ':Nested', from: 'c' } },
      { output: { id: '1', re: ['#<:Nested:1>'], ty: [':Nested'], to: 'c' } },
      { input: { id: '2', op: [[1], '$new'], ty: [['Integer']], to: ':Nested', from: 'c' } },
      { output: { id: '2', re: ['#<:Nested:2>'], ty: [':Nested'], to: 'c' } },
      { input: { id: '3', op: 'setPub!', to: ':Nested:1', from: 'c' } },
      { output: { id: '3', re: ['#<:Nested:1>'], ty: [':Nested'], to: 'c', from: ':Nested:1' } },
      { input: { id: '4', op: 'rPub', to: ':Nested:2', from: 'c' } },
      { output: { id: '4', re: [5], ty: ['Integer'], to: 'c', from: ':Nested:2' } },
    );
  });

  it('trailing: <-', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[1], '$new'], ty: [['Integer']], to: ':Trailing', from: 'c' } },
      { output: { id: '1', re: ['#<:Trailing:1>'], ty: [':Trailing'], to: 'c' } },
      { input: { id: '2', op: [[1], '$new'], ty: [['Integer']], to: ':Trailing', from: 'c' } },
      { output: { id: '2', re: ['#<:Trailing:2>'], ty: [':Trailing'], to: 'c' } },
      { input: { id: '3', op: 'setPub!', to: ':Trailing:1', from: 'c' } },
      { output: { id: '3', re: ['#<:Trailing:1>'], ty: [':Trailing'], to: 'c', from: ':Trailing:1' } },
      { input: { id: '4', op: 'rPub', to: ':Trailing:2', from: 'c' } },
      { output: { id: '4', re: [5], ty: ['Integer'], to: 'c', from: ':Trailing:2' } },
    );
  });

  it('nested: <|', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[1], '$new'], ty: [['Integer']], to: ':Nested', from: 'c' } },
      { output: { id: '1', re: ['#<:Nested:1>'], ty: [':Nested'], to: 'c' } },
      { input: { id: '2', op: 'updatePub!', to: ':Nested:1', from: 'c' } },
      { output: { id: '2', re: ['#<:Nested:1>'], ty: [':Nested'], to: 'c', from: ':Nested:1' } },
      { input: { id: '3', op: 'rPub', to: ':Nested:1', from: 'c' } },
      { output: { id: '3', re: [9], ty: ['Integer'], to: 'c', from: ':Nested:1' } },
    );
  });

  it('trailing: <|', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[1], '$new'], ty: [['Integer']], to: ':Trailing', from: 'c' } },
      { output: { id: '1', re: ['#<:Trailing:1>'], ty: [':Trailing'], to: 'c' } },
      { input: { id: '2', op: 'updatePub!', to: ':Trailing:1', from: 'c' } },
      { output: { id: '2', re: ['#<:Trailing:1>'], ty: [':Trailing'], to: 'c', from: ':Trailing:1' } },
      { input: { id: '3', op: 'rPub', to: ':Trailing:1', from: 'c' } },
      { output: { id: '3', re: [9], ty: ['Integer'], to: 'c', from: ':Trailing:1' } },
    );
  });

  it('a write is seen at the class\'s address', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[1], '$new'], ty: [['Integer']], to: ':Trailing', from: 'c' } },
      { output: { id: '1', re: ['#<:Trailing:1>'], ty: [':Trailing'], to: 'c' } },
      { input: { id: '2', op: 'setPub!', to: ':Trailing:1', from: 'c' } },
      { output: { id: '2', re: ['#<:Trailing:1>'], ty: [':Trailing'], to: 'c', from: ':Trailing:1' } },
      { input: { id: '3', op: 'pub', to: ':Trailing', from: 'c' } },
      { output: { id: '3', re: [5], ty: ['Integer'], to: 'c', from: ':Trailing' } },
    );
  });

  it('from the constructor block, which makes the class `!`', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[4], '$new'], ty: [['Integer']], to: ':Setter!', from: 'c' } },
      { output: { id: '1', re: ['#<:Setter!:1>'], ty: [':Setter!'], to: 'c' } },
      { input: { id: '2', op: 'pub', to: ':Setter!', from: 'c' } },
      { output: { id: '2', re: [4], ty: ['Integer'], to: 'c', from: ':Setter!' } },
    );
  });

  it('from the constructor block, without the `!`, is an error', () => {
    expect(() => compileSource(`
      C = *(seed Integer) {
        C.pub <- seed
      } ^ { @pub *Integer = 0 }
      @go = () -> 1
    `)).toThrow(/Class 'C' writes \(@pub <- …\) while constructing, so it must be named 'C!'/);
  });
});

describe('class scope — closure: the nested constructor closes over the class block', () => {
  it('reads every member bare, private included', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[1], '$new'], ty: [['Integer']], to: ':Nested', from: 'c' } },
      { output: { id: '1', re: ['#<:Nested:1>'], ty: [':Nested'], to: 'c' } },
      { input: { id: '2', op: 'bare', to: ':Nested:1', from: 'c' } },
      { output: { id: '2', re: [36], ty: ['Integer'], to: 'c', from: ':Nested:1' } },
    );
  });

  it('and so does a closure in a method', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[1], '$new'], ty: [['Integer']], to: ':Nested', from: 'c' } },
      { output: { id: '1', re: ['#<:Nested:1>'], ty: [':Nested'], to: 'c' } },
      { input: { id: '2', op: 'bareClosure', to: ':Nested:1', from: 'c' } },
      { output: { id: '2', re: [5], ty: ['Integer'], to: 'c', from: ':Nested:1' } },
    );
  });

  it('writes a member bare, and another actor sees it', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[1], '$new'], ty: [['Integer']], to: ':Nested', from: 'c' } },
      { output: { id: '1', re: ['#<:Nested:1>'], ty: [':Nested'], to: 'c' } },
      { input: { id: '2', op: [[1], '$new'], ty: [['Integer']], to: ':Nested', from: 'c' } },
      { output: { id: '2', re: ['#<:Nested:2>'], ty: [':Nested'], to: 'c' } },
      { input: { id: '3', op: 'bareSet!', to: ':Nested:1', from: 'c' } },
      { output: { id: '3', re: ['#<:Nested:1>'], ty: [':Nested'], to: 'c', from: ':Nested:1' } },
      { input: { id: '4', op: 'rProt', to: ':Nested:2', from: 'c' } },
      { output: { id: '4', re: [8], ty: ['Integer'], to: 'c', from: ':Nested:2' } },
    );
  });

  it('a member shadows a name of the actor the class is declared in', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[1], '$new'], ty: [['Integer']], to: ':Nested', from: 'c' } },
      { output: { id: '1', re: ['#<:Nested:1>'], ty: [':Nested'], to: 'c' } },
      { input: { id: '2', op: 'total', to: ':Nested:1', from: 'c' } },
      { output: { id: '2', re: [50], ty: ['Integer'], to: 'c', from: ':Nested:1' } },
    );
  });
});

describe('class scope — closure: the trailing constructor skips the class block', () => {
  it('a bare name is the declaring actor\'s, not the member of that name', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[1], '$new'], ty: [['Integer']], to: ':Trailing', from: 'c' } },
      { output: { id: '1', re: ['#<:Trailing:1>'], ty: [':Trailing'], to: 'c' } },
      { input: { id: '2', op: 'total', to: ':Trailing:1', from: 'c' } },
      { output: { id: '2', re: [7], ty: ['Integer'], to: 'c', from: ':Trailing:1' } },
    );
  });

  it('a bare public cell, from a method', () => {
    expect(() => compileSource(`
      C = *(seed Integer) { @r = { return @pub } } ^ { @pub *Integer = 1 }
      @go = () -> 1
    `)).toThrow(/'@pub' is a member of the class 'C', and a trailing constructor doesn't close over its class block: reach it as 'C\.pub'/);
  });

  it('a bare protected cell, from a method', () => {
    expect(() => compileSource(`
      C = *(seed Integer) { @r = { return prot } } ^ { prot *Integer = 1 }
      @go = () -> 1
    `)).toThrow(/^'prot' is a member of the class 'C', and a trailing constructor doesn't close over its class block$/);
  });

  it('a bare public function', () => {
    expect(() => compileSource(`
      C = *(seed Integer) { @r = {
        x Integer = @pubFn()
        return x
      } } ^ { @pubFn = () -> 10 }
      @go = () -> 1
    `)).toThrow(/'@pubFn' is a member of the class 'C', and a trailing constructor doesn't close over its class block: reach it as 'C\.pubFn'/);
  });

  it('a bare protected function', () => {
    expect(() => compileSource(`
      C = *(seed Integer) { @r = {
        x Integer = protFn()
        return x
      } } ^ { protFn = () -> 20 }
      @go = () -> 1
    `)).toThrow(/^'protFn' is a member of the class 'C', and a trailing constructor doesn't close over its class block$/);
  });

  it('a bare private function', () => {
    expect(() => compileSource(`
      C = *(seed Integer) { @r = {
        x Integer = #priv()
        return x
      } } ^ { #priv = () -> 3 }
      @go = () -> 1
    `)).toThrow(/'#priv' is private to the class block of 'C', and a trailing constructor doesn't close over it/);
  });

  it('a bare write, from a method', () => {
    expect(() => compileSource(`
      C = *(seed Integer) { @w! = { prot <- 2 } } ^ { prot *Integer = 1 }
      @go = () -> 1
    `)).toThrow(/^'prot' is a member of the class 'C', and a trailing constructor doesn't close over its class block$/);
  });

  it('a bare name in a closure in a method', () => {
    expect(() => compileSource(`
      C = *(seed Integer) { @r = {
        f = () -> prot
        x Integer = f()
        return x
      } } ^ { prot *Integer = 1 }
      @go = () -> 1
    `)).toThrow(/^'prot' is a member of the class 'C', and a trailing constructor doesn't close over its class block$/);
  });

  it('a bare read in the constructor block', () => {
    expect(() => compileSource(`
      C = *(seed Integer) {
        n Integer = prot + seed
      } ^ { prot *Integer = 1 }
      @go = () -> 1
    `)).toThrow(/^'prot' is a member of the class 'C', and a trailing constructor doesn't close over its class block$/);
  });

  it('a bare write of a protected cell in the constructor block', () => {
    expect(() => compileSource(`
      C = *(seed Integer) {
        prot <- seed
      } ^ { prot *Integer = 1 }
      @go = () -> 1
    `)).toThrow(/^'prot' is a member of the class 'C', and a trailing constructor doesn't close over its class block$/);
  });

  it('a bare write of a public cell in the constructor block', () => {
    expect(() => compileSource(`
      C = *(seed Integer) {
        @pub <- seed
      } ^ { @pub *Integer = 1 }
      @go = () -> 1
    `)).toThrow(/'@pub' is a member of the class 'C', and a trailing constructor doesn't close over its class block: reach it as 'C\.pub'/);
  });

  it('a write in the constructor block to a name nobody declares is still the usual error', () => {
    expect(() => compileSource(`
      C = *(seed Integer) {
        nope <- seed
      }
      @go = () -> 1
    `)).toThrow(/Cannot set 'nope' — only '\*Type' variables support '<-'/);
  });
});

describe('class scope — only public members after a dot', () => {
  it('a protected cell', () => {
    expect(() => compileSource(`
      C = *(seed Integer) { @r = { return C.prot } } ^ { prot *Integer = 1 }
    `)).toThrow(/^No public member 'prot' in 'C'$/);
  });

  it('a protected cell, nested', () => {
    expect(() => compileSource(`
      C = actor {
        prot *Integer = 1
        new = *(seed Integer) { @r = { return C.prot } }
      }
    `)).toThrow(/^No public member 'prot' in 'C'$/);
  });

  it('a write to a protected cell', () => {
    expect(() => compileSource(`
      C = *(seed Integer) { @w! = { C.prot <- 1 } } ^ { prot *Integer = 1 }
    `)).toThrow(/^No public member 'prot' in 'C'$/);
  });

  it('a protected function', () => {
    expect(() => compileSource(`
      C = *(seed Integer) { @r = {
        x Integer = C.protFn()
        return x
      } } ^ { protFn = () -> 20 }
    `)).toThrow(/^No public member 'protFn' in 'C'$/);
  });

  it('a private function, named without its sigil', () => {
    expect(() => compileSource(`
      C = *(seed Integer) { @r = {
        x Integer = C.priv()
        return x
      } } ^ { #priv = () -> 3 }
    `)).toThrow(/^No public member 'priv' in 'C'$/);
  });

  it('a member the class doesn\'t declare', () => {
    expect(() => compileSource(`
      C = *(seed Integer) { @r = { return C.nope } } ^ { @pub *Integer = 1 }
    `)).toThrow(/^No public member 'nope' in 'C'$/);
  });

  it('a write to a member the class doesn\'t declare', () => {
    expect(() => compileSource(`
      C = *(seed Integer) { @w! = { C.nope <- 1 } } ^ { @pub *Integer = 1 }
    `)).toThrow(/^No public member 'nope' in 'C'$/);
  });
});

describe('class scope — sigils after a dot', () => {
  it('`~` is a syntax error', () => {
    expect(() => compileSource(`
      C = *(seed Integer) { @r = { return C.~prot } } ^ { prot *Integer = 1 }
    `)).toThrow(/^Unexpected '~' \(line 2\)$/);
  });

  it('`~` is a syntax error anywhere but `~>`', () => {
    expect(() => compileSource(`
      @go = {
        x Integer = ~1
        return x
      }
    `)).toThrow(/^Unexpected '~' \(line 3\)$/);
  });
});

// A closure or lambda in a class reaches the names of the actors the class is
// declared in, as the class's own methods do.
const closures = `
  total *Integer = 7
  #pz = () -> 3
  helper = (n Integer) -> n + 1

  @W = *{
    k Integer = 100

    @readCell = {
      f = () -> total
      x Integer = f()
      return x
    }
    @callPrivate = {
      f = () -> #pz()
      x Integer = f()
      return x
    }
    @callWithArgs = {
      f = (n Integer) -> helper(n)
      x Integer = f(4)
      return x
    }
    @mixed = {
      f = (n Integer) -> n + total + k
      x Integer = f(1)
      return x
    }
    @pure = {
      f = (n Integer) -> n + 1
      x Integer = f(2)
      return x
    }
    @write! = {
      f! = () { total <- total + 1 }
      f!()
    }

    In = *{
      @r = {
        f = () -> total + k + #pz()
        x Integer = f()
        return x
      }
    }
    @inner = {
      i = In()
      x Integer = i.r()
      return x
    }
  }

  @total = { return total }
`;

describe('class scope — closures in a class reach the actors it\'s declared in', () => {
  it('a lambda reads a file cell', async () => {
    await expectBehavior(closures,
      { input: { id: '1', op: '$new', to: ':W', from: 'c' } },
      { output: { id: '1', re: ['#<:W:1>'], ty: [':W'], to: 'c' } },
      { input: { id: '2', op: 'readCell', to: ':W:1', from: 'c' } },
      { output: { id: '2', re: [7], ty: ['Integer'], to: 'c', from: ':W:1' } },
    );
  });

  it('a lambda calls a private file function', async () => {
    await expectBehavior(closures,
      { input: { id: '1', op: '$new', to: ':W', from: 'c' } },
      { output: { id: '1', re: ['#<:W:1>'], ty: [':W'], to: 'c' } },
      { input: { id: '2', op: 'callPrivate', to: ':W:1', from: 'c' } },
      { output: { id: '2', re: [3], ty: ['Integer'], to: 'c', from: ':W:1' } },
    );
  });

  it('a lambda calls a file function with args', async () => {
    await expectBehavior(closures,
      { input: { id: '1', op: '$new', to: ':W', from: 'c' } },
      { output: { id: '1', re: ['#<:W:1>'], ty: [':W'], to: 'c' } },
      { input: { id: '2', op: 'callWithArgs', to: ':W:1', from: 'c' } },
      { output: { id: '2', re: [5], ty: ['Integer'], to: 'c', from: ':W:1' } },
    );
  });

  it('a lambda mixes its param, a file cell and its class\'s own cell', async () => {
    await expectBehavior(closures,
      { input: { id: '1', op: '$new', to: ':W', from: 'c' } },
      { output: { id: '1', re: ['#<:W:1>'], ty: [':W'], to: 'c' } },
      { input: { id: '2', op: 'mixed', to: ':W:1', from: 'c' } },
      { output: { id: '2', re: [108], ty: ['Integer'], to: 'c', from: ':W:1' } },
    );
  });

  it('a lambda with no outer names', async () => {
    await expectBehavior(closures,
      { input: { id: '1', op: '$new', to: ':W', from: 'c' } },
      { output: { id: '1', re: ['#<:W:1>'], ty: [':W'], to: 'c' } },
      { input: { id: '2', op: 'pure', to: ':W:1', from: 'c' } },
      { output: { id: '2', re: [3], ty: ['Integer'], to: 'c', from: ':W:1' } },
    );
  });

  it('a lambda writes a file cell', async () => {
    await expectBehavior(closures,
      { input: { id: '1', op: '$new', to: ':W', from: 'c' } },
      { output: { id: '1', re: ['#<:W:1>'], ty: [':W'], to: 'c' } },
      { input: { id: '2', op: 'write!', to: ':W:1', from: 'c' } },
      { output: { id: '2', re: ['#<:W:1>'], ty: [':W'], to: 'c', from: ':W:1' } },
      { input: { id: '3', op: 'total', from: 'c' } },
      { output: { id: '3', re: [8], ty: ['Integer'], to: 'c' } },
    );
  });

  it('a lambda in a class inside a class reaches both enclosing actors', async () => {
    await expectBehavior(closures,
      { input: { id: '1', op: '$new', to: ':W', from: 'c' } },
      { output: { id: '1', re: ['#<:W:1>'], ty: [':W'], to: 'c' } },
      { input: { id: '2', op: 'inner', to: ':W:1', from: 'c' } },
      { output: { id: '2', re: [110], ty: ['Integer'], to: 'c', from: ':W:1' } },
    );
  });
});
