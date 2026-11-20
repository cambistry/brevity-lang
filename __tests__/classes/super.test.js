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

  it('never, in a constructor of its own', () => {
    expect(compile(`${T}U = T ^ (n Integer) *{\n  @x = -> 1\n}\n`))
      .toThrow("'U' has a constructor of its own and never calls 'super': it builds its base with 'super(…)' in the constructor block");
  });

  it('bare super with two parents', () => {
    expect(compile(`${AB}C = A ^ B ^ (n Integer) *{\n  super\n}\n`))
      .toThrow("'super' in 'C' is ambiguous: 'C' has parents 'A' and 'B' — write 'super[A](…)' and 'super[B](…)'");
    expect(compile(`${AB}C = A ^ B ^ (n Integer) *{\n  super()\n}\n`))
      .toThrow("'super(…)' in 'C' is ambiguous");
  });

  it('one of two parents never built', () => {
    expect(compile(`${AB}C = A ^ B ^ (n Integer) *{\n  super[A]()\n}\n`))
      .toThrow("'C' has a constructor of its own and never calls 'super[B](…)'");
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
