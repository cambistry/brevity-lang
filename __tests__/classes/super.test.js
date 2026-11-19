import { compileSource, expectBehavior } from '../helpers.js';

// `super`: the parent layer, reached within the same actor. `super::name` is the
// parent's protected `name`, `super.name` its public `@name`, and `super[T]::name`
// parent `T`'s. Inheritance is merged and late-bound: the parent's own code sees the
// subclass's override, and `super::` is how the override reaches the parent's.
//
// A cell the subclass redeclares has the parent layer's own cell behind it, which
// `super::name` reads and writes; the parent's code uses the subclass's.
//
// See notes/class-scope-and-inheritance-2026-11-16.md.

const layers = `
  @T = *{
    total *Integer = 5
    h = -> 1
    add = (n Integer) -> n + 1
    @a = {
      x Integer = h() + 100
      return x
    }
    @pub = { return 7 }
    @readTotal = { return total }
  }

  @U = @T ++ *{
    total *Integer = super::total + 6
    h = -> super::h() + 10
    @pub = {
      x Integer = super.pub()
      return x + 1
    }
    @parentTotal = {
      x Integer = super::total
      return x
    }
    @bumpParent! = { super::total <- super::total + 100 }
    add = (n Integer) -> n * 2
    @viaAdd = (n Integer) {
      x Integer = super::add(n)
      y Integer = add(n)
      return x + y
    }
  }

  @V = @T ++ *{
    @parentTotal = {
      x Integer = super::total
      return x
    }
    @bump! = { total <- total + 1 }
  }

  @W = @U ++ *{
    h = -> super::h() + 100
  }

  A = *{ h = -> 1 }
  B = *{ h = -> 2 }
  @C = A ++ B ++ (k Integer) *{
    h = -> 0
    @both = {
      x Integer = super[A]::h() * 10 + super[B]::h() + k
      return x
    }
  }
`;

describe('super — layers', () => {
  it("the parent's code sees the override, and super:: reaches the parent's", async () => {
    await expectBehavior(layers,
      { input: { id: '1', op: [[], '$new'], to: ':T', from: 'c' } },
      { output: { id: '1', re: ['#<:T:1>'], ty: [':T'], to: 'c' } },
      { input: { id: '2', op: 'a', to: ':T:1', from: 'c' } },
      { output: { id: '2', re: [101], ty: ['Integer'], to: 'c', from: ':T:1' } },
      { input: { id: '3', op: [[], '$new'], to: ':U', from: 'c' } },
      { output: { id: '3', re: ['#<:U:1>'], ty: [':U'], to: 'c' } },
      { input: { id: '4', op: 'a', to: ':U:1', from: 'c' } },
      { output: { id: '4', re: [111], ty: ['Integer'], to: 'c', from: ':U:1' } },
    );
  });

  it("super. reaches the parent's public function", async () => {
    await expectBehavior(layers,
      { input: { id: '1', op: [[], '$new'], to: ':U', from: 'c' } },
      { output: { id: '1', re: ['#<:U:1>'], ty: [':U'], to: 'c' } },
      { input: { id: '2', op: 'pub', to: ':U:1', from: 'c' } },
      { output: { id: '2', re: [8], ty: ['Integer'], to: 'c', from: ':U:1' } },
    );
  });

  it("a redeclared cell: the parent's code uses the subclass's, super:: the parent's own", async () => {
    await expectBehavior(layers,
      { input: { id: '1', op: [[], '$new'], to: ':U', from: 'c' } },
      { output: { id: '1', re: ['#<:U:1>'], ty: [':U'], to: 'c' } },
      { input: { id: '2', op: 'readTotal', to: ':U:1', from: 'c' } },
      { output: { id: '2', re: [11], ty: ['Integer'], to: 'c', from: ':U:1' } },
      { input: { id: '3', op: 'parentTotal', to: ':U:1', from: 'c' } },
      { output: { id: '3', re: [5], ty: ['Integer'], to: 'c', from: ':U:1' } },
      { input: { id: '4', op: 'bumpParent!', to: ':U:1', from: 'c' } },
      { output: { id: '4', re: ['#<:U:1>'], ty: [':U'], to: 'c', from: ':U:1' } },
      { input: { id: '5', op: 'parentTotal', to: ':U:1', from: 'c' } },
      { output: { id: '5', re: [105], ty: ['Integer'], to: 'c', from: ':U:1' } },
      { input: { id: '6', op: 'readTotal', to: ':U:1', from: 'c' } },
      { output: { id: '6', re: [11], ty: ['Integer'], to: 'c', from: ':U:1' } },
    );
  });

  it("super:: passes args to the parent's function", async () => {
    await expectBehavior(layers,
      { input: { id: '1', op: [[], '$new'], to: ':U', from: 'c' } },
      { output: { id: '1', re: ['#<:U:1>'], ty: [':U'], to: 'c' } },
      { input: { id: '2', op: [[4], 'viaAdd'], ty: [['Integer']], to: ':U:1', from: 'c' } },
      { output: { id: '2', re: [13], ty: ['Integer'], to: 'c', from: ':U:1' } },
    );
  });

  it('a cell the subclass leaves alone is the one cell', async () => {
    await expectBehavior(layers,
      { input: { id: '1', op: [[], '$new'], to: ':V', from: 'c' } },
      { output: { id: '1', re: ['#<:V:1>'], ty: [':V'], to: 'c' } },
      { input: { id: '2', op: 'bump!', to: ':V:1', from: 'c' } },
      { output: { id: '2', re: ['#<:V:1>'], ty: [':V'], to: 'c', from: ':V:1' } },
      { input: { id: '3', op: 'parentTotal', to: ':V:1', from: 'c' } },
      { output: { id: '3', re: [6], ty: ['Integer'], to: 'c', from: ':V:1' } },
    );
  });

  it("two levels: each override's super:: is its own parent's", async () => {
    await expectBehavior(layers,
      { input: { id: '1', op: [[], '$new'], to: ':W', from: 'c' } },
      { output: { id: '1', re: ['#<:W:1>'], ty: [':W'], to: 'c' } },
      { input: { id: '2', op: 'a', to: ':W:1', from: 'c' } },
      { output: { id: '2', re: [211], ty: ['Integer'], to: 'c', from: ':W:1' } },
      { input: { id: '3', op: 'parentTotal', to: ':W:1', from: 'c' } },
      { output: { id: '3', re: [5], ty: ['Integer'], to: 'c', from: ':W:1' } },
      { input: { id: '4', op: 'readTotal', to: ':W:1', from: 'c' } },
      { output: { id: '4', re: [11], ty: ['Integer'], to: 'c', from: ':W:1' } },
    );
  });

  it('super[T]:: picks among two parents', async () => {
    await expectBehavior(layers,
      { input: { id: '1', op: [[3], '$new'], ty: [['Integer']], to: ':C', from: 'c' } },
      { output: { id: '1', re: ['#<:C:1>'], ty: [':C'], to: 'c' } },
      { input: { id: '2', op: 'both', to: ':C:1', from: 'c' } },
      { output: { id: '2', re: [15], ty: ['Integer'], to: 'c', from: ':C:1' } },
    );
  });
});

describe('super — errors', () => {
  const T = `
    T = *{
      h = -> 1
      @a = { return 1 }
      #c = -> 2
    }
  `;

  it('two parents defining the name need super[T]', () => {
    expect(() => compileSource(`
      A = *{ h = -> 1 }
      B = *{ h = -> 2 }
      C = A ++ B ++ *{ @x = { return super::h() } }
    `)).toThrow("'super::h' in 'C' is ambiguous: 'A' and 'B' both define 'h' — write 'super[A]::h()' or 'super[B]::h()'");
  });

  it('super[S] names a direct parent only', () => {
    expect(() => compileSource(`${T}
      U = T ++ *{}
      V = U ++ *{ @x = { return super[T]::h() } }
    `)).toThrow("'super[T]::h' in 'V': 'T' isn't a direct parent of 'V' — only a direct parent's layer can be named for now");
  });

  it('super is not a value', () => {
    expect(() => compileSource(`${T}
      U = T ++ *{ @x = { s = super; return 1 } }
    `)).toThrow("'super' names the parent layer, which isn't a value");
  });

  it('after :: a name is written bare', () => {
    expect(() => compileSource(`${T}
      U = T ++ *{ @x = { return super::@a() } }
    `)).toThrow("'super::@a' — a public member is reached through a dot: write 'super.a'");
    expect(() => compileSource(`${T}
      U = T ++ *{ @x = { return super::#c() } }
    `)).toThrow("'super::#c' — a private name is never reached through an address");
  });

  it('a name no parent defines', () => {
    expect(() => compileSource(`${T}
      U = T ++ *{ @x = { return super::g() } }
    `)).toThrow("'super::g' in 'U': 'T' has no protected 'g'");
  });

  it('super in a class with no parent', () => {
    expect(() => compileSource(`
      T = *{ @x = { return super::h() } }
    `)).toThrow("'super::h' in 'T': 'super' names a parent layer, and 'T' has no parent");
  });

  it('super is reserved', () => {
    expect(() => compileSource(`
      @x = {
        super = 1
        return 1
      }
    `)).toThrow("'super' is reserved");
  });
});

describe('super — retired forms', () => {
  it('a wrapped parent', () => {
    expect(() => compileSource(`
      T = *{ @a = { return 1 } }
      U = (sup T ++) *{ @b = { return sup.a() } }
    `)).toThrow("In 'U', the wrapped parent 'sup T' is retired — write 'U = T ++ …' and reach the parent layer with 'super::name' (protected) or 'super.name' (public)");
  });

  it('several wrapped parents', () => {
    expect(() => compileSource(`
      A = *{}
      B = *{}
      C = (sa A ++ sb B ++) *{}
    `)).toThrow("In 'C', the wrapped parent 'sa A' is retired");
  });

  it('a parent inside the params', () => {
    expect(() => compileSource(`
      T = *{}
      U = (T ++ u Text) *{}
    `)).toThrow("In 'U', parents go before the params, outside the parens — write 'U = T ++ (…) *{ … }'");
  });

  it('parents alone in parens', () => {
    expect(() => compileSource(`
      T = *{}
      U = (T++) *{}
    `)).toThrow("In 'U', parents go before the params, outside the parens — write 'U = T ++ *{ … }'");
    expect(() => compileSource(`
      A = *{}
      B = *{}
      C = (A ++ B) *{}
    `)).toThrow("In 'C', parents go before the params, outside the parens — write 'C = A ++ B ++ *{ … }'");
  });
});
