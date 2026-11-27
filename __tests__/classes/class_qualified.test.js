import { compileSource, expectBehavior } from '../helpers.js';

// `class` and `::`. `class` is the class of the running actor. After a dot a member is
// public, written by its wire name, and reached by a message; after `::` it is
// protected, written bare as declared. `C.` and `C::` are the same by the class's name.
//
// Each form is read, written and called from the constructor block, a method and a
// closure in a method, in the nested and trailing forms, and from a subclass's actor.
// `C::name` reaches only the class's family: its actors and its subclasses' actors.
//
// See notes/class-scope-and-inheritance-2026-11-16.md.

const forms = `
  @N = actor {
    @pub *Integer = 1
    prot *Integer = 2
    @pubFn = () -> 10
    protFn = () -> 20

    new = *(seed Integer) {
      built Integer = class.pub + class::prot + class::protFn() + seed
      named Integer = @N.pub + @N::prot + @N::protFn()
      @built = { return built }
      @named = { return named }
      @read = {
        x Integer = class.pub + class::prot
        return x
      }
      @call = {
        a Integer = class.pubFn()
        b Integer = class::protFn()
        return a + b
      }
      @write! = {
        class.pub <- 3
        class::prot <- 4
      }
      @bump! = { class::prot <| 7 }
      @closure = {
        f = () -> class.pub + class::prot + class::protFn()
        x Integer = f()
        return x
      }
      @closureSet! = {
        f! = () { class::prot <- 6 }
        f!()
      }
      @again = {
        n = class(seed + 1)
        x Integer = n.built()
        return x
      }
    }
  }

  @R = *(seed Integer) {
    built Integer = class.pub + class::prot + class::protFn() + seed
    named Integer = @R.pub + @R::prot + @R::protFn()
    @built = { return built }
    @named = { return named }
    @read = {
      x Integer = class.pub + class::prot
      return x
    }
    @call = {
      a Integer = class.pubFn()
      b Integer = class::protFn()
      return a + b
    }
    @write! = {
      class.pub <- 3
      class::prot <- 4
    }
    @bump! = { class::prot <| 7 }
    @closure = {
      f = () -> class.pub + class::prot + class::protFn()
      x Integer = f()
      return x
    }
    @closureSet! = {
      f! = () { class::prot <- 6 }
      f!()
    }
    @again = {
      n = class(seed + 1)
      x Integer = n.built()
      return x
    }
  } ^ {
    @pub *Integer = 1
    prot *Integer = 2
    @pubFn = () -> 10
    protFn = () -> 20
  }

  @W! = *(seed Integer) {
    class::prot <- seed
    class.pub <- seed + 1
    @read = {
      x Integer = class::prot + class.pub
      return x
    }
  } ^ {
    @pub *Integer = 0
    prot *Integer = 0
  }
`;

describe('class and :: — nested and trailing', () => {
  it('nested: reads and calls from the constructor block', async () => {
    await expectBehavior(forms,
      { input: { id: '1', op: [[1], '$new'], ty: [['Integer']], to: ':N', from: 'c' } },
      { output: { id: '1', re: ['#<:N:1>'], ty: [':N'], to: 'c' } },
      { input: { id: '2', op: 'built', to: ':N:1', from: 'c' } },
      { output: { id: '2', re: [24], ty: ['Integer'], to: 'c', from: ':N:1' } },
      { input: { id: '3', op: 'named', to: ':N:1', from: 'c' } },
      { output: { id: '3', re: [23], ty: ['Integer'], to: 'c', from: ':N:1' } },
    );
  });

  it('nested: reads and calls from a method', async () => {
    await expectBehavior(forms,
      { input: { id: '1', op: [[1], '$new'], ty: [['Integer']], to: ':N', from: 'c' } },
      { output: { id: '1', re: ['#<:N:1>'], ty: [':N'], to: 'c' } },
      { input: { id: '2', op: 'read', to: ':N:1', from: 'c' } },
      { output: { id: '2', re: [3], ty: ['Integer'], to: 'c', from: ':N:1' } },
      { input: { id: '3', op: 'call', to: ':N:1', from: 'c' } },
      { output: { id: '3', re: [30], ty: ['Integer'], to: 'c', from: ':N:1' } },
    );
  });

  it('nested: writes from a method, and another actor sees them', async () => {
    await expectBehavior(forms,
      { input: { id: '1', op: [[1], '$new'], ty: [['Integer']], to: ':N', from: 'c' } },
      { output: { id: '1', re: ['#<:N:1>'], ty: [':N'], to: 'c' } },
      { input: { id: '2', op: [[1], '$new'], ty: [['Integer']], to: ':N', from: 'c' } },
      { output: { id: '2', re: ['#<:N:2>'], ty: [':N'], to: 'c' } },
      { input: { id: '3', op: 'write!', to: ':N:1', from: 'c' } },
      { output: { id: '3', re: ['#<:N:1>'], ty: [':N'], to: 'c', from: ':N:1' } },
      { input: { id: '4', op: 'read', to: ':N:2', from: 'c' } },
      { output: { id: '4', re: [7], ty: ['Integer'], to: 'c', from: ':N:2' } },
      { input: { id: '5', op: 'bump!', to: ':N:2', from: 'c' } },
      { output: { id: '5', re: ['#<:N:2>'], ty: [':N'], to: 'c', from: ':N:2' } },
      { input: { id: '6', op: 'read', to: ':N:1', from: 'c' } },
      { output: { id: '6', re: [10], ty: ['Integer'], to: 'c', from: ':N:1' } },
    );
  });

  it('nested: reads, calls and writes from a closure in a method', async () => {
    await expectBehavior(forms,
      { input: { id: '1', op: [[1], '$new'], ty: [['Integer']], to: ':N', from: 'c' } },
      { output: { id: '1', re: ['#<:N:1>'], ty: [':N'], to: 'c' } },
      { input: { id: '2', op: 'closure', to: ':N:1', from: 'c' } },
      { output: { id: '2', re: [23], ty: ['Integer'], to: 'c', from: ':N:1' } },
      { input: { id: '3', op: 'closureSet!', to: ':N:1', from: 'c' } },
      { output: { id: '3', re: ['#<:N:1>'], ty: [':N'], to: 'c', from: ':N:1' } },
      { input: { id: '4', op: 'read', to: ':N:1', from: 'c' } },
      { output: { id: '4', re: [7], ty: ['Integer'], to: 'c', from: ':N:1' } },
    );
  });

  it('nested: class(args) builds the class', async () => {
    await expectBehavior(forms,
      { input: { id: '1', op: [[1], '$new'], ty: [['Integer']], to: ':N', from: 'c' } },
      { output: { id: '1', re: ['#<:N:1>'], ty: [':N'], to: 'c' } },
      { input: { id: '2', op: 'again', to: ':N:1', from: 'c' } },
      { output: { id: '2', re: [25], ty: ['Integer'], to: 'c', from: ':N:1' } },
    );
  });

  it('trailing: reads and calls from the constructor block', async () => {
    await expectBehavior(forms,
      { input: { id: '1', op: [[1], '$new'], ty: [['Integer']], to: ':R', from: 'c' } },
      { output: { id: '1', re: ['#<:R:1>'], ty: [':R'], to: 'c' } },
      { input: { id: '2', op: 'built', to: ':R:1', from: 'c' } },
      { output: { id: '2', re: [24], ty: ['Integer'], to: 'c', from: ':R:1' } },
      { input: { id: '3', op: 'named', to: ':R:1', from: 'c' } },
      { output: { id: '3', re: [23], ty: ['Integer'], to: 'c', from: ':R:1' } },
    );
  });

  it('trailing: reads and calls from a method', async () => {
    await expectBehavior(forms,
      { input: { id: '1', op: [[1], '$new'], ty: [['Integer']], to: ':R', from: 'c' } },
      { output: { id: '1', re: ['#<:R:1>'], ty: [':R'], to: 'c' } },
      { input: { id: '2', op: 'read', to: ':R:1', from: 'c' } },
      { output: { id: '2', re: [3], ty: ['Integer'], to: 'c', from: ':R:1' } },
      { input: { id: '3', op: 'call', to: ':R:1', from: 'c' } },
      { output: { id: '3', re: [30], ty: ['Integer'], to: 'c', from: ':R:1' } },
    );
  });

  it('trailing: writes from a method, and another actor sees them', async () => {
    await expectBehavior(forms,
      { input: { id: '1', op: [[1], '$new'], ty: [['Integer']], to: ':R', from: 'c' } },
      { output: { id: '1', re: ['#<:R:1>'], ty: [':R'], to: 'c' } },
      { input: { id: '2', op: [[1], '$new'], ty: [['Integer']], to: ':R', from: 'c' } },
      { output: { id: '2', re: ['#<:R:2>'], ty: [':R'], to: 'c' } },
      { input: { id: '3', op: 'write!', to: ':R:1', from: 'c' } },
      { output: { id: '3', re: ['#<:R:1>'], ty: [':R'], to: 'c', from: ':R:1' } },
      { input: { id: '4', op: 'read', to: ':R:2', from: 'c' } },
      { output: { id: '4', re: [7], ty: ['Integer'], to: 'c', from: ':R:2' } },
      { input: { id: '5', op: 'bump!', to: ':R:2', from: 'c' } },
      { output: { id: '5', re: ['#<:R:2>'], ty: [':R'], to: 'c', from: ':R:2' } },
      { input: { id: '6', op: 'read', to: ':R:1', from: 'c' } },
      { output: { id: '6', re: [10], ty: ['Integer'], to: 'c', from: ':R:1' } },
    );
  });

  it('trailing: reads, calls and writes from a closure in a method', async () => {
    await expectBehavior(forms,
      { input: { id: '1', op: [[1], '$new'], ty: [['Integer']], to: ':R', from: 'c' } },
      { output: { id: '1', re: ['#<:R:1>'], ty: [':R'], to: 'c' } },
      { input: { id: '2', op: 'closure', to: ':R:1', from: 'c' } },
      { output: { id: '2', re: [23], ty: ['Integer'], to: 'c', from: ':R:1' } },
      { input: { id: '3', op: 'closureSet!', to: ':R:1', from: 'c' } },
      { output: { id: '3', re: ['#<:R:1>'], ty: [':R'], to: 'c', from: ':R:1' } },
      { input: { id: '4', op: 'read', to: ':R:1', from: 'c' } },
      { output: { id: '4', re: [7], ty: ['Integer'], to: 'c', from: ':R:1' } },
    );
  });

  it('trailing: class(args) builds the class', async () => {
    await expectBehavior(forms,
      { input: { id: '1', op: [[1], '$new'], ty: [['Integer']], to: ':R', from: 'c' } },
      { output: { id: '1', re: ['#<:R:1>'], ty: [':R'], to: 'c' } },
      { input: { id: '2', op: 'again', to: ':R:1', from: 'c' } },
      { output: { id: '2', re: [25], ty: ['Integer'], to: 'c', from: ':R:1' } },
    );
  });

  it('writes from the constructor block, which makes the class `!`', async () => {
    await expectBehavior(forms,
      { input: { id: '1', op: [[4], '$new'], ty: [['Integer']], to: ':W!', from: 'c' } },
      { output: { id: '1', re: ['#<:W!:1>'], ty: [':W!'], to: 'c' } },
      { input: { id: '2', op: 'read', to: ':W!:1', from: 'c' } },
      { output: { id: '2', re: [9], ty: ['Integer'], to: 'c', from: ':W!:1' } },
    );
  });
});

// `U` has no class block of its own, so it uses `T`'s: one cell, which `T::` and
// `class::` reach from `U`'s actors, and `T`'s actors see `U`'s writes.
const subclass = `
  @T = *(seed Integer) {
    @tProt = { return class::prot }
    @tPub = { return @T.pub }
    @tCall = {
      x Integer = class::protFn()
      return x
    }
  } ^ {
    @pub *Integer = 1
    prot *Integer = 2
    protFn = () -> 20
  }

  @U = @T ^ *(seed Integer, u Integer) {
    super(seed)
    first Integer = @T::prot + class.pub + u
    @first = { return first }
    @uProt = { return @T::prot }
    @uClass = {
      x Integer = class::prot + class.pub
      return x
    }
    @uCall = {
      x Integer = @T::protFn() + class::protFn()
      return x
    }
    @uSet! = { @T::prot <- u }
    @uClassSet! = { class::prot <| u + 1 }
    @uClosure = {
      f = () -> @T::prot + class::protFn()
      x Integer = f()
      return x
    }
  }
`;

describe('class and :: — from a subclass\'s actor', () => {
  it('reads from the constructor block and a method', async () => {
    await expectBehavior(subclass,
      { input: { id: '1', op: [[1, 5], '$new'], ty: [['Integer', 'Integer']], to: ':U', from: 'c' } },
      { output: { id: '1', re: ['#<:U:1>'], ty: [':U'], to: 'c' } },
      { input: { id: '2', op: 'first', to: ':U:1', from: 'c' } },
      { output: { id: '2', re: [8], ty: ['Integer'], to: 'c', from: ':U:1' } },
      { input: { id: '3', op: 'uProt', to: ':U:1', from: 'c' } },
      { output: { id: '3', re: [2], ty: ['Integer'], to: 'c', from: ':U:1' } },
      { input: { id: '4', op: 'uClass', to: ':U:1', from: 'c' } },
      { output: { id: '4', re: [3], ty: ['Integer'], to: 'c', from: ':U:1' } },
    );
  });

  it('calls, from a method and a closure in it', async () => {
    await expectBehavior(subclass,
      { input: { id: '1', op: [[1, 5], '$new'], ty: [['Integer', 'Integer']], to: ':U', from: 'c' } },
      { output: { id: '1', re: ['#<:U:1>'], ty: [':U'], to: 'c' } },
      { input: { id: '2', op: 'uCall', to: ':U:1', from: 'c' } },
      { output: { id: '2', re: [40], ty: ['Integer'], to: 'c', from: ':U:1' } },
      { input: { id: '3', op: 'uClosure', to: ':U:1', from: 'c' } },
      { output: { id: '3', re: [22], ty: ['Integer'], to: 'c', from: ':U:1' } },
    );
  });

  it('the parent\'s methods, run by the subclass\'s actor', async () => {
    await expectBehavior(subclass,
      { input: { id: '1', op: [[1, 5], '$new'], ty: [['Integer', 'Integer']], to: ':U', from: 'c' } },
      { output: { id: '1', re: ['#<:U:1>'], ty: [':U'], to: 'c' } },
      { input: { id: '2', op: 'tProt', to: ':U:1', from: 'c' } },
      { output: { id: '2', re: [2], ty: ['Integer'], to: 'c', from: ':U:1' } },
      { input: { id: '3', op: 'tPub', to: ':U:1', from: 'c' } },
      { output: { id: '3', re: [1], ty: ['Integer'], to: 'c', from: ':U:1' } },
      { input: { id: '4', op: 'tCall', to: ':U:1', from: 'c' } },
      { output: { id: '4', re: [20], ty: ['Integer'], to: 'c', from: ':U:1' } },
    );
  });

  it('writes the parent\'s cell, and the parent\'s actors see it', async () => {
    await expectBehavior(subclass,
      { input: { id: '1', op: [[1, 5], '$new'], ty: [['Integer', 'Integer']], to: ':U', from: 'c' } },
      { output: { id: '1', re: ['#<:U:1>'], ty: [':U'], to: 'c' } },
      { input: { id: '2', op: [[1], '$new'], ty: [['Integer']], to: ':T', from: 'c' } },
      { output: { id: '2', re: ['#<:T:1>'], ty: [':T'], to: 'c' } },
      { input: { id: '3', op: 'uSet!', to: ':U:1', from: 'c' } },
      { output: { id: '3', re: ['#<:U:1>'], ty: [':U'], to: 'c', from: ':U:1' } },
      { input: { id: '4', op: 'tProt', to: ':T:1', from: 'c' } },
      { output: { id: '4', re: [5], ty: ['Integer'], to: 'c', from: ':T:1' } },
      { input: { id: '5', op: 'uClassSet!', to: ':U:1', from: 'c' } },
      { output: { id: '5', re: ['#<:U:1>'], ty: [':U'], to: 'c', from: ':U:1' } },
      { input: { id: '6', op: 'tProt', to: ':T:1', from: 'c' } },
      { output: { id: '6', re: [6], ty: ['Integer'], to: 'c', from: ':T:1' } },
    );
  });
});

describe('class and :: — what comes after `::`', () => {
  it('a public cell', () => {
    expect(() => compileSource(`
      C = *(s Integer) { @r = { return class::count } } ^ { @count *Integer = 1 }
    `)).toThrow(/^'count' is public: write 'class\.count'$/);
  });

  it('a public cell, by the class\'s name', () => {
    expect(() => compileSource(`
      C = *(s Integer) { @r = { return C::count } } ^ { @count *Integer = 1 }
    `)).toThrow(/^'count' is public: write 'C\.count'$/);
  });

  it('a write to a public cell', () => {
    expect(() => compileSource(`
      C = *(s Integer) { @w! = { class::count <- 2 } } ^ { @count *Integer = 1 }
    `)).toThrow(/^'count' is public: write 'class\.count'$/);
  });

  it('a public function', () => {
    expect(() => compileSource(`
      C = *(s Integer) { @r = {
        x Integer = C::pubFn()
        return x
      } } ^ { @pubFn = () -> 1 }
    `)).toThrow(/^'pubFn' is public: write 'C\.pubFn\(\)'$/);
  });

  it('a name the class block doesn\'t declare', () => {
    expect(() => compileSource(`
      C = *(s Integer) { @r = { return C::nope } } ^ { prot *Integer = 1 }
    `)).toThrow(/^No protected member 'nope' in 'C'$/);
  });

  it('a function, not called', () => {
    expect(() => compileSource(`
      C = *(s Integer) { @r = { return C::h } } ^ { h = () -> 1 }
    `)).toThrow(/^'C::h' is a function: call it, 'C::h\(\)'$/);
  });

  it('a write to a cell that isn\'t `*`', () => {
    expect(() => compileSource(`
      C = *(s Integer) { @w! = { class::prot <- 2 } } ^ { prot Integer = 1 }
    `)).toThrow(/^Cannot set 'prot' — it's a cell of .* that isn't '\*', so it can't be set$/);
  });

  it('a write from the constructor block, without the `!`', () => {
    expect(() => compileSource(`
      C = *(s Integer) {
        class::prot <- s
      } ^ { prot *Integer = 0 }
    `)).toThrow(/^Class 'C' writes \(prot <- …\) while constructing, so it must be named 'C!'/);
  });

  it('a type is still a type, not a value', () => {
    expect(() => compileSource(`
      C = *{
        type P(Integer)
        @r = () -> 1
      }
      @go = { return C::P }
    `)).toThrow(/^'C::P' is a type, not a value$/);
  });
});

describe('class and :: — only within the class\'s family', () => {
  it('a read from the file', () => {
    expect(() => compileSource(`
      C = *(s Integer) { @r = () -> 1 } ^ { prot *Integer = 1 }
      @go = { return C::prot }
    `)).toThrow(/^'C::prot' — a protected member of 'C' is reached only from its family: its actors and its subclasses' actors$/);
  });

  it('a read from another class', () => {
    expect(() => compileSource(`
      C = *(s Integer) { @r = () -> 1 } ^ { prot *Integer = 1 }
      D = *{ @r = { return C::prot } }
    `)).toThrow(/^'C::prot' — a protected member of 'C' is reached only from its family/);
  });

  it('a call from another class', () => {
    expect(() => compileSource(`
      C = *(s Integer) { @r = () -> 1 } ^ { h = () -> 1 }
      D = *{ @r = {
        x Integer = C::h()
        return x
      } }
    `)).toThrow(/^'C::h\(\)' — a protected member of 'C' is reached only from its family/);
  });

  it('a write from another class', () => {
    expect(() => compileSource(`
      C = *(s Integer) { @r = () -> 1 } ^ { prot *Integer = 1 }
      D = *{ @w! = { C::prot <- 2 } }
    `)).toThrow(/^'C::prot <- …' — a protected member of 'C' is reached only from its family/);
  });

  it('a class with no class block', () => {
    expect(() => compileSource(`
      C = *(s Integer) { @r = () -> 1 }
      D = *{ @r = { return C::prot } }
    `)).toThrow(/^'C::prot' — 'C' has no class block, so it has no protected members to reach$/);
  });

  it("a subclass with a class block of its own, which extends the parent's, reaches the parent's protected members", () => {
    expect(() => compileSource(`
      T = *(s Integer) { @r = () -> 1 } ^ { prot *Integer = 1 }
      U = T ^ *(u Integer) { super(u); @r2 = { return T::prot } } ^ { other *Integer = 1 }
    `)).not.toThrow();
  });
});

describe('class — where it names a class', () => {
  it('in a class block', () => {
    expect(() => compileSource(`
      C = *(s Integer) { @r = () -> 1 } ^ {
        prot *Integer = 1
        @x = { return class::prot }
      }
    `)).toThrow(/^'class' in a class block: it names the class of an actor built by a class, and this one isn't$/);
  });

  it('in a singleton', () => {
    expect(() => compileSource(`
      s = actor { @x = { return class::a } }
    `)).toThrow(/^'class' in a singleton: it names the class of an actor built by a class, and this one isn't$/);
  });

  it('in the file', () => {
    expect(() => compileSource(`
      @x = { return class::a }
    `)).toThrow(/^'class' in this file: it names the class of an actor built by a class, and this one isn't$/);
  });

  it('a class with no class block, as a receiver', () => {
    expect(() => compileSource(`
      C = *{ @r = { return class.a } }
    `)).toThrow(/^'class': 'C' has no class block, and nor do its parents, so there are no class members to reach$/);
  });

  it('is reserved', () => {
    expect(() => compileSource(`
      @go = {
        class = 1
        return class
      }
    `)).toThrow(/^'class' is reserved: it names the class of the running actor, so it can't be declared or set \(line 3\)$/);
  });

  it('is reserved as a cell', () => {
    expect(() => compileSource(`
      class *Integer = 1
    `)).toThrow(/^'class' is reserved: it names the class of the running actor, so it can't be declared or set \(line 2\)$/);
  });

  it('is reserved as a param', () => {
    expect(() => compileSource(`
      f = (class Integer) -> 1
    `)).toThrow(/^'class' is reserved: it names the class of the running actor, so it can't be declared or set \(line 2\)$/);
  });
});

// `x::class` is an actor's class; `class` is `self::class`. Only `self::class` for now.
const selfClass = `
  @S = *(seed Integer) {
    built Integer = self::class.pub + self::class::prot + seed
    @built = { return built }
    @write! = {
      self::class.pub <- 5
      self::class::prot <- 6
    }
    @read = {
      x Integer = self::class.pub + class::prot
      return x
    }
    @again = {
      n = self::class(seed + 1)
      x Integer = n.built()
      return x
    }
  } ^ {
    @pub *Integer = 1
    prot *Integer = 2
  }
`;

describe('self::class — the same as class', () => {
  it('reads, writes and constructs through self::class', async () => {
    await expectBehavior(selfClass,
      { input: { id: '1', op: [[10], '$new'], ty: [['Integer']], to: ':S', from: 'c' } },
      { output: { id: '1', re: ['#<:S:1>'], ty: [':S'], to: 'c' } },
      { input: { id: '2', op: 'built', to: ':S:1', from: 'c' } },
      { output: { id: '2', re: [13], ty: ['Integer'], to: 'c', from: ':S:1' } },
      { input: { id: '3', op: 'write!', to: ':S:1', from: 'c' } },
      { output: { id: '3', re: ['#<:S:1>'], ty: [':S'], to: 'c', from: ':S:1' } },
      { input: { id: '4', op: 'read', to: ':S:1', from: 'c' } },
      { output: { id: '4', re: [11], ty: ['Integer'], to: 'c', from: ':S:1' } },
      { input: { id: '5', op: 'again', to: ':S:1', from: 'c' } },
      { output: { id: '5', re: [22], ty: ['Integer'], to: 'c', from: ':S:1' } },
    );
  });

  it("another actor's class isn't supported yet", () => {
    expect(() => compileSource(`
      C = *{} ^ { @a *Integer = 1 }
      @go = {
        c = C()
        x Integer = c::class.a
        return x
      }
    `)).toThrow(/^'c::class' isn't supported yet: only 'self::class' \(or 'class'\), the class of the running actor \(line 5\)$/);
  });
});
