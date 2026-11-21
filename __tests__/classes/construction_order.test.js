import { compileSource, expectBehavior } from '../helpers.js';

// Construction order across layers. A parent's constructor body runs at the subclass's
// `super` line, and reaches the subclass through late-bound names: a path from it to a
// cell of the subclass's declared below that line is a compile error, followed through
// calls and overrides. Before this check, every target built the actor and read the cell
// unset (JS and Rust: null; Erlang: an unset value), failing at the first use.
// See notes/opre-extend-and-as-2026-11-20.md ("Instance layers": construction order).

const T = `
  @T = *{
    got Integer = probe()
    probe = -> 0
    @got = { return got }
  }
`;

describe('construction order across layers — compile errors', () => {
  const compile = (source) => () => compileSource(`${source}@go = -> 1\n`);

  it("a parent's body calls an override that reads a cell below super", () => {
    expect(compile(`${T}@U = @T ^ (k Integer) *{\n  super()\n  marker Integer = k\n  probe = -> marker\n}\n`))
      .toThrow("'marker' in 'U' is read before its declaration (by the body of 'T', run at 'super', through 'probe') — declare 'marker' above that line");
  });

  it('through a chain of calls', () => {
    const C = '@C = *{\n  got Integer = step()\n  step = -> probe()\n  probe = -> 0\n  @got = { return got }\n}\n';
    expect(compile(`${C}@D = @C ^ (k Integer) *{\n  super()\n  marker Integer = k\n  probe = -> marker\n}\n`))
      .toThrow("'marker' in 'D' is read before its declaration (by the body of 'C', run at 'super', through 'step' → 'probe')");
  });

  it('with two parents, each built at its own line', () => {
    expect(compile(`@A = *{ @a = -> 1 }\n${T}@AT = @A ^ @T ^ (k Integer) *{\n  super[@A]()\n  super[@T]()\n  marker Integer = k\n  probe = -> marker\n}\n`))
      .toThrow("'marker' in 'AT' is read before its declaration (by the body of 'T', run at 'super[T]', through 'probe')");
  });

  it("one parent's body reaches, through the child, a cell of a parent built below it", () => {
    const A = '@A = *{\n  got Integer = h()\n  h = -> 0\n  @got = { return got }\n}\n';
    const B = '@B = *{\n  b Integer = 7\n  h = -> b\n}\n';
    expect(compile(`${A}${B}@AB = @A ^ @B ^ *{\n  super[@A]()\n  super[@B]()\n}\n`))
      .toThrow("'b' in 'AB' is read before its declaration (by the body of 'A', run at 'super[A]', through 'h')");
  });

  it("an override reads a cell of the parent's own, declared below the line of its body that calls it", () => {
    const S = '@S = *{\n  got Integer = probe()\n  late Integer = 3\n  probe = -> 0\n  @got = { return got }\n}\n';
    expect(compile(`${S}@V = @S ^ *{\n  super()\n  probe = -> late\n}\n`))
      .toThrow("'late' in 'V' is read before its declaration (by the body of 'S', run at 'super', through 'probe')");
  });

  it('a composition with no constructor of its own runs its parent first', () => {
    expect(compile(`${T}@U = @T ^ *{\n  marker Integer = 5\n  probe = -> marker\n}\n`))
      .toThrow("'marker' in 'U' is read before its declaration (by the body of a parent of 'U', run first, through 'probe')");
  });

  it('a class block whose initializer calls an inherited function that reaches a later cell', () => {
    expect(compile('@P = *{} ^ {\n  f = -> late\n  late *Integer = 1\n}\n@Q = @P ^ *{} ^ {\n  x Integer = f()\n  late *Integer = 2\n  @x = -> x\n}\n'))
      .toThrow("'late' is read before its declaration (by 'x', through 'f')");
  });
});

// The same paths, with the cell above the line that reaches it.
const fine = `${T}
  @U = @T ^ (k Integer) *{
    marker Integer = k
    super()
    probe = -> marker
  }
  @A = *{
    got Integer = h()
    h = -> 0
    @got = { return got }
  }
  @B = *{
    b Integer = 7
    h = -> b
  }
  @BA = @A ^ @B ^ *{
    super[@B]()
    super[@A]()
  }
  @P = *{} ^ {
    f = -> late
    late *Integer = 1
  }
  @Q = @P ^ *{} ^ {
    late *Integer = 2
    x Integer = f()
    @x = -> x
  }
  @u = { u = @U(5); x Integer = u.got(); return x }
  @ba = { u = @BA(); x Integer = u.got(); return x }
  @q = { x Integer = @Q.x(); return x }
`;

describe('construction order across layers — the cell above the line', () => {
  it("the parent's body, at super, reads the override's cell", async () => {
    await expectBehavior(fine,
      { input: { id: '1', op: 'u', from: 'c' } },
      { output: { id: '1', re: [5], ty: ['Integer'], to: 'c' } },
    );
  });

  it("one parent's body reaches a cell of the parent built above it", async () => {
    await expectBehavior(fine,
      { input: { id: '1', op: 'ba', from: 'c' } },
      { output: { id: '1', re: [7], ty: ['Integer'], to: 'c' } },
    );
  });

  it("a class block's initializer calls an inherited function that reads a cell above it", async () => {
    await expectBehavior(fine,
      { input: { id: '1', op: 'q', from: 'c' } },
      { output: { id: '1', re: [2], ty: ['Integer'], to: 'c' } },
    );
  });
});
