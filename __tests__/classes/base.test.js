import { compileSource, expectBehavior } from '../helpers.js';

// `base`: the parent layer, reached within the same actor. `base::name` is the
// parent's protected `name`, `base.name` its public `@name`, and `base[T]::name`
// parent `T`'s. Inheritance is merged and late-bound: the parent's own code sees the
// subclass's override, and `base::` is how the override reaches the parent's.
//
// A cell the subclass redeclares has the parent layer's own cell behind it, which
// `base::name` reads and writes; the parent's code uses the subclass's.
//
// See notes/class-scope-and-inheritance-2026-11-16.md.

const layers = `
  @T = *{
    total *Integer = 5
    h = () -> 1
    add = (n Integer) -> n + 1
    @a = {
      x Integer = h() + 100
      return x
    }
    @pub = { return 7 }
    @readTotal = { return total }
  }

  @U = @T ^ *{
    total *Integer = base::total + 6
    h = () -> base::h() + 10
    @pub = {
      x Integer = base.pub()
      return x + 1
    }
    @parentTotal = {
      x Integer = base::total
      return x
    }
    @bumpParent! = { base::total <- base::total + 100 }
    add = (n Integer) -> n * 2
    @viaAdd = (n Integer) {
      x Integer = base::add(n)
      y Integer = add(n)
      return x + y
    }
  }

  @V = @T ^ *{
    @parentTotal = {
      x Integer = base::total
      return x
    }
    @bump! = { total <- total + 1 }
  }

  @W = @U ^ *{
    h = () -> base::h() + 100
  }

  A = *{ h = () -> 1 }
  B = *{ h = () -> 2 }
  @C = A ^ B ^ *(k Integer) {
    super[A]()
    super[B]()
    h = () -> 0
    @both = {
      x Integer = base[A]::h() * 10 + base[B]::h() + k
      return x
    }
  }
`;

describe('base — layers', () => {
  it("the parent's code sees the override, and base:: reaches the parent's", async () => {
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

  it("base. reaches the parent's public function", async () => {
    await expectBehavior(layers,
      { input: { id: '1', op: [[], '$new'], to: ':U', from: 'c' } },
      { output: { id: '1', re: ['#<:U:1>'], ty: [':U'], to: 'c' } },
      { input: { id: '2', op: 'pub', to: ':U:1', from: 'c' } },
      { output: { id: '2', re: [8], ty: ['Integer'], to: 'c', from: ':U:1' } },
    );
  });

  it("a redeclared cell: the parent's code uses the subclass's, base:: the parent's own", async () => {
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

  it("base:: passes args to the parent's function", async () => {
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

  it("two levels: each override's base:: is its own parent's", async () => {
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

  it('base[T]:: picks among two parents', async () => {
    await expectBehavior(layers,
      { input: { id: '1', op: [[3], '$new'], ty: [['Integer']], to: ':C', from: 'c' } },
      { output: { id: '1', re: ['#<:C:1>'], ty: [':C'], to: 'c' } },
      { input: { id: '2', op: 'both', to: ':C:1', from: 'c' } },
      { output: { id: '2', re: [15], ty: ['Integer'], to: 'c', from: ':C:1' } },
    );
  });
});

describe('base — errors', () => {
  const T = `
    T = *{
      h = () -> 1
      @a = { return 1 }
      #c = () -> 2
    }
  `;

  it('two parents defining the name need base[T]', () => {
    expect(() => compileSource(`
      A = *{ h = () -> 1 }
      B = *{ h = () -> 2 }
      C = A ^ B ^ *{ @x = { return base::h() } }
    `)).toThrow("'base::h' in 'C' is ambiguous: 'A' and 'B' both define 'h' — write 'base[A]::h()' or 'base[B]::h()'");
  });

  it('base[S] names a direct parent only', () => {
    expect(() => compileSource(`${T}
      U = T ^ *{}
      V = U ^ *{ @x = { return base[T]::h() } }
    `)).toThrow("'base[T]::h' in 'V': 'T' isn't a direct parent of 'V' — only a direct parent's layer can be named for now");
  });

  it('base is not a value', () => {
    expect(() => compileSource(`${T}
      U = T ^ *{ @x = { s = base; return 1 } }
    `)).toThrow("'base' names the parent layer, which isn't a value");
  });

  it('a name no parent defines', () => {
    expect(() => compileSource(`${T}
      U = T ^ *{ @x = { return base::g() } }
    `)).toThrow("'base::g' in 'U': 'T' has no protected 'g'");
  });

  it('base in a class with no parent', () => {
    expect(() => compileSource(`
      T = *{ @x = { return base::h() } }
    `)).toThrow("'base::h' in 'T': 'base' names a parent layer, and 'T' has no parent");
  });

});

describe('base — reserved', () => {
  const reserved = (line) => new RegExp(`^'base' is reserved: it names the parent layer, so it can't be declared or set \\(line ${line}\\)$`);

  it('a cell named base', () => {
    expect(() => compileSource('base *Integer = 1\n@f = () -> 1\n')).toThrow(reserved(1));
  });

  it('a local named base', () => {
    expect(() => compileSource('@f = {\n  base Integer = 1\n  return 1\n}\n')).toThrow(reserved(2));
  });

  it('an untyped local named base', () => {
    expect(() => compileSource('@f = {\n  base = 1\n  return 1\n}\n')).toThrow(reserved(2));
  });

  it('a param named base', () => {
    expect(() => compileSource('@f = (base Integer) -> 1\n')).toThrow(reserved(1));
  });

  it('setting base', () => {
    expect(() => compileSource('n *Integer = 1\n@f! = { base <- 2 }\n')).toThrow(reserved(2));
  });

  it('a use binding named base', () => {
    expect(() => compileSource('use base = "x.bv" as { n () -> (Integer) }\n@f = () -> 1\n')).toThrow(reserved(1));
  });
});

describe('base — as a member or key', () => {
  const script = `
    C = *{
      @base = { return 6 }
    }
    @viaMember = {
      c = C()
      n Integer = c.base()
      return n
    }
    @asKey = () -> (base: 10)
  `;

  it('@base is a public function, and c.base() calls it', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'viaMember', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [6], to: 'c' }) },
    );
  });

  it('base: is a named field', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'asKey', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [{ base: 10 }], to: 'c' }) },
    );
  });
});

describe('super — reserved: not a receiver, not settable', () => {
  const T = 'T = *{\n  h = () -> 1\n  @a = { return 1 }\n}\n';

  it('super.x', () => {
    expect(() => compileSource(`${T}U = T ^ *{ @x = () -> super.a() }\n`)).toThrow("Unexpected token in expression: DOT");
  });

  it('super::x', () => {
    expect(() => compileSource(`${T}U = T ^ *{ @x = () -> super::h() }\n`)).toThrow("Unexpected token in expression: DCOLON");
  });

  it('super = …', () => {
    expect(() => compileSource(`${T}U = T ^ *{ super = 1 }\n`)).toThrow("Unexpected token in expression: EQUALS");
  });
});

