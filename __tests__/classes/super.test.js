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
  @T = (n Integer = 7) *{
    seen Integer = n
    @seen = { return seen }
  }
  @Same = @T ^ (n Integer) *{ super(n) }
  @Doubled = @T ^ (label Text, n Integer) *{
    super(n * 2)
    @label = { return label }
    @own = { return n }
  }
  @Bare = @T ^ (n Integer) *{ super }
  @Defaulted = @T ^ (n Integer) *{ super() }

  @N = (a: Integer, b: Integer = 100) *{
    @sum = { return a + b }
  }
  @NamedBare = @N ^ (a: Integer, b: Integer) *{ super }
  @NamedSome = @N ^ (a: Integer) *{ super(a: a + 1) }

  @O = *{
    got Integer = probe()
    probe = -> 0
    @got = { return got }
  }
  @Ordered = @O ^ (k Integer) *{
    marker Integer = k
    super()
    after Integer = got + 1
    probe = -> marker
    @after = { return after }
  }

  @A = (x Integer) *{ @x = { return x } }
  @B = (y Integer) *{ @y = { return y } }
  @AB = @A ^ @B ^ (n Integer) *{
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

describe('super — in a constructor — compile errors', () => {
  const T = 'T = (n Integer = 7) *{\n  seen Integer = n\n  h = -> n\n  @seen = { return seen }\n}\n';
  const AB = 'A = *{}\nB = *{}\n';
  const compile = (source) => () => compileSource(`${source}@go = -> 1\n`);

  it("a base name read before the super line", () => {
    expect(compile(`${T}U = T ^ (n Integer) *{\n  x Integer = seen + 1\n  super(n)\n}\n`))
      .toThrow("'seen' in 'U' is the base's, read before 'super': the base is built at that line");
  });

  it("a base function called before the super line, or in its args", () => {
    expect(compile(`${T}U = T ^ (n Integer) *{\n  x Integer = h()\n  super(n)\n}\n`))
      .toThrow("'h' in 'U' is the base's, read before 'super'");
    expect(compile(`${T}U = T ^ (n Integer) *{\n  super(seen)\n}\n`))
      .toThrow("'seen' in 'U' is the base's, read before 'super'");
  });

  it('called on one branch of an if', () => {
    expect(compile(`${T}U = T ^ (n Integer) *{\n  x Integer = if n > 0 {\n    super(n)\n    1\n  } else {\n    2\n  }\n}\n`))
      .toThrow("'super(…)' in 'U' is called on one branch of an 'if': an 'if' whose branch calls 'super' needs an 'else' that calls it too");
    expect(compile(`${T}U = T ^ (n Integer) *{\n  x Integer | null = if n > 0 {\n    super(n)\n    1\n  }\n}\n`))
      .toThrow("needs an 'else' that calls it too");
  });

  it('in a loop', () => {
    expect(compile(`${T}U = T ^ (n Integer) *{\n  xs List of Integers = [1, 2]\n  ys List of Integers = over(xs) (x Integer) {\n    super(x)\n    x\n  }\n}\n`))
      .toThrow("'super(…)' in 'U' runs once: it can't be in a loop or a function");
  });

  it('twice', () => {
    expect(compile(`${T}U = T ^ (n Integer) *{\n  super(n)\n  super(n)\n}\n`))
      .toThrow("'super' in 'U' is called twice: the base is built once");
  });

  it("never, in a constructor of its own that doesn't define the parent's interface", () => {
    expect(compile(`${T}U = T ^ (n Integer) *{\n  @x = -> 1\n}\n`))
      .toThrow("'U' never calls 'super(…)', so it has no base for 'T', and must define the whole public interface of 'T'; missing: '@seen' (0 args)");
  });

  it('bare super with two parents', () => {
    expect(compile(`${AB}C = A ^ B ^ (n Integer) *{\n  super\n}\n`))
      .toThrow("'super' in 'C' is ambiguous: 'C' has parents 'A' and 'B' — write 'super[A](…)' and 'super[B](…)'");
    expect(compile(`${AB}C = A ^ B ^ (n Integer) *{\n  super()\n}\n`))
      .toThrow("'super(…)' in 'C' is ambiguous");
  });

  it('one of two parents never built, with no interface to define, is no base for it', () => {
    expect(compile(`${AB}C = A ^ B ^ (n Integer) *{\n  super[A]()\n}\n`)).not.toThrow();
  });

  it('super[X] for a class that is not a parent', () => {
    expect(compile(`${T}V = *{}\nU = T ^ (n Integer) *{\n  super[V](n)\n}\n`))
      .toThrow("'super[V](…)' in 'U': 'V' isn't a parent of 'U'");
  });

  it('in a class with no parent', () => {
    expect(compile('V = (n Integer) *{\n  super(n)\n}\n'))
      .toThrow("'super(…)' in 'V': 'super' builds the base, and 'V' has no parent");
  });

  it("args that don't fit the parent's params", () => {
    expect(compile(`${T}U = T ^ (n Integer) *{\n  super(n, n)\n}\n`))
      .toThrow("'super(…)' in 'U': 'T' takes 1 positional arg, got 2");
    expect(compile(`${T}U = T ^ (n Integer) *{\n  super(m: n)\n}\n`))
      .toThrow("'super(…)' in 'U': 'T' has no param 'm'");
    expect(compile('S = (a Integer) *{}\nU = S ^ (n Integer) *{\n  super()\n}\n'))
      .toThrow("'super(…)' in 'U': 'S' takes 'a', which isn't passed");
    expect(compile(`${T}U = T ^ (label Text, n Integer) *{\n  super\n}\n`))
      .toThrow("'super' in 'U' (its args as received): 'T' takes 1 positional arg, got 2");
  });

  it("an arg of the wrong type for the parent's param", () => {
    expect(compile(`${T}U = T ^ (n Text) *{\n  super(n)\n}\n`))
      .toThrow("Cannot bind 'n Integer' to 'n', which is Text");
  });

  it('super stays reserved', () => {
    expect(compile(`${T}U = T ^ (n Integer) *{\n  super = 1\n}\n`)).toThrow('Unexpected token in expression: EQUALS');
    expect(compile(`${T}U = T ^ (n Integer) *{\n  super(n)\n  @x = -> super.seen()\n}\n`)).toThrow('Unexpected token in expression: DOT');
    expect(compile(`${T}U = T ^ (n Integer) *{\n  super(n)\n  @x = -> super::h()\n}\n`)).toThrow('Unexpected token in expression: DCOLON');
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
  const AB = 'A = *{ @f = -> 1 }\nB = *{ @f = -> 2 }\n';
  const compile = (source) => () => compileSource(`${source}@go = -> 1\n`);

  it('in a function no parent defines', () => {
    expect(compile(`${T}U = T ^ *{\n  @z = -> super\n}\n`)).toThrow("'super' in '@z' of 'U': 'T' has no public 'z'");
    expect(compile(`${T}U = T ^ *{\n  k = -> super()\n}\n`)).toThrow("'super(…)' in 'k' of 'U': 'T' has no protected 'k'");
  });

  it('in a class with no parent, or the file', () => {
    expect(compile('V = *{\n  @f = -> super\n}\n')).toThrow("'super' in '@f' of 'V': 'super' calls '@f' one layer up, and 'V' has no parent");
    expect(compile('@f = -> super\n')).toThrow("'super' in '@f' of this file: 'super' calls '@f' one layer up, and it has none");
  });

  it('bare super, or super(…), with two parents', () => {
    expect(compile(`${AB}C = A ^ B ^ *{\n  @f = -> super\n}\n`)).toThrow("'super' in '@f' of 'C' is ambiguous: 'C' has parents 'A' and 'B' — write 'super[A](…)' or 'super[B](…)'");
    expect(compile(`${AB}C = A ^ B ^ *{\n  @f = -> super()\n}\n`)).toThrow("'super(…)' in '@f' of 'C' is ambiguous");
  });

  it('super[A](…) picks a direct parent, and only a direct one', () => {
    expect(compile(`${AB}C = A ^ B ^ *{\n  @f = { x Integer = super[A]() + super[B](); return x }\n}\n`)).not.toThrow();
    expect(compile('A = *{ @f = -> 1 }\nB = A ^ *{}\nC = B ^ *{\n  @f = -> super[A]()\n}\n')).toThrow("'super[A](…)' in 'C': 'A' isn't a direct parent of 'C'");
  });

  it('in a private function', () => {
    expect(compile(`${T}U = T ^ *{\n  #h = -> super\n}\n`)).toThrow("'super' in '#h' of 'U': a private function has no parent layer");
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
  @T = (n Integer) *{
    k Integer = 10 / n
    @total *Integer = 0
    @get = { return k }
    @add = (x Integer) -> x + k
  } ^ {
    prot *Integer = 2
  }
  @U = @T ^ (m Integer) *{
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
  const T = 'T = (n Integer) *{\n  count *Integer = n\n  @total *Integer = 0\n  h = -> n + 1\n  @get = { return count }\n  @add = (x Integer) -> x + 1\n}\n';
  const full = '  @total *Integer = 5\n  @get = { return 1 }\n  @add = (x Integer) -> x + 2\n';
  const compile = (source) => () => compileSource(`${source}@go = -> 1\n`);

  it('the whole public interface, defined, compiles', () => {
    expect(compile(`${T}U = T ^ (m Integer) *{\n${full}}\n`)).not.toThrow();
  });

  it('a public function missing, or with another arity', () => {
    expect(compile(`${T}U = T ^ (m Integer) *{\n  @total *Integer = 5\n  @get = { return 1 }\n}\n`))
      .toThrow("'U' never calls 'super(…)', so it has no base for 'T', and must define the whole public interface of 'T'; missing: '@add' (1 arg)");
    expect(compile(`${T}U = T ^ (m Integer) *{\n  @total *Integer = 5\n  @get = { return 1 }\n  @add = -> 2\n}\n`))
      .toThrow("missing: '@add' (1 arg)");
  });

  it('a public cell missing', () => {
    expect(compile(`${T}U = T ^ (m Integer) *{\n  @get = { return 1 }\n  @add = (x Integer) -> x + 2\n}\n`))
      .toThrow("missing: '@total' (a cell)");
  });

  it('per parent, when there are several', () => {
    expect(compile('A = *{ @a = -> 1 }\nB = *{ @b = -> 2 }\nC = A ^ B ^ (n Integer) *{\n  super[A]()\n}\n'))
      .toThrow("'C' never calls 'super[B](…)', so it has no base for 'B', and must define the whole public interface of 'B'; missing: '@b' (0 args)");
    expect(compile('A = *{ @a = -> 1 }\nB = *{ @b = -> 2 }\nC = A ^ B ^ (n Integer) *{\n  super[A]()\n  @b = -> 3\n}\n')).not.toThrow();
  });

  it("a protected name of the parent's that the subclass doesn't define", () => {
    expect(compile(`${T}U = T ^ (m Integer) *{\n${full}  @p = { x Integer = h(); return x }\n}\n`))
      .toThrow("'h' isn't in scope — it's 'T''s, and 'U' has no base for 'T' (it never calls 'super'): define it in 'U'");
    expect(compile(`${T}U = T ^ (m Integer) *{\n${full}  @p = { return count }\n}\n`))
      .toThrow("'count' isn't in scope — it's 'T''s");
    expect(compile(`${T}U = T ^ (m Integer) *{\n${full}  h = -> 9\n  @p = { x Integer = h(); return x }\n}\n`)).not.toThrow();
  });

  it('super, base:: and base. in its functions', () => {
    expect(compile(`${T}U = T ^ (m Integer) *{\n  @total *Integer = 5\n  @get = { return 1 }\n  @add = (x Integer) { y Integer = super(x); return y }\n}\n`))
      .toThrow("'super(…)' in '@add' of 'U': 'U' has no base for 'T' (it never calls 'super(…)')");
    expect(compile(`${T}U = T ^ (m Integer) *{\n${full}  @q = { x Integer = base::h(); return x }\n}\n`))
      .toThrow("'base::h' in 'U': 'U' has no base for 'T'");
    expect(compile(`${T}U = T ^ (m Integer) *{\n${full}  @q = { x Integer = base.get(); return x }\n}\n`))
      .toThrow("'base.get' in 'U': 'U' has no base for 'T'");
  });

  it('super on some paths but not all is still an error', () => {
    expect(compile(`${T}U = T ^ (m Integer) *{\n${full}  x Integer = if m > 0 {\n    super(m)\n    1\n  } else {\n    2\n  }\n}\n`))
      .toThrow("needs an 'else' that calls it too");
  });
});
