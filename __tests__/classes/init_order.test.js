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

  it("a read in the constructor block of a class it constructs", () => {
    expect(() => compileSource('W = *{\n  s Integer = total\n  @s = -> s\n}\nkid = W()\ntotal *Integer = 4\n@v = -> 1\n'))
      .toThrow(/'total' is read before its declaration \(by 'kid', through 'W'\)/);
  });

  it('a read two classes down', () => {
    expect(() => compileSource([
      'Outer = *{',
      '  Inner = *{',
      '    Deep = *{',
      '      d Integer = late',
      '      @d = -> d',
      '    }',
      '    dd = Deep()',
      '    @s = -> 1',
      '  }',
      '  i = Inner()',
      '  late *Integer = 7',
      '  @x = -> 1',
      '}',
      '@v = -> 1',
      '',
    ].join('\n'))).toThrow(/'late' is read before its declaration \(by 'i', through 'Inner' → 'Deep'\)/);
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
