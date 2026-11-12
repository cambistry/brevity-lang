import { expectBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// A constructor block runs in text order. An actor can't read or write one of its own
// cells above the line that declares it, directly or through anything that runs there:
// a call to its own function, a class it constructs, a function handed to `over`.
// A function that only refers to a later cell, and isn't called yet, is fine.
// See notes/forward-reads-in-constructor-blocks-2026-11-11.md.
// ═══════════════════════════════════════════════════════════════════════════════

describe('a read before its declaration — validation', () => {
  it('a direct read', () => {
    expect(() => compileSource('b Integer = a\na *Integer = 1\n@v = -> b\n'))
      .toThrow(/'a' is read before its declaration \(by 'b'\) — declare 'a' above it/);
  });

  it('a cycle', () => {
    expect(() => compileSource('x Integer = y\ny *Integer = x\n@v = -> x\n'))
      .toThrow(/'y' is read before its declaration \(by 'x'\)/);
  });

  it('a read in a function the block calls', () => {
    expect(() => compileSource('a *Integer = 0\nmark! = { a <- r }\nmark!()\nr Integer = 5\n@v = -> a\n'))
      .toThrow(/'r' is read before its declaration \(by 'mark!\(…\)', through 'mark!'\)/);
  });

  it('a write in a function the block calls', () => {
    expect(() => compileSource('mark! = { late <- 1 }\nmark!()\nlate *Integer = 0\n@v = -> late\n'))
      .toThrow(/'late' is written before its declaration \(by 'mark!\(…\)', through 'mark!'\)/);
  });

  it('a read through a chain of calls', () => {
    expect(() => compileSource('g = -> late\nh = { return g() }\nx Integer = h()\nlate *Integer = 1\n@v = -> x\n'))
      .toThrow(/'late' is read before its declaration \(by 'x', through 'h' → 'g'\)/);
  });

  it('a read in a function handed to `over`', () => {
    expect(() => compileSource('nx = (i Integer) { return i + late }\nr List of Integers = over([1, 2], &nx)\nlate *Integer = 1\n@v = -> r\n'))
      .toThrow(/'late' is read before its declaration \(by 'r', through 'nx'\)/);
  });

  it('a read in a lambda handed to `over`', () => {
    expect(() => compileSource('r List of Integers = over([1, 2], (v Integer) -> v + late)\nlate *Integer = 1\n@v = -> r\n'))
      .toThrow(/'late' is read before its declaration \(by 'r'\)/);
  });

  it("a cell passed to a child's constructor", () => {
    expect(() => compileSource('Child = (t Integer) *{\n  @seen = -> t\n}\nkid = Child(total)\ntotal *Integer = 0\n@v = -> 1\n'))
      .toThrow(/'total' is read before its declaration \(by 'kid'\)/);
  });

  it('in a class body', () => {
    expect(() => compileSource('C = *{\n  b Integer = a\n  a *Integer = 1\n  @b = -> b\n}\n@v = -> 1\n'))
      .toThrow(/'a' is read before its declaration \(by 'b'\)/);
  });

  it('a function that refers to a later cell, not called during construction, is fine', () => {
    expect(() => compileSource('f = (n Integer) -> n + b\nb Integer = 2\n@v = { return f(1) }\n')).not.toThrow();
  });

  it("a class's functions that read a later cell are fine", () => {
    expect(() => compileSource('W = *{\n  @s = -> total\n}\nkid = W()\ntotal *Integer = 4\n@v = -> 1\n')).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// A class whose construction reads cells of the actor around it declared below the
// line that makes it isn't waited for. Its reads are messages to that actor, so they
// wait for those cells' lines; the block goes on, and its end waits for the class.
// What's sent to the child waits behind its construction, so using it above those
// lines is an error.
// ═══════════════════════════════════════════════════════════════════════════════

describe('a class constructed before a cell its construction reads — validation', () => {
  it('using the child above that cell', () => {
    expect(() => compileSource([
      'Outer = *{',
      '  Inner = *{',
      '    seen Integer = late',
      '    @seen = -> seen',
      '  }',
      '  i = Inner()',
      '  v Integer = i.seen()',
      '  late *Integer = 7',
      '  @x = -> v',
      '}',
      '@v = -> 1',
      '',
    ].join('\n'))).toThrow(/'i' is used before 'late' is declared, and its construction reads 'late' \(by 'v'\) — use 'i' below 'late'/);
  });

  it('using it through a function the block calls', () => {
    expect(() => compileSource('W = *{\n  s Integer = total\n  @s = -> s\n}\nkid = W()\nask = { return kid.s() }\nn Integer = ask()\ntotal *Integer = 4\n@v = -> n\n'))
      .toThrow(/'kid' is used before 'total' is declared, and its construction reads 'total' \(by 'n', through 'ask'\)/);
  });

  it('constructed through a function, it is waited for, so the read is an error', () => {
    expect(() => compileSource('W = *{\n  s Integer = total\n  @s = -> s\n}\nmk = { return W() }\nkid = mk()\ntotal *Integer = 4\n@v = -> 1\n'))
      .toThrow(/'total' is read before its declaration \(by 'kid', through 'mk' → 'W'\)/);
  });

  it("its arguments are read on the spot", () => {
    expect(() => compileSource('W = (n Integer) *{\n  s Integer = total + n\n  @s = -> s\n}\nkid = W(late)\ntotal *Integer = 4\nlate *Integer = 1\n@v = -> 1\n'))
      .toThrow(/'late' is read before its declaration \(by 'kid'\)/);
  });
});

describe('a class constructed before a cell its construction reads', () => {
  const script = `
    Outer = *{
      Inner = *{
        seen Integer = late + 1
        @seen = -> seen
      }
      i = Inner()
      late *Integer = 7
      after Integer = late * 10
      @x = -> i.seen()
      @after = -> after
    }
    W = *{
      s Integer = total * 2
      @s = -> s
    }
    kid = W()
    total *Integer = 4
    o = Outer()
    @kid = -> kid.s()
    @inner = -> o.x()
    @after = -> o.after()
  `;

  it("reads the cell's value from its line", async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@inner', from: 'c' } },
      { output: { id: '1', re: [8], to: 'c' } },
    );
  });

  it('the block goes on past it', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@after', from: 'c' } },
      { output: { id: '2', re: [70], to: 'c' } },
    );
  });

  it("a class of the file reading the file actor's cell", async () => {
    await expectBehavior(script,
      { input: { id: '3', op: '@kid', from: 'c' } },
      { output: { id: '3', re: [8], to: 'c' } },
    );
  });
});

describe('a class two levels down reading a later cell', () => {
  const script = `
    Outer = *{
      Inner = *{
        Deep = *{
          d Integer = late
          @d = -> d
        }
        dd = Deep()
        @d = -> dd.d()
      }
      i = Inner()
      late *Integer = 7
      @x = -> i.d()
    }
    o = Outer()
    @x = -> o.x()
  `;

  it('waits for the cell two actors up', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@x', from: 'c' } },
      { output: { id: '1', re: [7], to: 'c' } },
    );
  });
});

describe('a read below its declaration', () => {
  const script = `
    a *Integer = 1
    b Integer = a + 1
    f = (n Integer) -> n + late
    late *Integer = 10
    c Integer = f(b)
    @b = -> b
    @c = -> c
    @f = { return f(0) }
  `;

  it('reads the declared value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@b', from: 'c' } },
      { output: { id: '1', ty: ['Integer'], re: [2], to: 'c' } },
    );
  });

  it('a call below every cell it reads', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@c', from: 'c' } },
      { output: { id: '2', ty: ['Integer'], re: [12], to: 'c' } },
    );
  });

  it('a function declared above the cell it reads, called after construction', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: '@f', from: 'c' } },
      { output: { id: '3', re: [10], to: 'c' } },
    );
  });
});
