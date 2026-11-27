import { compileSource, expectBehavior } from '../helpers.js';

// `super` in a constructor builds the base (notes/super-2026-11-19.md): the parent's
// constructor runs at the `super` line, with the args `super` passes. A subclass with
// a constructor of its own takes its own params only.
//
//   super(args)   the parent's constructor with these args
//   super         the constructor's own args, as received
//   super()       none: the parent's defaults
//   super[A](…)   one of several parents (`super[@A]` for a public one)

const constructors = `
  @T = *(n Integer = 7) {
    seen Integer = n
    @seen = { return seen }
  }
  @Same = @T ^ *(n Integer) { super(n) }
  @Doubled = @T ^ *(label Text, n Integer) {
    super(n * 2)
    @label = { return label }
    @own = { return n }
  }
  @Bare = @T ^ *(n Integer) { super }
  @Defaulted = @T ^ *(n Integer) { super() }

  @N = *(a: Integer, b: Integer = 100) {
    @sum = { return a + b }
  }
  @NamedBare = @N ^ *(a: Integer, b: Integer) { super }
  @NamedSome = @N ^ *(a: Integer) { super(a: a + 1) }

  @O = *{
    got Integer = probe()
    probe = () -> 0
    @got = { return got }
  }
  @Ordered = @O ^ *(k Integer) {
    marker Integer = k
    super()
    after Integer = got + 1
    probe = () -> marker
    @after = { return after }
  }

  @A = *(x Integer) { @x = { return x } }
  @B = *(y Integer) { @y = { return y } }
  @AB = @A ^ @B ^ *(n Integer) {
    super[@A](n)
    super[@B](n * 10)
  }
`;

describe('super — in a constructor', () => {
  it('passes an arg as is', async () => {
    await expectBehavior(constructors,
      { input: { id: '1', op: [[3], '$new'], ty: [['Integer']], to: ':Same', from: 'c' } },
      { output: { id: '1', re: ['#<:Same:1>'], ty: [':Same'], to: 'c' } },
      { input: { id: '2', op: 'seen', to: ':Same:1', from: 'c' } },
      { output: { id: '2', re: [3], ty: ['Integer'], to: 'c', from: ':Same:1' } },
    );
  });

  it("passes an amended arg; the parent's param and the subclass's are apart", async () => {
    await expectBehavior(constructors,
      { input: { id: '1', op: [['hi', 3], '$new'], ty: [['Text', 'Integer']], to: ':Doubled', from: 'c' } },
      { output: { id: '1', re: ['#<:Doubled:1>'], ty: [':Doubled'], to: 'c' } },
      { input: { id: '2', op: 'seen', to: ':Doubled:1', from: 'c' } },
      { output: { id: '2', re: [6], ty: ['Integer'], to: 'c', from: ':Doubled:1' } },
      { input: { id: '3', op: 'own', to: ':Doubled:1', from: 'c' } },
      { output: { id: '3', re: [3], ty: ['Integer'], to: 'c', from: ':Doubled:1' } },
      { input: { id: '4', op: 'label', to: ':Doubled:1', from: 'c' } },
      { output: { id: '4', re: ['hi'], ty: ['Text'], to: 'c', from: ':Doubled:1' } },
    );
  });

  it('bare super passes the args as received; super() passes none', async () => {
    await expectBehavior(constructors,
      { input: { id: '1', op: [[4], '$new'], ty: [['Integer']], to: ':Bare', from: 'c' } },
      { output: { id: '1', re: ['#<:Bare:1>'], ty: [':Bare'], to: 'c' } },
      { input: { id: '2', op: 'seen', to: ':Bare:1', from: 'c' } },
      { output: { id: '2', re: [4], ty: ['Integer'], to: 'c', from: ':Bare:1' } },
      { input: { id: '3', op: [[4], '$new'], ty: [['Integer']], to: ':Defaulted', from: 'c' } },
      { output: { id: '3', re: ['#<:Defaulted:1>'], ty: [':Defaulted'], to: 'c' } },
      { input: { id: '4', op: 'seen', to: ':Defaulted:1', from: 'c' } },
      { output: { id: '4', re: [7], ty: ['Integer'], to: 'c', from: ':Defaulted:1' } },
    );
  });

  it('named args: bare super passes them by name; a left-out one takes its default', async () => {
    await expectBehavior(constructors,
      { input: { id: '1', op: [[{ a: 1, b: 2 }], '$new'], ty: [[{ a: 'Integer', b: 'Integer' }]], to: ':NamedBare', from: 'c' } },
      { output: { id: '1', re: ['#<:NamedBare:1>'], ty: [':NamedBare'], to: 'c' } },
      { input: { id: '2', op: 'sum', to: ':NamedBare:1', from: 'c' } },
      { output: { id: '2', re: [3], ty: ['Integer'], to: 'c', from: ':NamedBare:1' } },
      { input: { id: '3', op: [[{ a: 1 }], '$new'], ty: [[{ a: 'Integer' }]], to: ':NamedSome', from: 'c' } },
      { output: { id: '3', re: ['#<:NamedSome:1>'], ty: [':NamedSome'], to: 'c' } },
      { input: { id: '4', op: 'sum', to: ':NamedSome:1', from: 'c' } },
      { output: { id: '4', re: [102], ty: ['Integer'], to: 'c', from: ':NamedSome:1' } },
    );
  });

  it("the parent's body runs at the super line", async () => {
    await expectBehavior(constructors,
      { input: { id: '1', op: [[5], '$new'], ty: [['Integer']], to: ':Ordered', from: 'c' } },
      { output: { id: '1', re: ['#<:Ordered:1>'], ty: [':Ordered'], to: 'c' } },
      { input: { id: '2', op: 'got', to: ':Ordered:1', from: 'c' } },
      { output: { id: '2', re: [5], ty: ['Integer'], to: 'c', from: ':Ordered:1' } },
      { input: { id: '3', op: 'after', to: ':Ordered:1', from: 'c' } },
      { output: { id: '3', re: [6], ty: ['Integer'], to: 'c', from: ':Ordered:1' } },
    );
  });

  it('each of two parents is built with its own super[P]', async () => {
    await expectBehavior(constructors,
      { input: { id: '1', op: [[2], '$new'], ty: [['Integer']], to: ':AB', from: 'c' } },
      { output: { id: '1', re: ['#<:AB:1>'], ty: [':AB'], to: 'c' } },
      { input: { id: '2', op: 'x', to: ':AB:1', from: 'c' } },
      { output: { id: '2', re: [2], ty: ['Integer'], to: 'c', from: ':AB:1' } },
      { input: { id: '3', op: 'y', to: ':AB:1', from: 'c' } },
      { output: { id: '3', re: [20], ty: ['Integer'], to: 'c', from: ':AB:1' } },
    );
  });
});

// `super` on each branch of an `if`, a statement or an expression: the base is
// built on the branch taken, at the call, so what follows it there reads the base.
describe('super — in a constructor, on the branches of an if', () => {
  const script = `
    @T = *(n Integer) {
      seen *Integer = n
      @n = () -> n
    }
    @U = @T ^ *(k Integer) {
      x Integer = if k > 0 {
        super(k * 10)
        seen + 1
      } else {
        super(0)
        2
      }
      @x = () -> x
    }
    @V = @T ^ *(k Integer) {
      y *Integer = 0
      if k > 0 {
        super(k)
        y <- seen * 2
      } else {
        super(5)
      }
      @y = () -> y
    }
  `;

  it('as a statement: the branch taken builds the base, and reads it after', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[4], '$new'], ty: [['Integer']], to: ':V', from: 'c' } },
      { output: { id: '1', re: ['#<:V:1>'], ty: [':V'], to: 'c' } },
      { input: { id: '2', op: 'n', to: ':V:1', from: 'c' } },
      { output: { id: '2', re: [4], ty: ['Integer'], to: 'c', from: ':V:1' } },
      { input: { id: '3', op: 'y', to: ':V:1', from: 'c' } },
      { output: { id: '3', re: [8], ty: ['Integer'], to: 'c', from: ':V:1' } },
      { input: { id: '4', op: [[0], '$new'], ty: [['Integer']], to: ':V', from: 'c' } },
      { output: { id: '4', re: ['#<:V:2>'], ty: [':V'], to: 'c' } },
      { input: { id: '5', op: 'n', to: ':V:2', from: 'c' } },
      { output: { id: '5', re: [5], ty: ['Integer'], to: 'c', from: ':V:2' } },
      { input: { id: '6', op: 'y', to: ':V:2', from: 'c' } },
      { output: { id: '6', re: [0], ty: ['Integer'], to: 'c', from: ':V:2' } },
    );
  });


  it('in an expression: the branch taken builds the base, and its value reads it', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[3], '$new'], ty: [['Integer']], to: ':U', from: 'c' } },
      { output: { id: '1', re: ['#<:U:1>'], ty: [':U'], to: 'c' } },
      { input: { id: '2', op: 'n', to: ':U:1', from: 'c' } },
      { output: { id: '2', re: [30], ty: ['Integer'], to: 'c', from: ':U:1' } },
      { input: { id: '3', op: 'x', to: ':U:1', from: 'c' } },
      { output: { id: '3', re: [31], ty: ['Integer'], to: 'c', from: ':U:1' } },
      { input: { id: '4', op: [[-1], '$new'], ty: [['Integer']], to: ':U', from: 'c' } },
      { output: { id: '4', re: ['#<:U:2>'], ty: [':U'], to: 'c' } },
      { input: { id: '5', op: 'n', to: ':U:2', from: 'c' } },
      { output: { id: '5', re: [0], ty: ['Integer'], to: 'c', from: ':U:2' } },
      { input: { id: '6', op: 'x', to: ':U:2', from: 'c' } },
      { output: { id: '6', re: [2], ty: ['Integer'], to: 'c', from: ':U:2' } },
    );
  });
});

describe('super — in a constructor — compile errors', () => {
  const T = 'T = *(n Integer = 7) {\n  seen Integer = n\n  h = () -> n\n  @seen = { return seen }\n}\n';
  const AB = 'A = *{}\nB = *{}\n';
  const compile = (source) => () => compileSource(`${source}@go = () -> 1\n`);

  it("a base name read before the super line", () => {
    expect(compile(`${T}U = T ^ *(n Integer) {\n  x Integer = seen + 1\n  super(n)\n}\n`))
      .toThrow("'seen' in 'U' is the base's, read before 'super': the base is built at that line");
  });

  it("a base function called before the super line, or in its args", () => {
    expect(compile(`${T}U = T ^ *(n Integer) {\n  x Integer = h()\n  super(n)\n}\n`))
      .toThrow("'h' in 'U' is the base's, read before 'super'");
    expect(compile(`${T}U = T ^ *(n Integer) {\n  super(seen)\n}\n`))
      .toThrow("'seen' in 'U' is the base's, read before 'super'");
  });

  it('called on one branch of an if', () => {
    expect(compile(`${T}U = T ^ *(n Integer) {\n  x Integer = if n > 0 {\n    super(n)\n    1\n  } else {\n    2\n  }\n}\n`))
      .toThrow("'super(…)' in 'U' is called on one branch of an 'if': an 'if' whose branch calls 'super' needs an 'else' that calls it too");
    expect(compile(`${T}U = T ^ *(n Integer) {\n  x Integer | null = if n > 0 {\n    super(n)\n    1\n  }\n}\n`))
      .toThrow("needs an 'else' that calls it too");
  });

  it('on a branch, more than once or not as a statement of it', () => {
    expect(compile(`${T}U = T ^ *(n Integer) {\n  x Integer = if n > 0 {\n    super(n)\n    super(n)\n    1\n  } else {\n    super(0)\n    2\n  }\n}\n`))
      .toThrow("'super(…)' in 'U': in an 'if', each branch calls 'super' once, as a statement of the branch");
    expect(compile(`${T}U = T ^ *(n Integer) {\n  x Integer = if n > 0 {\n    y Integer = if n > 1 {\n      super(n)\n      1\n    } else {\n      super(1)\n      2\n    }\n    y\n  } else {\n    super(0)\n    2\n  }\n}\n`))
      .toThrow("in an 'if', each branch calls 'super' once, as a statement of the branch");
  });

  it('a base name read on a branch above its super, or in the if\'s condition', () => {
    expect(compile(`${T}U = T ^ *(n Integer) {\n  x Integer = if n > 0 {\n    y Integer = seen\n    super(n)\n    y\n  } else {\n    super(0)\n    2\n  }\n}\n`))
      .toThrow("'seen' in 'U' is the base's, read before 'super'");
    expect(compile(`${T}U = T ^ *(n Integer) {\n  if seen > 0 {\n    super(n)\n  } else {\n    super(0)\n  }\n}\n`))
      .toThrow("'seen' in 'U' is the base's, read before 'super'");
  });

  it('in a loop', () => {
    expect(compile(`${T}U = T ^ *(n Integer) {\n  xs List of Integers = [1, 2]\n  ys List of Integers = over(xs) (x Integer) {\n    super(x)\n    x\n  }\n}\n`))
      .toThrow("'super(…)' in 'U' runs once: it can't be in a loop or a function");
  });

  it('twice', () => {
    expect(compile(`${T}U = T ^ *(n Integer) {\n  super(n)\n  super(n)\n}\n`))
      .toThrow("'super' in 'U' is called twice: the base is built once");
  });

  it("never, in a constructor of its own that doesn't define the parent's interface", () => {
    expect(compile(`${T}U = T ^ *(n Integer) {\n  @x = () -> 1\n}\n`))
      .toThrow("'U' never calls 'super(…)', so it has no base for 'T', and must define the whole public interface of 'T'; missing: '@seen' (0 args)");
  });

  it('bare super with two parents', () => {
    expect(compile(`${AB}C = A ^ B ^ *(n Integer) {\n  super\n}\n`))
      .toThrow("'super' in 'C' is ambiguous: 'C' has parents 'A' and 'B' — write 'super[A](…)' and 'super[B](…)'");
    expect(compile(`${AB}C = A ^ B ^ *(n Integer) {\n  super()\n}\n`))
      .toThrow("'super(…)' in 'C' is ambiguous");
  });

  it('one of two parents never built, with no interface to define, is no base for it', () => {
    expect(compile(`${AB}C = A ^ B ^ *(n Integer) {\n  super[A]()\n}\n`)).not.toThrow();
  });

  it('super[X] for a class that is not a parent', () => {
    expect(compile(`${T}V = *{}\nU = T ^ *(n Integer) {\n  super[V](n)\n}\n`))
      .toThrow("'super[V](…)' in 'U': 'V' isn't a parent of 'U'");
  });

  it('in a class with no parent', () => {
    expect(compile('V = *(n Integer) {\n  super(n)\n}\n'))
      .toThrow("'super(…)' in 'V': 'super' builds the base, and 'V' has no parent");
  });

  it("args that don't fit the parent's params", () => {
    expect(compile(`${T}U = T ^ *(n Integer) {\n  super(n, n)\n}\n`))
      .toThrow("'super(…)' in 'U': 'T' takes 1 positional arg, got 2");
    expect(compile(`${T}U = T ^ *(n Integer) {\n  super(m: n)\n}\n`))
      .toThrow("'super(…)' in 'U': 'T' has no param 'm'");
    expect(compile('S = *(a Integer) {}\nU = S ^ *(n Integer) {\n  super()\n}\n'))
      .toThrow("'super(…)' in 'U': 'S' takes 'a', which isn't passed");
    expect(compile(`${T}U = T ^ *(label Text, n Integer) {\n  super\n}\n`))
      .toThrow("'super' in 'U' (its args as received): 'T' takes 1 positional arg, got 2");
  });

  it("an arg of the wrong type for the parent's param", () => {
    expect(compile(`${T}U = T ^ *(n Text) {\n  super(n)\n}\n`))
      .toThrow("Cannot bind 'n Integer' to 'n', which is Text");
  });

  it('super stays reserved', () => {
    expect(compile(`${T}U = T ^ *(n Integer) {\n  super = 1\n}\n`)).toThrow('Unexpected token in expression: EQUALS');
    expect(compile(`${T}U = T ^ *(n Integer) {\n  super(n)\n  @x = () -> super.seen()\n}\n`)).toThrow('Unexpected token in expression: DOT');
    expect(compile(`${T}U = T ^ *(n Integer) {\n  super(n)\n  @x = () -> super::h()\n}\n`)).toThrow('Unexpected token in expression: DCOLON');
  });
});

// `super` in a function: the base's same function. `super(args)` in `h` is
// `base::h(args)`, in `@h` it's `base.h(args)`.
const functions = `
  @T = *{
    h = (n Integer) -> n + 1
    @useH = (n Integer) { x Integer = h(n); return x }
    @a = (x Integer) -> x * 2
    @c = (x Integer) { y Integer = h(x); return y }
    @d = (x Integer = 3) -> x
    @e = (x Integer = 3) -> x
    @nm = (k: Integer) -> k
    @o = (x Integer) -> 1
    @o << (x Text) -> 2
    @lam = (x Integer) -> x + 7
  }
  @U = @T ^ *{
    h = (n Integer) -> super * 10
    @a = (x Integer) { y Integer = super(x + 1); return y }
    @c = (x Integer) { y Integer = super(x) + 1000; return y }
    @d = (x Integer = 3) { y Integer = super() + 100; return y }
    @e = (x Integer = 3) { y Integer = super + 100; return y }
    @nm = (k: Integer) { y Integer = super + 1; return y }
    @o = (x Integer) { y Integer = super("t") + 10; return y }
    @lam = (x Integer) {
      f = () -> super
      y Integer = f()
      return y
    }
  }
  @V = @U ^ *{
    h = (n Integer) -> super + 3
  }
`;

describe('super — in a function', () => {
  it('protected, bare: the parent layer\'s h with the args as received, late-bound', async () => {
    await expectBehavior(functions,
      { input: { id: '1', op: [[], '$new'], to: ':U', from: 'c' } },
      { output: { id: '1', re: ['#<:U:1>'], ty: [':U'], to: 'c' } },
      { input: { id: '2', op: [[4], 'useH'], ty: [['Integer']], to: ':U:1', from: 'c' } },
      { output: { id: '2', re: [50], ty: ['Integer'], to: 'c', from: ':U:1' } },
    );
  });

  it('public, with args', async () => {
    await expectBehavior(functions,
      { input: { id: '1', op: [[], '$new'], to: ':U', from: 'c' } },
      { output: { id: '1', re: ['#<:U:1>'], ty: [':U'], to: 'c' } },
      { input: { id: '2', op: [[4], 'a'], ty: [['Integer']], to: ':U:1', from: 'c' } },
      { output: { id: '2', re: [10], ty: ['Integer'], to: 'c', from: ':U:1' } },
    );
  });

  it("the parent's function, run through super, uses the subclass's overrides", async () => {
    await expectBehavior(functions,
      { input: { id: '1', op: [[], '$new'], to: ':U', from: 'c' } },
      { output: { id: '1', re: ['#<:U:1>'], ty: [':U'], to: 'c' } },
      { input: { id: '2', op: [[1], 'c'], ty: [['Integer']], to: ':U:1', from: 'c' } },
      { output: { id: '2', re: [1020], ty: ['Integer'], to: 'c', from: ':U:1' } },
    );
  });

  it('super() passes none, so the parent takes its default; bare super passes the args', async () => {
    await expectBehavior(functions,
      { input: { id: '1', op: [[], '$new'], to: ':U', from: 'c' } },
      { output: { id: '1', re: ['#<:U:1>'], ty: [':U'], to: 'c' } },
      { input: { id: '2', op: [[5], 'd'], ty: [['Integer']], to: ':U:1', from: 'c' } },
      { output: { id: '2', re: [103], ty: ['Integer'], to: 'c', from: ':U:1' } },
      { input: { id: '3', op: [[5], 'e'], ty: [['Integer']], to: ':U:1', from: 'c' } },
      { output: { id: '3', re: [105], ty: ['Integer'], to: 'c', from: ':U:1' } },
      { input: { id: '4', op: [[{ k: 1 }], 'nm'], ty: [[{ k: 'Integer' }]], to: ':U:1', from: 'c' } },
      { output: { id: '4', re: [2], ty: ['Integer'], to: 'c', from: ':U:1' } },
    );
  });

  it("dispatches over the parent's clauses", async () => {
    await expectBehavior(functions,
      { input: { id: '1', op: [[], '$new'], to: ':U', from: 'c' } },
      { output: { id: '1', re: ['#<:U:1>'], ty: [':U'], to: 'c' } },
      { input: { id: '2', op: [[1], 'o'], ty: [['Integer']], to: ':U:1', from: 'c' } },
      { output: { id: '2', re: [12], ty: ['Integer'], to: 'c', from: ':U:1' } },
    );
  });

  it("in a lambda, super is the enclosing function's", async () => {
    await expectBehavior(functions,
      { input: { id: '1', op: [[], '$new'], to: ':U', from: 'c' } },
      { output: { id: '1', re: ['#<:U:1>'], ty: [':U'], to: 'c' } },
      { input: { id: '2', op: [[1], 'lam'], ty: [['Integer']], to: ':U:1', from: 'c' } },
      { output: { id: '2', re: [8], ty: ['Integer'], to: 'c', from: ':U:1' } },
    );
  });

  it("two levels: each layer's super is its own parent's", async () => {
    await expectBehavior(functions,
      { input: { id: '1', op: [[], '$new'], to: ':V', from: 'c' } },
      { output: { id: '1', re: ['#<:V:1>'], ty: [':V'], to: 'c' } },
      { input: { id: '2', op: [[4], 'useH'], ty: [['Integer']], to: ':V:1', from: 'c' } },
      { output: { id: '2', re: [53], ty: ['Integer'], to: 'c', from: ':V:1' } },
    );
  });
});

describe('super — in a function — compile errors', () => {
  const T = 'T = *{\n  h = (n Integer) -> n + 1\n  @a = (x Integer) -> x * 2\n}\n';
  const AB = 'A = *{ @f = () -> 1 }\nB = *{ @f = () -> 2 }\n';
  const compile = (source) => () => compileSource(`${source}@go = () -> 1\n`);

  it('in a function no parent defines', () => {
    expect(compile(`${T}U = T ^ *{\n  @z = () -> super\n}\n`)).toThrow("'super' in '@z' of 'U': 'T' has no public 'z'");
    expect(compile(`${T}U = T ^ *{\n  k = () -> super()\n}\n`)).toThrow("'super(…)' in 'k' of 'U': 'T' has no protected 'k'");
  });

  it('in a class with no parent, or the file', () => {
    expect(compile('V = *{\n  @f = () -> super\n}\n')).toThrow("'super' in '@f' of 'V': 'super' calls '@f' one layer up, and 'V' has no parent");
    expect(compile('@f = () -> super\n')).toThrow("'super' in '@f' of this file: 'super' calls '@f' one layer up, and it has none");
  });

  it('bare super, or super(…), with two parents', () => {
    expect(compile(`${AB}C = A ^ B ^ *{\n  @f = () -> super\n}\n`)).toThrow("'super' in '@f' of 'C' is ambiguous: 'C' has parents 'A' and 'B' — write 'super[A](…)' or 'super[B](…)'");
    expect(compile(`${AB}C = A ^ B ^ *{\n  @f = () -> super()\n}\n`)).toThrow("'super(…)' in '@f' of 'C' is ambiguous");
  });

  it('super[A](…) picks a direct parent, and only a direct one', () => {
    expect(compile(`${AB}C = A ^ B ^ *{\n  @f = { x Integer = super[A]() + super[B](); return x }\n}\n`)).not.toThrow();
    expect(compile('A = *{ @f = () -> 1 }\nB = A ^ *{}\nC = B ^ *{\n  @f = () -> super[A]()\n}\n')).toThrow("'super[A](…)' in 'C': 'A' isn't a direct parent of 'C'");
  });

  it('in a private function', () => {
    expect(compile(`${T}U = T ^ *{\n  #h = () -> super\n}\n`)).toThrow("'super' in '#h' of 'U': a private function has no parent layer");
  });

  it("bare super in a lambda whose param hides the function's", () => {
    expect(compile(`${T}U = T ^ *{\n  h = (n Integer) {\n    g = (n Integer) -> super\n    return g(1)\n  }\n}\n`))
      .toThrow("Bare 'super' in 'h' of 'U': the param 'n' of a function inside it hides h's — pass the args: 'super(…)'");
  });
});

// A constructor that never calls `super` builds no base: the parent's state isn't
// there and its constructor doesn't run. It's legal only when the subclass defines
// the parent's whole public interface, by name and arity.
const noBase = `
  @T = *(n Integer) {
    k Integer = 10 / n
    @total *Integer = 0
    @get = { return k }
    @add = (x Integer) -> x + k
  } ^ {
    prot *Integer = 2
  }
  @U = @T ^ *(m Integer) {
    @total *Integer = m
    @get = { return m }
    @add = (x Integer) { y Integer = x + m; return y }
    @fromBlock = { x Integer = @T::prot + m; return x }
  }
  take = (t @T) { x Integer = t.get(); return x }
  @viaParent = { u = @U(4); x Integer = take(u); return x }
`;

describe('super — never called: no base', () => {
  it("builds with none of the parent's state, and doesn't run its constructor", async () => {
    await expectBehavior(noBase,
      { input: { id: '1', op: [[4], '$new'], ty: [['Integer']], to: ':U', from: 'c' } },
      { output: { id: '1', re: ['#<:U:1>'], ty: [':U'], to: 'c' } },
      { input: { id: '2', op: 'get', to: ':U:1', from: 'c' } },
      { output: { id: '2', re: [4], ty: ['Integer'], to: 'c', from: ':U:1' } },
      { input: { id: '3', op: [[1], 'add'], ty: [['Integer']], to: ':U:1', from: 'c' } },
      { output: { id: '3', re: [5], ty: ['Integer'], to: 'c', from: ':U:1' } },
    );
  });

  it("reaches the parent's class block", async () => {
    await expectBehavior(noBase,
      { input: { id: '1', op: [[4], '$new'], ty: [['Integer']], to: ':U', from: 'c' } },
      { output: { id: '1', re: ['#<:U:1>'], ty: [':U'], to: 'c' } },
      { input: { id: '2', op: 'fromBlock', to: ':U:1', from: 'c' } },
      { output: { id: '2', re: [6], ty: ['Integer'], to: 'c', from: ':U:1' } },
    );
  });

  it('is still accepted where the parent is expected', async () => {
    await expectBehavior(noBase,
      { input: { id: '1', op: 'viaParent', from: 'c' } },
      { output: { id: '1', re: [4], ty: ['Integer'], to: 'c' } },
    );
  });
});

describe('super — never called: no base — compile errors', () => {
  const T = 'T = *(n Integer) {\n  count *Integer = n\n  @total *Integer = 0\n  h = () -> n + 1\n  @get = { return count }\n  @add = (x Integer) -> x + 1\n}\n';
  const full = '  @total *Integer = 5\n  @get = { return 1 }\n  @add = (x Integer) -> x + 2\n';
  const compile = (source) => () => compileSource(`${source}@go = () -> 1\n`);

  it('the whole public interface, defined, compiles', () => {
    expect(compile(`${T}U = T ^ *(m Integer) {\n${full}}\n`)).not.toThrow();
  });

  it('a public function missing, or with another arity', () => {
    expect(compile(`${T}U = T ^ *(m Integer) {\n  @total *Integer = 5\n  @get = { return 1 }\n}\n`))
      .toThrow("'U' never calls 'super(…)', so it has no base for 'T', and must define the whole public interface of 'T'; missing: '@add' (1 arg)");
    expect(compile(`${T}U = T ^ *(m Integer) {\n  @total *Integer = 5\n  @get = { return 1 }\n  @add = () -> 2\n}\n`))
      .toThrow("missing: '@add' (1 arg)");
  });

  it('a public cell missing', () => {
    expect(compile(`${T}U = T ^ *(m Integer) {\n  @get = { return 1 }\n  @add = (x Integer) -> x + 2\n}\n`))
      .toThrow("missing: '@total' (a cell)");
  });

  it('per parent, when there are several', () => {
    expect(compile('A = *{ @a = () -> 1 }\nB = *{ @b = () -> 2 }\nC = A ^ B ^ *(n Integer) {\n  super[A]()\n}\n'))
      .toThrow("'C' never calls 'super[B](…)', so it has no base for 'B', and must define the whole public interface of 'B'; missing: '@b' (0 args)");
    expect(compile('A = *{ @a = () -> 1 }\nB = *{ @b = () -> 2 }\nC = A ^ B ^ *(n Integer) {\n  super[A]()\n  @b = () -> 3\n}\n')).not.toThrow();
  });

  it("a protected name of the parent's that the subclass doesn't define", () => {
    expect(compile(`${T}U = T ^ *(m Integer) {\n${full}  @p = { x Integer = h(); return x }\n}\n`))
      .toThrow("'h' isn't in scope — it's 'T''s, and 'U' has no base for 'T' (it never calls 'super'): define it in 'U'");
    expect(compile(`${T}U = T ^ *(m Integer) {\n${full}  @p = { return count }\n}\n`))
      .toThrow("'count' isn't in scope — it's 'T''s");
    expect(compile(`${T}U = T ^ *(m Integer) {\n${full}  h = () -> 9\n  @p = { x Integer = h(); return x }\n}\n`)).not.toThrow();
  });

  it('super, base:: and base. in its functions', () => {
    expect(compile(`${T}U = T ^ *(m Integer) {\n  @total *Integer = 5\n  @get = { return 1 }\n  @add = (x Integer) { y Integer = super(x); return y }\n}\n`))
      .toThrow("'super(…)' in '@add' of 'U': 'U' has no base for 'T' (it never calls 'super(…)')");
    expect(compile(`${T}U = T ^ *(m Integer) {\n${full}  @q = { x Integer = base::h(); return x }\n}\n`))
      .toThrow("'base::h' in 'U': 'U' has no base for 'T'");
    expect(compile(`${T}U = T ^ *(m Integer) {\n${full}  @q = { x Integer = base.get(); return x }\n}\n`))
      .toThrow("'base.get' in 'U': 'U' has no base for 'T'");
  });

  it('super on some paths but not all is still an error', () => {
    expect(compile(`${T}U = T ^ *(m Integer) {\n${full}  x Integer = if m > 0 {\n    super(m)\n    1\n  } else {\n    2\n  }\n}\n`))
      .toThrow("needs an 'else' that calls it too");
  });
});

// `super` in a class block: the parent block's same function, run for the extending
// block, late-bound. A class block that extends another always has a base.
const blocks = `
  A = *{} ^ {
    count *Integer = 10
    shared *Integer = 5
    @f = { return 1 }
    h = (n Integer) -> n + count
    @useH = (n Integer) { x Integer = h(n); return x }
    @readShared = { return shared }
  }
  B = A ^ {
    count *Integer = 20
    @f = { x Integer = super + 1; return x }
    h = (n Integer) { x Integer = super * 10; return x }
    @parentCount = { x Integer = base::count; return x }
  }
  C = B ^ {
    @f = { x Integer = super + 100; return x }
  }
  @publicSuper = { x Integer = B.f(); return x }
  @protectedSuper = { x Integer = B.useH(1); return x }
  @parentCount = { x Integer = B.parentCount(); return x }
  @twoLevels = { x Integer = C.f(); return x }
`;

describe('super — in a class block', () => {
  it('public: the parent block\'s @f', async () => {
    await expectBehavior(blocks,
      { input: { id: '1', op: 'publicSuper', from: 'c' } },
      { output: { id: '1', re: [2], ty: ['Integer'], to: 'c' } },
    );
  });

  it("protected, bare: the parent block's h, which reads the cell the block redeclares", async () => {
    await expectBehavior(blocks,
      { input: { id: '1', op: 'protectedSuper', from: 'c' } },
      { output: { id: '1', re: [210], ty: ['Integer'], to: 'c' } },
    );
  });

  it("base:: reads the parent block's own cell", async () => {
    await expectBehavior(blocks,
      { input: { id: '1', op: 'parentCount', from: 'c' } },
      { output: { id: '1', re: [10], ty: ['Integer'], to: 'c' } },
    );
  });

  it("two levels: each block's super is its own parent block's", async () => {
    await expectBehavior(blocks,
      { input: { id: '1', op: 'twoLevels', from: 'c' } },
      { output: { id: '1', re: [102], ty: ['Integer'], to: 'c' } },
    );
  });
});

describe('super — in a class block — compile errors', () => {
  const compile = (source) => () => compileSource(`${source}@go = () -> 1\n`);

  it('in a block with no parent block', () => {
    expect(compile('A = *{} ^ {\n  @f = () -> super\n}\n')).toThrow("'super' in '@f' of the class block of 'A': 'super' calls '@f' one layer up, and it has none");
  });

  it("a function the parent block doesn't define", () => {
    expect(compile('A = *{} ^ {\n  @f = () -> 1\n}\nB = A ^ {\n  @g = () -> super\n}\n')).toThrow("'super' in '@g' of");
  });
});

// `class::base` is the running class's parent: in `T`'s code running for a `U`, it's
// `T`. `class::base::h` is the parent's class-block `h`, `class::base.f` its public
// `@f`, `class::base(…)` a new actor of the parent class.
const classBase = `
  @G = *{
    @kind = () -> 1
  } ^ {
    h = () -> 1
    @f = () -> 2
  }
  @T = @G ^ *{
    @kind = () -> 2
    @who = { x Integer = class::base::h(); return x }
    @whoPub = { x Integer = class::base.f(); return x }
    @make = { p = class::base(); x Integer = p.kind(); return x }
  } ^ {
    h = () -> 10
    @f = () -> 20
  }
  @U = @T ^ *{}
  @N = @T ^ *(m Integer) {
    @kind = () -> 3
    @who = { x Integer = class::base::h() + m; return x }
    @whoPub = () -> 0
    @make = () -> 0
  }
`;

describe('class::base', () => {
  it("is the running class's parent: G for a T, T for a U running T's code", async () => {
    await expectBehavior(classBase,
      { input: { id: '1', op: [[], '$new'], to: ':T', from: 'c' } },
      { output: { id: '1', re: ['#<:T:1>'], ty: [':T'], to: 'c' } },
      { input: { id: '2', op: 'who', to: ':T:1', from: 'c' } },
      { output: { id: '2', re: [1], ty: ['Integer'], to: 'c', from: ':T:1' } },
      { input: { id: '3', op: [[], '$new'], to: ':U', from: 'c' } },
      { output: { id: '3', re: ['#<:U:1>'], ty: [':U'], to: 'c' } },
      { input: { id: '4', op: 'who', to: ':U:1', from: 'c' } },
      { output: { id: '4', re: [10], ty: ['Integer'], to: 'c', from: ':U:1' } },
    );
  });

  it("class::base.f is the parent's public class-block @f", async () => {
    await expectBehavior(classBase,
      { input: { id: '1', op: [[], '$new'], to: ':T', from: 'c' } },
      { output: { id: '1', re: ['#<:T:1>'], ty: [':T'], to: 'c' } },
      { input: { id: '2', op: 'whoPub', to: ':T:1', from: 'c' } },
      { output: { id: '2', re: [2], ty: ['Integer'], to: 'c', from: ':T:1' } },
      { input: { id: '3', op: [[], '$new'], to: ':U', from: 'c' } },
      { output: { id: '3', re: ['#<:U:1>'], ty: [':U'], to: 'c' } },
      { input: { id: '4', op: 'whoPub', to: ':U:1', from: 'c' } },
      { output: { id: '4', re: [20], ty: ['Integer'], to: 'c', from: ':U:1' } },
    );
  });

  it('class::base(…) builds a separate actor of the parent class', async () => {
    await expectBehavior(classBase,
      { input: { id: '1', op: [[], '$new'], to: ':U', from: 'c' } },
      { output: { id: '1', re: ['#<:U:1>'], ty: [':U'], to: 'c' } },
      { input: { id: '2', op: 'make', to: ':U:1', from: 'c' } },
      { output: { id: '2', re: [2], ty: ['Integer'], to: 'c', from: ':U:1' } },
    );
  });

  it("a subclass with no base reaches its parent's class block", async () => {
    await expectBehavior(classBase,
      { input: { id: '1', op: [[5], '$new'], ty: [['Integer']], to: ':N', from: 'c' } },
      { output: { id: '1', re: ['#<:N:1>'], ty: [':N'], to: 'c' } },
      { input: { id: '2', op: 'who', to: ':N:1', from: 'c' } },
      { output: { id: '2', re: [15], ty: ['Integer'], to: 'c', from: ':N:1' } },
    );
  });
});

// `class::base::x <- v` writes the parent's class-block cell, read back through
// the class, which inherits it.
describe('class::base — a write', () => {
  const script = `
    @G = *{} ^ {
      count *Integer = 3
    }
    @T = @G ^ *{
      @resetBase! = { class::base::count <- 0 }
      @counts = {
        b Integer = class::base::count
        o Integer = class::count
        return base: b, own: o
      }
    } ^ { }
  `;

  it("writes the parent block's cell", async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[], '$new'], to: ':T', from: 'c' } },
      { output: { id: '1', re: ['#<:T:1>'], ty: [':T'], to: 'c' } },
      { input: { id: '2', op: 'counts', to: ':T:1', from: 'c' } },
      { output: { id: '2', re: [{ base: 3, own: 3 }], ty: [{ base: 'Integer', own: 'Integer' }], to: 'c', from: ':T:1' } },
      { input: { id: '3', op: 'resetBase!', to: ':T:1', from: 'c' } },
      { output: { id: '3', re: ['#<:T:1>'], ty: [':T'], to: 'c', from: ':T:1' } },
      { input: { id: '4', op: 'counts', to: ':T:1', from: 'c' } },
      { output: { id: '4', re: [{ base: 0, own: 0 }], ty: [{ base: 'Integer', own: 'Integer' }], to: 'c', from: ':T:1' } },
    );
  });
});

describe('class::base — compile errors', () => {
  const compile = (source) => () => compileSource(`${source}@go = () -> 1\n`);

  it("a write to a cell the class's own block redeclares", () => {
    expect(compile('G = *{} ^ { count *Integer = 3 }\nT = G ^ *{\n  @r! = { class::base::count <- 0 }\n} ^ { count *Integer = 5 }\n'))
      .toThrow();
  });

  it('in a class with no parent', () => {
    expect(compile('V = *{\n  @a = { x Integer = class::base::h(); return x }\n}\n'))
      .toThrow("'class::base' in 'V': it's the running class's parent, and 'V' has no parent");
  });

  it('with two parents: write the parent\'s name', () => {
    expect(compile('A = *{} ^ { h = () -> 1 }\nB = *{}\nC = A ^ B ^ *{\n  @a = { x Integer = class::base::h(); return x }\n}\n'))
      .toThrow("'class::base' in 'C': 'C' has parents 'A' and 'B' — write the parent's name");
  });

  it('outside a class', () => {
    expect(compile('@a = { x Integer = class::base::h(); return x }\n'))
      .toThrow("'class::base' in this file: it names the parent of the class of an actor built by a class, and this one isn't");
  });

  it('class.base is still a public member', () => {
    expect(compile('T = *{} ^ { @base = () -> 7 }\nU = T ^ *{\n  @a = { x Integer = class.base(); return x }\n}\n')).not.toThrow();
  });
});
