import { expectBehavior, compileSource, createActor, expectActorBehavior } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// A `!` function writes. Its return paths say what it yields: falling off the end
// returns self, `return v` returns v, and there is no tail return. A self-return
// is `{ re: {}, 'bv-a': '#<>' }`, with the parent promoting the address.
// Design: notes/mutation-suffix-2026-10-31.md.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Compilation and validation ───────────────────────────────────────────────

describe('! function — tail errors', () => {
  const body = (b) => `acc *Integer = 0\n@m! = (i Integer) { ${b} }\n`;

  it('a tail name is an error suggesting return', () => {
    expect(() => compileSource(body('acc <- i\n i'))).toThrow(/Did you mean 'return'/);
  });

  it('a tail operator expression is an error', () => {
    expect(() => compileSource(body('acc <- i\n i + 1'))).toThrow(/Did you mean 'return'/);
  });

  it('a tail literal is an error', () => {
    expect(() => compileSource(body('acc <- i\n 1'))).toThrow(/Did you mean 'return'/);
  });

  it('a bare tail `self` is an error naming the fix', () => {
    expect(() => compileSource(body('acc <- i\n self'))).toThrow(/write 'return self'/);
  });

  it('a value in an arrow body is a tail value', () => {
    expect(() => compileSource('@m! = -> 1\n')).toThrow(/Did you mean 'return'/);
  });

  it('a tail value in an else branch is an error', () => {
    expect(() => compileSource(body('if i == 0 { acc <- 1 } else { 0 }'))).toThrow(/Did you mean 'return'/);
  });

  it('a value on one path and a fall-through on another is an error', () => {
    expect(() => compileSource(body('if i == 0 { return i }\n acc <- i'))).toThrow(/write 'return self'/);
  });
});

describe('self as a value — validation', () => {
  it('is an error outside return position', () => {
    expect(() => compileSource('@go = { x = self\n return 1 }\n')).toThrow(/self/);
  });

  it('cannot be one of several return values', () => {
    expect(() => compileSource('@go = { return self, 7 }\n')).toThrow(/several return values/);
  });
});

describe('! names — validation', () => {
  it('a type name takes no bang in an annotation', () => {
    expect(() => compileSource('a Integer! = 0\n')).toThrow(/takes no '!'/);
  });

  it('a type name takes no bang in a construction', () => {
    expect(() => compileSource('a = Integer!(0)\n')).toThrow(/takes no '!'/);
  });
});

describe('<- as an expression — validation', () => {
  it('`return a <- x` parses, and is reported as not yet supported', () => {
    expect(() => compileSource('a *Integer = 0\n@go = { return a <- 1 }\n')).toThrow(/as a value isn't supported yet/);
  });

  it('parens regroup: `a <- (b <- c)` uses a write as a value', () => {
    expect(() => compileSource('a *Integer = 0\nb *Integer = 0\n@go = { a <- (b <- 1)\n return 1 }\n')).toThrow(/as a value isn't supported yet/);
  });

  it('a comma in a return list belongs to the list', () => {
    expect(() => compileSource('a *Integer = 0\n@go = { return a <- 1, 2 }\n')).toThrow(/as a value isn't supported yet/);
  });

  it('the left side must be a cell', () => {
    expect(() => compileSource('a *Integer = 0\n@go = { x Integer = 1 + a <- 2\n return x }\n')).toThrow(/left side of '<-' must be a cell/);
  });

  it('a non-cell target is an error', () => {
    expect(() => compileSource('@go = (a Integer) { return a <- 2 }\n')).toThrow(/only '\*Type' variables/);
  });
});

describe('chains — validation', () => {
  const POP = `
    ::Item (name: Text)
    C = *{
      n *Integer = 0
      @pop! = {
        n <- n + 1
        return Item(name: "x")
      }
    }
  `;

  it('a chain from a call on this actor is reported as not yet supported', () => {
    const body = (call) => `a *Integer = 0\nbump! = (i Integer) { a <- a + i }\n@add! = (i Integer) { a <- a + i }\n@go = {\n  ${call}\n  return a\n}\n`;
    expect(() => compileSource(body('bump!(1).add!(2)'))).toThrow(/can't start from 'bump!/);
    expect(() => compileSource(body('@add!(1).add!(2)'))).toThrow(/can't start from '@add!/);
  });

  it('a value-returning `!` call on a new actor can\'t be chained on', () => {
    expect(() => compileSource(`${POP}
      @go = {
        n Text = C().pop!().name
        return n
      }
    `)).toThrow(/returns a value here.*bind it first/);
  });

  it('a value-returning `!` call on a held actor can\'t be chained on', () => {
    expect(() => compileSource(`${POP}
      @go = {
        c = C()
        n Text = c.pop!().name
        return n
      }
    `)).toThrow(/returns a value here.*bind it first/);
  });
});

describe('-> self in signatures', () => {
  it('a function type may return self', () => {
    expect(() => compileSource('@a = (cb: (Integer) -> self) -> result: 1\n')).not.toThrow();
  });

  it('`(self)` is retired in a function type', () => {
    expect(() => compileSource('@a = (cb: (Integer) -> (self)) -> result: 1\n')).toThrow();
  });

  it('a generated doc shows a self-return without parens', () => {
    const { interface: doc } = compileSource('a *Integer = 0\n@inc! = (i Integer) { a <- a + i }\n');
    expect(JSON.stringify(doc)).toContain('-> self');
  });

  it('an inline interface may declare `-> self`', () => {
    const remotes = [{ path: 'Widget', service: '{ mod! (Integer) -> self }' }];
    expect(() => compileSource('*\n  "Widget": Widget\n*\n@go. = { Widget.mod!(1)... }\n', { remotes })).not.toThrow();
  });

  it('`-> (self)` is retired in an inline interface', () => {
    const remotes = [{ path: 'Widget', service: '{ mod! (Integer) -> (self) }' }];
    expect(() => compileSource('*\n  "Widget": Widget\n*\n@go. = { Widget.mod!(1)... }\n', { remotes })).toThrow(/takes no parens/);
  });
});

// ── Runtime ──────────────────────────────────────────────────────────────────

describe('! function — return paths', () => {
  const script = `
    acc *Integer = 0
    a *Integer = 0
    b *Integer = 5
    log *Integer = 0

    bump! = (i Integer) { acc <- acc + i }

    next! = (v Integer) {
      log <- log * 10 + v
      return v
    }

    @inc! = (i Integer) { acc <- acc + i }

    @explicit! = (i Integer) {
      acc <- acc + i
      return self
    }

    @take! = {
      v Integer = acc
      acc <- 0
      return v
    }

    @guarded! = (i Integer) {
      if i == 0 { return }
      acc <- acc + i
    }

    @every! = (c Boolean) {
      if c {
        acc <- 1
        return self
      }
      return self
    }

    @either! = (c Boolean) {
      acc <- 1
      if c { return acc }
      return self
    }

    @tailIf! = (c Boolean) {
      if c {
        acc <- 1
        bump!(2)
      }
    }

    @branches! = (c Integer) {
      if c == 1 {
        acc <- 10
      } else if c == 2 {
        acc <- 20
      } else {
        acc <- 30
      }
    }

    @arrow! = (i Integer) -> acc <- acc + i

    @lineal!
      =
      acc <- acc + 1

    @valueBranch! = (c Boolean) {
      if c {
        acc <- 1
        return acc
      }
      return 0
    }

    @total = { return acc }

    @viaPrivate! = {
      bump!(1)
      bump!(2)
      return acc
    }

    @me = { self }
    @meExplicit = { return self }

    @same = { return 1 }
    @same! = { acc <- 2 }

    @notEqual = (n Integer) {
      r Boolean = n!=1
      return r
    }

    @stays! = {
      a <- b <- 9
      return a, b
    }

    @ordered! = {
      a <- next!(1) <- next!(2)
      return log
    }

    @whole! = {
      a <- a + 1 * 3
      return a
    }
  `;

  it('falling off the end returns self', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[5], '@inc!'], 'bv-a': [['Integer']], from: 'c' } },
      { output: { id: '1', re: {}, 'bv-a': '#<>', to: 'c' } },
    );
  });

  it('the write takes effect', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[5], '@inc!'], 'bv-a': [['Integer']], from: 'c' } },
      { output: { id: '1', re: {}, 'bv-a': '#<>', to: 'c' } },
      { input: { id: '2', op: [[2], '@inc!'], 'bv-a': [['Integer']], from: 'c' } },
      { output: { id: '2', re: {}, 'bv-a': '#<>', to: 'c' } },
      { input: { id: '3', op: '@total', from: 'c' } },
      { output: { id: '3', re: [7], 'bv-a': ['Integer'], to: 'c' } },
    );
  });

  it('`return self` returns self, even when it is the only path', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[5], '@explicit!'], 'bv-a': [['Integer']], from: 'c' } },
      { output: { id: '1', re: {}, 'bv-a': '#<>', to: 'c' } },
    );
  });

  it('`return v` returns v', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[3], '@inc!'], 'bv-a': [['Integer']], from: 'c' } },
      { output: { id: '1', re: {}, 'bv-a': '#<>', to: 'c' } },
      { input: { id: '2', op: '@take!', from: 'c' } },
      { output: { id: '2', re: [3], 'bv-a': ['Integer'], to: 'c' } },
    );
  });

  it('a bare `return` exits as falling off the end does', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[0], '@guarded!'], 'bv-a': [['Integer']], from: 'c' } },
      { output: { id: '1', re: {}, 'bv-a': '#<>', to: 'c' } },
      { input: { id: '2', op: '@total', from: 'c' } },
      { output: { id: '2', re: [0], 'bv-a': ['Integer'], to: 'c' } },
    );
  });

  it('every path may return self explicitly, and a write in a returning branch takes effect', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@every!'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: { id: '1', re: {}, 'bv-a': '#<>', to: 'c' } },
      { input: { id: '2', op: '@total', from: 'c' } },
      { output: { id: '2', re: [1], 'bv-a': ['Integer'], to: 'c' } },
    );
  });

  it('value on one path, explicit self on another', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@either!'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: { id: '1', re: [1], 'bv-a': ['Integer'], to: 'c' } },
      { input: { id: '2', op: [[false], '@either!'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: { id: '2', re: {}, 'bv-a': '#<>', to: 'c' } },
    );
  });

  it('a write and a call in a tail `if` take effect', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@tailIf!'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: { id: '1', re: {}, 'bv-a': '#<>', to: 'c' } },
      { input: { id: '2', op: '@total', from: 'c' } },
      { output: { id: '2', re: [3], 'bv-a': ['Integer'], to: 'c' } },
    );
  });

  it('a tail `if` not taken returns self', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[false], '@tailIf!'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: { id: '1', re: {}, 'bv-a': '#<>', to: 'c' } },
      { input: { id: '2', op: '@total', from: 'c' } },
      { output: { id: '2', re: [0], 'bv-a': ['Integer'], to: 'c' } },
    );
  });

  it.each([[1, 10], [2, 20], [3, 30]])('a tail `if`/`else if`/`else` takes one branch: %i', async (c, expected) => {
    await expectBehavior(script,
      { input: { id: '1', op: [[c], '@branches!'], 'bv-a': [['Integer']], from: 'c' } },
      { output: { id: '1', re: {}, 'bv-a': '#<>', to: 'c' } },
      { input: { id: '2', op: '@total', from: 'c' } },
      { output: { id: '2', re: [expected], 'bv-a': ['Integer'], to: 'c' } },
    );
  });

  it('a final write in arrow form is a statement', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[2], '@arrow!'], 'bv-a': [['Integer']], from: 'c' } },
      { output: { id: '1', re: {}, 'bv-a': '#<>', to: 'c' } },
      { input: { id: '2', op: '@total', from: 'c' } },
      { output: { id: '2', re: [2], 'bv-a': ['Integer'], to: 'c' } },
    );
  });

  it('a lineal `!` function returns self', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@lineal!', from: 'c' } },
      { output: { id: '1', re: {}, 'bv-a': '#<>', to: 'c' } },
    );
  });

  it('a write in a value-returning branch takes effect', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@valueBranch!'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: { id: '1', re: [1], 'bv-a': ['Integer'], to: 'c' } },
      { input: { id: '2', op: '@total', from: 'c' } },
      { output: { id: '2', re: [1], 'bv-a': ['Integer'], to: 'c' } },
    );
  });

  it('a private `!` function runs, called with its bang', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@viaPrivate!', from: 'c' } },
      { output: { id: '1', re: [3], 'bv-a': ['Integer'], to: 'c' } },
    );
  });

  it('a bare tail `self` in a read-only function is an ordinary tail return', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@me', from: 'c' } },
      { output: { id: '1', re: {}, 'bv-a': '#<>', to: 'c' } },
    );
  });

  it('`return self` in a read-only function', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@meExplicit', from: 'c' } },
      { output: { id: '1', re: {}, 'bv-a': '#<>', to: 'c' } },
    );
  });

  it('`foo` and `foo!` are distinct', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@same', from: 'c' } },
      { output: { id: '1', re: [1], 'bv-a': ['Integer'], to: 'c' } },
      { input: { id: '2', op: '@same!', from: 'c' } },
      { output: { id: '2', re: {}, 'bv-a': '#<>', to: 'c' } },
    );
  });

  it('`!=` is still not-equal', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[2], '@notEqual'], 'bv-a': [['Integer']], from: 'c' } },
      { output: { id: '1', re: [true], 'bv-a': ['Boolean'], to: 'c' } },
    );
  });

  it('a `<-` chain stays on its target: a ends up holding c, b is only read', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@stays!', from: 'c' } },
      { output: { id: '1', re: [9, 5], 'bv-a': ['Integer', 'Integer'], to: 'c' } },
    );
  });

  it('every link of a `<-` chain runs, in order', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@ordered!', from: 'c' } },
      { output: { id: '1', re: [12], 'bv-a': ['Integer'], to: 'c' } },
    );
  });

  it('the right side of `<-` takes a whole expression', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@whole!', from: 'c' } },
      { output: { id: '1', re: [3], 'bv-a': ['Integer'], to: 'c' } },
    );
  });
});

describe('chained calls', () => {
  const script = `
    ::Item (name: Text)

    C = *{
      acc *Integer = 0
      @inc! = (i Integer) { acc <- acc + i }
      @branch! = (c Boolean) {
        if c {
          acc <- 1
          return self
        }
        return self
      }
      @pop! = {
        acc <- acc + 1
        return Item(name: "x")
      }
      @total = { return acc }
    }

    W! = *{
      a *Integer = 0
      @add! = (i Integer) { a <- a + i }
      @get = { return a }
    }

    @onHeld = {
      c = C()
      v Integer = c.inc!(5).inc!(2).total()
      return v
    }

    @onFresh = {
      v Integer = C().inc!(5).inc!(2).total
      return v
    }

    @bindsReceiver = {
      c = C()
      d = c.inc!(5)
      d.inc!(2)
      v Integer = c.total()
      return v
    }

    @branchInChild = {
      v Integer = C().branch!(true).total()
      return v
    }

    @boundValue = {
      i Item = C().pop!()
      n Text = i.name
      return n
    }

    @bangClass = {
      v Integer = W!().add!(2).get()
      return v
    }
  `;

  it('chains on a child held in a local', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@onHeld', from: 'c' } },
      { output: { id: '1', re: [7], 'bv-a': ['Integer'], to: 'c' } },
    );
  });

  it('chains on a fresh construction', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@onFresh', from: 'c' } },
      { output: { id: '1', re: [7], 'bv-a': ['Integer'], to: 'c' } },
    );
  });

  it('a bang call binds the receiver', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@bindsReceiver', from: 'c' } },
      { output: { id: '1', re: [7], 'bv-a': ['Integer'], to: 'c' } },
    );
  });

  it('a write in a returning branch takes effect in a child', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@branchInChild', from: 'c' } },
      { output: { id: '1', re: [1], 'bv-a': ['Integer'], to: 'c' } },
    );
  });

  it('a value-returning `!` call yields its value once bound', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@boundValue', from: 'c' } },
      { output: { id: '1', re: ['x'], 'bv-a': ['Text'], to: 'c' } },
    );
  });

  it('a class named with `!` is constructed and chains on the new actor', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@bangClass', from: 'c' } },
      { output: { id: '1', re: [2], 'bv-a': ['Integer'], to: 'c' } },
    );
  });
});

describe('chained calls through a remote', () => {
  const source = `
    *
      "thing.bv": Thing (a: Integer) -> *{
        inc! (Integer) -> self
        total () -> (value: Integer)
      }
    *
    t = Thing(a: 5)
    @go! = {
      :value Integer = t.inc!(2).total()
      return :value
    }
  `;

  it('the next call goes to the address in `bv-a`', async () => {
    const actor = await createActor(source, {
      expects: [{ output: expect.objectContaining({ op: [{ a: 5 }, '#new'], to: 'Thing' }) }],
    });
    await expectActorBehavior(actor,
      { input: { id: '1', re: '#<Thing/1>', 'bv-a': '#<Thing>', from: 'Thing' } },
      { input: { id: '99', op: '@go!', from: 'caller' } },
      { output: expect.objectContaining({ op: [[2], '@inc!'], to: 'Thing/1' }) },
      { input: { id: '2', re: {}, 'bv-a': '#<Thing/9>' } },
      { output: expect.objectContaining({ op: '@total', to: '#<Thing/9>' }) },
      { input: { id: '3', re: { value: 7 } } },
      { output: expect.objectContaining({ id: '99', re: { value: 7 }, to: 'caller' }) },
    );
  });
});
