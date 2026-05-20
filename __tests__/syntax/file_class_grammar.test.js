import { compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// File-class grammar — body-opener rule
//
// A file-class with a header `*( deps )` is the same as any class declaration
// without the `Name =` prefix: the header MUST be followed by `{`, `=`, or `->`.
//
// The headerless file-class is the only exception — it has no header, so it has
// no opener token; the body begins directly. A leading `=`, `{`, or `->` at file
// start is a parse error (those are openers for a header that doesn't exist).
// ═══════════════════════════════════════════════════════════════════════════════

describe('file-class header — accepted body openers', () => {
  it("*(deps) = body (lineal body)", () => {
    expect(() => compileSource(`
      *( value: Integer )
      =

      @get = -> value
    `)).not.toThrow();
  });

  it("*(deps) { body } (delimited body)", () => {
    expect(() => compileSource(`
      *( value: Integer ) {
        @get = -> value
      }
    `)).not.toThrow();
  });

  it("*(deps) -> expr (tail form)", () => {
    expect(() => compileSource(`
      *( value: Integer )
      -> value
    `)).not.toThrow();
  });
});

describe('file-class header — rejected forms', () => {
  it('*(deps) followed by content with no body opener is a parse error', () => {
    expect(() => compileSource(`
      *( value: Integer )

      @get = -> value
    `)).toThrow();
  });

  it('*(deps) {body} followed by extra content after `}` is a parse error', () => {
    expect(() => compileSource(`
      *( value: Integer ) {
        @get = -> value
      }
      @stray = -> 1
    `)).toThrow();
  });

  it('*(deps) -> expr followed by extra content is a parse error', () => {
    expect(() => compileSource(`
      *( value: Integer )
      -> value
      @stray = -> 1
    `)).toThrow();
  });
});

describe('headerless file-class — rejected leading openers', () => {
  it('leading `=` at file start is a parse error', () => {
    expect(() => compileSource(`
      =
      @test = -> 1
    `)).toThrow(/no body opener/);
  });

  it('leading `{` at file start is a parse error', () => {
    expect(() => compileSource(`
      {
        @test = -> 1
      }
    `)).toThrow(/no body opener/);
  });

  it('leading `->` at file start is a parse error', () => {
    expect(() => compileSource(`
      -> "no header here"
    `)).toThrow(/no body opener/);
  });
});

describe('headerless file-class — accepted forms', () => {
  it('headerless file with handlers compiles', () => {
    expect(() => compileSource(`
      @test = -> 1
    `)).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// No-paren file-class headers — `*` directly followed by a body opener.
// Mirrors the no-param class declaration forms (`Name = * { body }` etc.) minus
// the `Name =` prefix.
// ═══════════════════════════════════════════════════════════════════════════════

describe('file-class header — no-paren forms', () => {
  it('* { body } (no params, delimited body)', () => {
    expect(() => compileSource(`
      * {
        @hello = -> greeting: "hi"
      }
    `)).not.toThrow();
  });

  it('* = body . (no params, lineal body)', () => {
    expect(() => compileSource(`
      * =
        @hello = -> greeting: "hi"
        .
    `)).not.toThrow();
  });

  it('* {} (no params, empty body)', () => {
    expect(() => compileSource(`
      * {}
    `)).not.toThrow();
  });

  it('* -> expr (no params, tail form on same line) is a parse error', () => {
    // Tail form requires explicit params — either delimited `*(params) -> expr`
    // or lineal `*\n params\n -> expr`. Bare `* -> expr` is neither lineal
    // (no newline after `*`) nor delimited (no parens), so it's rejected.
    expect(() => compileSource(`
      * -> "hi"
    `)).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Lineal file-class headers — `*` on its own line, params on subsequent lines,
// then a body opener (`=`, `{`, or `->`). Mirrors `Name = *\n params\n =\n body`
// minus the `Name =` prefix.
// ═══════════════════════════════════════════════════════════════════════════════

describe('file-class header — lineal forms', () => {
  it('*\\n params\\n =\\n body (lineal header + lineal body)', () => {
    expect(() => compileSource(`
      *
        value Integer
      =
        @get = -> value
        .
    `)).not.toThrow();
  });

  it('*\\n params\\n { body } (lineal header + delimited body)', () => {
    expect(() => compileSource(`
      *
        value Integer
      {
        @get = -> value
      }
    `)).not.toThrow();
  });

  it('*\\n params\\n -> expr (lineal header + tail form)', () => {
    expect(() => compileSource(`
      *
        value Integer
      -> value
    `)).not.toThrow();
  });

  it('multiple params lineal', () => {
    expect(() => compileSource(`
      *
        name: Text
        count: Integer
      =
        @label = -> line: name
        .
    `)).not.toThrow();
  });
});

describe('file-class header — lineal forms, rejected variants', () => {
  it('*\\n params (lineal params with no body opener, EOF) is a parse error', () => {
    expect(() => compileSource(`
      *
        value Integer
    `)).toThrow();
  });

  it('*\\n params (lineal params with no body opener, next decl) is a parse error', () => {
    expect(() => compileSource(`
      *
        value Integer
      @stray = -> 1
    `)).toThrow();
  });

  it('* alone with no body opener is a parse error', () => {
    expect(() => compileSource(`
      *
    `)).toThrow();
  });
});
