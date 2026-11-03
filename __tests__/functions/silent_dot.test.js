import { expectBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// A silent function is named with a glued `.` (`fire.`, `@go.`) — silence is in
// the name, not a trailing `.` in the body. A silent call ends in `...`
// (fire-and-forget); right after the name the ellipsis absorbs the dot
// (`fire...`). Design: notes/silent-dot-suffix-2026-10-30.md.
// ═══════════════════════════════════════════════════════════════════════════════

describe('silent name — definition', () => {
  it('a trailing `.` in a named function body is an error naming the fix', () => {
    expect(() => compileSource('fire = { x Integer = 1 . }\n@go = -> 1\n'))
      .toThrow(/name it 'fire\.' and drop the '\.'/);
  });

  it('a trailing `.` in a silent-named body is redundant and an error', () => {
    expect(() => compileSource('fire. = { x Integer = 1 . }\n@go = -> 1\n'))
      .toThrow(/'fire\.' is silent by its name — drop the trailing '\.'/);
  });

  it('`return .` in a named function is an error', () => {
    expect(() => compileSource('@go = (n Integer) { return . }\n'))
      .toThrow(/name it '@go\.' and drop the '\.'/);
  });

  it('`return value` in a silent function is an error', () => {
    expect(() => compileSource('@go. = (n Integer) { return n }\n'))
      .toThrow(/'@go\.' is silent — 'return' takes no value/);
  });

  it('a lambda keeps its trailing `.`', () => {
    expect(() => compileSource('@go = (n Integer) { f = { x Integer = n . }; return n }\n'))
      .not.toThrow();
  });

  it('a lineal class still closes with a lone `.`', () => {
    expect(() => compileSource(`
      Box =
        *
          seed Integer
        *
        value *Integer = seed

        @get
          =
          -> value: value

        .
      end#Box

      @go = -> 1
    `)).not.toThrow();
  });
});

describe('silent name — invocation', () => {
  const script = `
    x *Integer = 0

    fire. = { x <- 1 }

    bump. = (n Integer) {
      if n > 100 {
        return
      }
      x <- n
    }

    get = { return 10 }

    @elided!
      =
      fire...
      repeat while (x == 0) __tick__()
      return x

    @withArgs!
      =
      bump.(7)...
      repeat while (x == 0) __tick__()
      return x

    @early!
      =
      bump.(500)...
      bump.(3)...
      repeat while (x == 0) __tick__()
      return x
  `;

  it('`fire...` runs the silent `fire.` without waiting', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@elided!', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [1], to: 'c' }) },
    );
  });

  it('`bump.(7)...` passes args', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@withArgs!', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [7], to: 'c' }) },
    );
  });

  it('a bare `return` exits a silent function early', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@early!', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [3], to: 'c' }) },
    );
  });

  it('a silent call without `...` is an error', () => {
    expect(() => compileSource('fire. = { x Integer = 1 }\n@go = { fire.(); return 1 }\n'))
      .toThrow(/'fire\.' is silent — call it 'fire\.\(…\)\.\.\.'/);
  });

  it('calling `fire()` when only the silent `fire.` exists names the silent call', () => {
    expect(() => compileSource('fire. = { x Integer = 1 }\n@go = { fire(); return 1 }\n'))
      .toThrow(/'fire' is not defined — the silent 'fire\.' is called 'fire\.\(…\)\.\.\.'/);
  });

  it('`...` on a value-returning function is an error', () => {
    expect(() => compileSource('get = { return 10 }\n@go = { get...; return 1 }\n'))
      .toThrow(/'get' returns a value; '\.\.\.' needs a silent 'get\.'/);
  });

  it('`fn` and `fn.` coexist; `fn...` is `fn.`', () => {
    expect(() => compileSource(`
      x *Integer = 0
      ping = { return 1 }
      ping. = { x <- 1 }
      @go! = { ping...; n Integer = ping(); return n }
    `)).not.toThrow();
  });

  it('a `...` call has no value', () => {
    expect(() => compileSource('fire. = { x Integer = 1 }\n@go = { n Integer = fire...; return 1 }\n'))
      .toThrow(/fire-and-forget call \('\.\.\.'\) has no value/);
  });

  it('four dots is an error naming the elided form', () => {
    expect(() => compileSource('fire. = { x Integer = 1 }\n@go = { fire....; return 1 }\n'))
      .toThrow(/write 'fire\.\.\.'/);
  });
});

describe('silent name — on the wire', () => {
  const script = `
    x *Integer = 0

    @put. = (n Integer) { x <- n }

    @get = -> x
  `;

  it('a silent public handler is addressed with its dot and sends no reply', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[5], '@put.'], 'ty': [['Integer']], from: 'c' } },
      { input: { id: '2', op: '@get', from: 'c' } },
      { output: expect.objectContaining({ id: '2', re: [5], to: 'c' }) },
    );
  });
});
