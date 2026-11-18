import { compileSource, expectBehavior } from '../helpers.js';
import { extract } from '../../index.js';

// ═══════════════════════════════════════════════════════════════════════════════
// `use` in inner scopes, lexically bound
//
// A `use` may be written in any scope: a nested actor, a class body, a function
// body, a branch, a loop. Its entry is the file's, hoisted into the manifest and
// granted at load whether or not that code runs; one source is one entry and
// one address. Its binding is the scope's: the name is visible there (above the
// line too, as a top-level `use` is) and in scopes inside it, shadows an outer
// binding of the name, and is unknown anywhere else.
// See notes/use-di-2026-11-17.md and notes/use-as-binding-2026-11-18.md.
// ═══════════════════════════════════════════════════════════════════════════════

const N = '{ n () -> (Integer) }';

const script = `
  @early = {
    x Integer = Svc.n()
    use Svc = "svc.bv" as ${N}
    return x
  }

  @branch = (c Boolean) {
    if c {
      use B = "b.bv" as ${N}
      x Integer = B.n()
      return x
    }
    return 0
  }

  @loop = {
    x *Integer = 0
    repeat while x < 2 {
      use L = "l.bv" as ${N}
      y Integer = L.n()
      x <- x + y
    }
    return x
  }

  @shadowLocal = {
    svc Integer = 5
    if true {
      use svc = "svc.bv" as ${N}
      x Integer = svc.n()
      return x
    }
    return svc
  }

  @shadowUse = {
    use P = "p.bv" as ${N}
    a Integer = P.n()
    if true {
      use P = "q.bv" as ${N}
      b Integer = P.n()
      return a + b
    }
    return a
  }

  C = (k Integer) *{
    use M = "m.bv" as ${N}
    @get = {
      x Integer = M.n()
      return x + k
    }
  }

  @viaClass = {
    c = C(10)
    x Integer = c.get()
    return x
  }

  inner = actor {
    use Nn = "n.bv" as ${N}
    @get = {
      x Integer = Nn.n()
      return x
    }
  }

  @viaInner = {
    x Integer = inner.get()
    return x
  }
`;

describe('use in inner scopes — calls reach the dependency', () => {
  it('in a function body, from above the line that declares it', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'early', from: 'c' } },
      { output: { id: '1', op: 'n', to: 'svc.bv' } },
      { input: { id: '1', re: [7], ty: ['Integer'], from: 'svc.bv' } },
      { output: { id: '1', re: [7], ty: ['Integer'], to: 'c' } },
    );
  });

  it('in a branch', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], 'branch'], ty: [['Boolean']], from: 'c' } },
      { output: { id: '1', op: 'n', to: 'b.bv' } },
      { input: { id: '1', re: [3], ty: ['Integer'], from: 'b.bv' } },
      { output: { id: '1', re: [3], ty: ['Integer'], to: 'c' } },
    );
  });

  it('in a loop body, each time round', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'loop', from: 'c' } },
      { output: { id: '1', op: 'n', to: 'l.bv' } },
      { input: { id: '1', re: [1], ty: ['Integer'], from: 'l.bv' } },
      { output: { id: '2', op: 'n', to: 'l.bv' } },
      { input: { id: '2', re: [1], ty: ['Integer'], from: 'l.bv' } },
      { output: { id: '1', re: [2], ty: ['Integer'], to: 'c' } },
    );
  });

  it('shadowing an outer local, it is still the dependency', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'shadowLocal', from: 'c' } },
      { output: { id: '1', op: 'n', to: 'svc.bv' } },
      { input: { id: '1', re: [9], ty: ['Integer'], from: 'svc.bv' } },
      { output: { id: '1', re: [9], ty: ['Integer'], to: 'c' } },
    );
  });

  it('shadowing an outer `use` of another source, each scope reaches its own', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'shadowUse', from: 'c' } },
      { output: { id: '1', op: 'n', to: 'p.bv' } },
      { input: { id: '1', re: [1], ty: ['Integer'], from: 'p.bv' } },
      { output: { id: '2', op: 'n', to: 'q.bv' } },
      { input: { id: '2', re: [2], ty: ['Integer'], from: 'q.bv' } },
      { output: { id: '1', re: [3], ty: ['Integer'], to: 'c' } },
    );
  });

  it('in a class body, from its methods', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'viaClass', from: 'c' } },
      // The class's call is relayed by the file actor, under an id of its own.
      { output: expect.objectContaining({ op: 'n', to: 'm.bv' }) },
    );
  });

  it('in a nested actor, from its handlers', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'viaInner', from: 'c' } },
      // Relayed by the file actor, as a class's call is.
      { output: expect.objectContaining({ op: 'n', to: 'n.bv' }) },
    );
  });
});

const deps = (src) => extract(src).ast.dependencies;

describe('use in inner scopes — the manifest', () => {
  it('a `use` in a branch that never runs is still an entry', () => {
    expect(deps('@a = (c Boolean) {\n  if false {\n    use Never = "never.bv" as #\n  }\n  return 1\n}\n').map(d => d.path)).toEqual(['never.bv']);
  });

  it('the same source at top level and inside is one entry', () => {
    const src = `use Shared = "shared.bv" as ${N}\n@a = {\n  use S2 = "shared.bv"\n  x Integer = S2.n()\n  return x\n}\n`;
    expect(deps(src).map(d => [d.name, d.path])).toEqual([['Shared', 'shared.bv']]);
  });

  it('…and one address', async () => {
    await expectBehavior(`use Shared = "shared.bv" as ${N}\n@a = {\n  use S2 = "shared.bv"\n  x Integer = S2.n()\n  y Integer = Shared.n()\n  return x + y\n}\n`,
      { input: { id: '1', op: 'a', from: 'c' } },
      { output: { id: '1', op: 'n', to: 'shared.bv' } },
      { input: { id: '1', re: [1], ty: ['Integer'], from: 'shared.bv' } },
      { output: { id: '2', op: 'n', to: 'shared.bv' } },
    );
  });

  it('an inner typed value shares the top-level entry for its key', () => {
    const src = 'use limit Integer = limit\n@a = {\n  use n Integer = limit\n  return n + 1\n}\n';
    expect(deps(src)).toEqual([expect.objectContaining({ type: 'FileParam', name: 'limit', paramType: 'Integer' })]);
  });

  it('an inner typed value of a different type is an error', () => {
    expect(() => extract('use limit Integer = limit\n@a = {\n  use n Text = limit\n  return n\n}\n'))
      .toThrow("'use n Text = limit': 'limit' is a value of type 'Integer' elsewhere in this file — one value has one type");
  });
});

describe('use in inner scopes — visibility', () => {
  const unknown = (name, shown) => `'${name}' is unknown here — '${shown}' binds it only in the scope where it's written`;

  it('a nested actor\'s `use` is unknown outside it', () => {
    expect(() => compileSource(`
      inner = actor {
        use Nn = "n.bv" as ${N}
        @get = -> 1
      }
      @outside = {
        x Integer = Nn.n()
        return x
      }
    `)).toThrow(unknown('Nn', `use Nn = "n.bv" as ${N}`));
  });

  it('a nested scope sees an outer scope\'s `use`', () => {
    expect(() => compileSource(`
      @a = (c Boolean) {
        use Svc = "svc.bv" as ${N}
        if c {
          x Integer = Svc.n()
          return x
        }
        return 0
      }
    `)).not.toThrow();
  });

  it('a `use` in one branch is unknown in the other', () => {
    expect(() => compileSource(`
      @a = (c Boolean) {
        if c {
          use B = "b.bv" as ${N}
          x Integer = B.n()
          return x
        } else {
          y Integer = B.n()
          return y
        }
      }
    `)).toThrow(unknown('B', `use B = "b.bv" as ${N}`));
  });

  it('…and after the conditional', () => {
    expect(() => compileSource(`
      @a = (c Boolean) {
        if c {
          use B = "b.bv" as ${N}
          x Integer = B.n()
        }
        y Integer = B.n()
        return y
      }
    `)).toThrow(unknown('B', `use B = "b.bv" as ${N}`));
  });
});

describe('use in inner scopes — errors', () => {
  const again = (name, shown) => `'${name}' is bound by '${shown}' in this scope, so it can't be bound or assigned again here`;

  it('a local of the same name in the same scope', () => {
    expect(() => compileSource(`
      @a = {
        use svc = "svc.bv" as ${N}
        svc Integer = 1
        return svc
      }
    `)).toThrow(again('svc', `use svc = "svc.bv" as ${N}`));
  });

  it('a param of the same name', () => {
    expect(() => compileSource(`
      @a = (svc Integer) {
        use svc = "svc.bv" as ${N}
        return 1
      }
    `)).toThrow(again('svc', `use svc = "svc.bv" as ${N}`));
  });

  it('assigning to a `use` name', () => {
    expect(() => compileSource(`
      @a = {
        use svc = "svc.bv" as ${N}
        svc <- 5
        return 1
      }
    `)).toThrow(again('svc', `use svc = "svc.bv" as ${N}`));
  });

  it('in a factory file, still', () => {
    expect(() => extract('*\n  n Integer\n*\n@a = {\n  use document\n  return n\n}\n'))
      .toThrow("'use' in a factory file is not supported yet");
  });
});
