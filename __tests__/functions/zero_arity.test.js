import { expectBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Parens are optional on a call with no args: `get`, `@get`, `bump!`, `c.total`,
// `c.inc!.total`, `c.inc!...`. A silent call never writes its dot: `fire...`,
// `c.add(2)...`. The function itself is `&get`.
// Design: notes/zero-arity-calls-2026-11-06.md.
// ═══════════════════════════════════════════════════════════════════════════════

describe('zero-arity calls without parens', () => {
  const script = `
    C = *{
      n *Integer = 0
      @a *Integer = 4
      @inc! = { n <- n + 1 }
      @add. = (i Integer) { n <- n + i }
      @total = -> n
      @seven = -> 7
    }

    x *Integer = 0

    get = { return 10 }

    bump! = { x <- x + 1 }

    @pub = -> 3

    @local = {
      v Integer = get
      return v
    }

    @tail = -> get

    @ownPublic = {
      v Integer = @pub
      return v
    }

    @lambda = {
      f = { 7 }
      v Integer = f
      return v
    }

    @bang! = {
      bump!
      bump!
      return x
    }

    @member = {
      c = C()
      v Integer = c.seven
      return v
    }

    @onConstruction = {
      v Integer = C().seven
      return v
    }

    @cell = {
      c = C()
      v Integer = c.a
      return v
    }

    @memberBang = {
      c = C()
      c.inc!
      c.inc!()
      v Integer = c.total
      return v
    }

    @chain = {
      return C().inc!.inc!.total
    }

    @launch = {
      c = C()
      c.inc!...
      c.add(5)...
      v Integer = c.total
      return v
    }
  `;

  it('a local function', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@local', from: 'c' } },
      { output: { id: '1', re: [10], 'ty': ['Integer'], to: 'c' } },
    );
  });

  it('a local function as the tail', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@tail', from: 'c' } },
      { output: { id: '1', re: [10], to: 'c' } },
    );
  });

  it('an own public function', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@ownPublic', from: 'c' } },
      { output: { id: '1', re: [3], 'ty': ['Integer'], to: 'c' } },
    );
  });

  it('a local holding a function literal', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@lambda', from: 'c' } },
      { output: { id: '1', re: [7], 'ty': ['Integer'], to: 'c' } },
    );
  });

  it('a bang function as a statement', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@bang!', from: 'c' } },
      { output: { id: '1', re: [2], 'ty': ['Integer'], to: 'c' } },
    );
  });

  it('a member of a child', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@member', from: 'c' } },
      { output: { id: '1', re: [7], 'ty': ['Integer'], to: 'c' } },
    );
  });

  it('a member of a construction', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@onConstruction', from: 'c' } },
      { output: { id: '1', re: [7], 'ty': ['Integer'], to: 'c' } },
    );
  });

  it('a published cell, read the same way', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@cell', from: 'c' } },
      { output: { id: '1', re: [4], 'ty': ['Integer'], to: 'c' } },
    );
  });

  it('a bang member as a statement', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@memberBang', from: 'c' } },
      { output: { id: '1', re: [2], 'ty': ['Integer'], to: 'c' } },
    );
  });

  it('a chain', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@chain', from: 'c' } },
      { output: { id: '1', re: [2], to: 'c' } },
    );
  });

  it('launching a bang member and a silent member with args', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@launch', from: 'c' } },
      { output: { id: '1', re: [6], 'ty': ['Integer'], to: 'c' } },
    );
  });
});

describe('zero-arity calls on a dependency', () => {
  const script = `
    *
      "/svc": Svc {
        count () -> (Integer)
      }
    *

    @go = {
      v Integer = Svc.count
      return v
    }
  `;

  it('a function in its doc is called', async () => {
    await expectBehavior(script,
      { input: { id: '99', op: '@go', from: 'c' } },
      { output: expect.objectContaining({ op: '@count' }) },
      { input: { id: '1', re: [5], 'ty': ['Integer'], from: 'Svc' } },
      { output: { id: '99', re: [5], 'ty': ['Integer'], to: 'c' } },
    );
  });
});

describe('zero-arity calls — errors', () => {
  it('a bare name of a function with params', () => {
    expect(() => compileSource('dbl = (x Integer) -> x * 2\n@go = { v Integer = dbl; return v }\n'))
      .toThrow(/'dbl' takes arguments — call it 'dbl\(…\)', or use &dbl/);
  });

  it('`as Function` names `&`', () => {
    expect(() => compileSource('get = { return 10 }\n@go = { g = get as Function; return 1 }\n'))
      .toThrow(/'get as Function' — the function itself is '&get'/);
  });

  it('a silent member called with its dot', () => {
    expect(() => compileSource('C = *{\n  @add. = (i Integer) { x Integer = i }\n}\n@go = { c = C(); c.add.(2)...; return 1 }\n'))
      .toThrow(/never writes the silent dot — write 'add\(…\)\.\.\.'/);
  });
});
