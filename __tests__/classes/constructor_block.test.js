import { expectBehavior, compileSource, compileActor } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// A constructor block calls its own functions as statements: `@reg!(1)` and
// `#mark!()` run while constructing. After `@` or `#`, a declaration needs `=` or a
// newline after its name, so a name followed by `(` is a call. A bare name is a call
// when this body declares it, above or below, since it can't be declared twice.
// ═══════════════════════════════════════════════════════════════════════════════

describe('a self-call in a constructor block — validation', () => {
  it('parses in a file body and in a class body', () => {
    expect(() => compileSource('a *Integer = 0\n@reg! = (i Integer) { a <- i }\n@reg!(1)\n@go = { return a }\n')).not.toThrow();
    expect(() => compileSource('C = *{\n  a *Integer = 0\n  @reg! = (i Integer) { a <- i }\n  @reg!(1)\n}\n@go = { return 1 }\n')).not.toThrow();
  });

  it('a bare name declared above is a call, and the declarations after it stay', () => {
    const { interface: doc } = compileSource('b *Integer = 0\nmark! = { b <- 5 }\nmark!()\n@go = { return b }\n');
    expect(doc.service).toMatch(/go \(\)/);
  });

  it('so is a bare name declared below', () => {
    const { interface: doc } = compileSource('b *Integer = 0\nmark!()\nmark! = { b <- 5 }\n@go = { return b }\n');
    expect(doc.service).toMatch(/go \(\)/);
  });
});

describe('a self-call in a constructor block', () => {
  const script = `
    a *Integer = 0
    b *Integer = 0
    d *Integer = 0
    f *Integer = 0
    early!()
    @reg! = (i Integer) { a <- i }
    #mark! = { b <- 5 }
    bump! = { d <- 7 }
    @seed = { return 9 }
    @reg!(3)
    #mark!()
    bump!()
    e Integer = @seed()
    early! = { f <- 8 }

    C = *{
      n *Integer = 0
      @add! = (i Integer) { n <- n + i }
      @add!(2)
      @add!(4)
      @get = { return n }
    }

    @file = { return (a, b, d, e, f) }

    @child = {
      c = C()
      v Integer = c.get()
      return v
    }
  `;

  it('runs in the file\'s constructor', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@file', from: 'c' } },
      { output: { id: '1', re: [3, 5, 7, 9, 8], 'ty': ['Integer', 'Integer', 'Integer', 'Integer', 'Integer'], to: 'c' } },
    );
  });

  it('runs in a class\'s constructor, in order', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@child', from: 'c' } },
      { output: { id: '1', re: [6], 'ty': ['Integer'], to: 'c' } },
    );
  });
});

describe('a write in a constructor block — validation', () => {
  it('needs a cell', () => {
    expect(() => compileSource('x <- 1\n@go = { return 1 }\n')).toThrow(/Cannot set 'x'/);
  });
});

describe('a write in a constructor block', () => {
  const script = `
    count *Integer = 1
    @p *Integer = 0
    count <- count + 1
    @p <- 4
    chained *Integer = 0
    chained <- 1 <- 2

    C = *{
      n *Integer = 1
      n <- n + 10
      @get = { return n }
    }

    @file = { return (count, @p, chained) }

    @child = {
      c = C()
      v Integer = c.get()
      return v
    }
  `;

  it('runs in the file\'s constructor', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@file', from: 'c' } },
      { output: { id: '1', re: [2, 4, 2], 'ty': ['Integer', 'Integer', 'Integer'], to: 'c' } },
    );
  });

  it('runs in a class\'s constructor', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@child', from: 'c' } },
      { output: { id: '1', re: [11], 'ty': ['Integer'], to: 'c' } },
    );
  });
});

describe('a class calling its file\'s dependency', () => {
  const script = `
    *
      "svc.bv": Svc {
        note. () => .
        ping! () => self
      }
    *
    W! = *{
      Svc.note.()...
      @get = { return 1 }
    }

    P = *{
      @get! = {
        Svc.ping!()
        return 2
      }
    }

    @made! = {
      w = W!()
      n Integer = w.get()
      return n
    }

    @called! = {
      p = P()
      n Integer = p.get!()
      return n
    }
  `;

  it('is made by its file actor', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@made!', from: 'c' } },
      { output: expect.objectContaining({ op: '@note.', to: 'Svc' }) },
      { output: { id: '1', re: [1], 'ty': ['Integer'], to: 'c' } },
    );
  });

  // The call goes out under an id that varies by target, so the reply takes the id
  // the call went out with.
  it('gets its reply back through its file actor, from a method', async () => {
    const actor = await (await compileActor(script)).spawn();
    await actor.sendAsync({ id: '1', op: '@called!', from: 'c' });
    const call = actor.posts.find(p => p.op === '@ping!');
    expect(call).toEqual(expect.objectContaining({ to: 'Svc' }));
    await actor.sendAsync({ id: call.id, re: '#<Svc>', from: 'Svc' });
    expect(actor.posts.filter(p => p.to === 'c')).toEqual([{ id: '1', re: [2], 'ty': ['Integer'], to: 'c' }]);
  });
});
