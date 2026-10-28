import { compileSource } from '../helpers.js';
import { extract } from '../../index.js';

// ═══════════════════════════════════════════════════════════════════════════════
// File-class grammar — header forms
//
// A file-class header is the same as any class header without the `Name =`
// prefix:
//   ( deps ) *{ body }  |  ( deps ) -> *{ body }       — delimited header
//   *\n entries\n *\n body                            — lineal header
//   *\n body                                         — lineal, no entries
// In the lineal forms each `*` is alone on its line (the closing `*` may be
// followed by `{`); entries are one per line and use the same grammar as the
// delimited header. The lineal body is the rest of the file.
//
// The headerless file-class has no header, so it has no opener token; the
// body begins directly. A leading `=`, `{`, or `->` at file start is a parse
// error (those are openers for a header that doesn't exist).
// ═══════════════════════════════════════════════════════════════════════════════

describe('file-class header — delimited', () => {
  it("( deps ) *{ body } (delimited body)", () => {
    expect(() => compileSource(`
      ( value: Integer ) *{
        @get = -> value
      }
    `)).not.toThrow();
  });

  it("( deps ) -> *{ body } (optional arrow)", () => {
    expect(() => compileSource(`
      ( value: Integer ) -> *{
        @get = -> value
      }
    `)).not.toThrow();
  });

  it("( deps ) *{ return expr } (tail form)", () => {
    expect(() => compileSource(`
      ( value: Integer ) *{ return value }
    `)).not.toThrow();
  });

  it('multi-line entries', () => {
    expect(() => compileSource(`
      (
        "Remote": (Remote) { get: () -> (value: Integer) }
        name: Text
      ) *{
        @get = -> name
      }
    `)).not.toThrow();
  });
});

describe('file-class header — delimited, rejected forms', () => {
  it('*( deps ) { body } (retired) is a parse error', () => {
    expect(() => compileSource(`
      *( value: Integer ) {
        @get = -> value
      }
    `)).toThrow(/file headers are retired/);
  });

  it('*( deps ) -> expr (retired tail form) is a parse error', () => {
    expect(() => compileSource(`
      *( value: Integer )
      return value
    `)).toThrow(/file headers are retired/);
  });

  it('( deps ) *{body} followed by extra content after `}` is a parse error', () => {
    expect(() => compileSource(`
      ( value: Integer ) *{
        @get = -> value
      }
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

describe('file-class header — no-paren delimited forms', () => {
  it('* { body } (no params, delimited body)', () => {
    expect(() => compileSource(`
      * {
        @hello = -> greeting: "hi"
      }
    `)).not.toThrow();
  });

  it('* {} (no params, empty body)', () => {
    expect(() => compileSource(`
      * {}
    `)).not.toThrow();
  });

  it('* = body . (star not alone on its line) is a parse error', () => {
    expect(() => compileSource(`
      * =
        @hello = -> greeting: "hi"
        .
    `)).toThrow();
  });

  it('* -> expr (no params, tail form on same line) is a parse error', () => {
    expect(() => compileSource(`
      * -> "hi"
    `)).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Lineal file-class headers
// ═══════════════════════════════════════════════════════════════════════════════

describe('file-class header — lineal forms', () => {
  it('*\\n params\\n *\\n body (lineal header + lineal body)', () => {
    expect(() => compileSource(`
      *
        value Integer
      *
        @get = -> value
    `)).not.toThrow();
  });

  it('*\\n params\\n * { body } (lineal header + delimited body)', () => {
    expect(() => compileSource(`
      *
        value Integer
      * {
        @get = -> value
      }
    `)).not.toThrow();
  });

  it('*\\n params\\n *\\n { body } (delimited body on the next line)', () => {
    expect(() => compileSource(`
      *
        value Integer
      *
      {
        @get = -> value
      }
    `)).not.toThrow();
  });

  it('*\\n params\\n *\\n return expr (lineal header + tail form)', () => {
    expect(() => compileSource(`
      *
        value Integer
      *
      return value
    `)).not.toThrow();
  });

  it('multiple params, one per line', () => {
    expect(() => compileSource(`
      *
        name: Text
        count: Integer
      *
        @label = -> line: name
    `)).not.toThrow();
  });

  it('*\\n body (no entries)', () => {
    expect(() => compileSource(`
      *
      @hello = -> greeting: "hi"
    `)).not.toThrow();
  });

  it('*\\n { body } (no entries, delimited body)', () => {
    expect(() => compileSource(`
      *
      {
        @hello = -> greeting: "hi"
      }
    `)).not.toThrow();
  });

  it('dependency entries, one per line', () => {
    expect(() => compileSource(`
      *
        "/services/counter": (Counter) {
          get: () -> (count: Integer)
        }
        base: Integer
      *

      @go = { :count Integer = Counter.get(); return :count }
    `)).not.toThrow();
  });
});

describe('file-class header — lineal params land as file params', () => {
  // The lineal and delimited headers must produce the same AST: scalar params
  // are FileParam entries in `dependencies` (rendered in the params document),
  // not params on the file actor.
  it('lineal and delimited headers yield identical dependencies', () => {
    const lineal = extract(`
      *
        "Remote": (Remote)
        name: Text
        n Integer
      *

      @get = -> name
    `);
    const delimited = extract(`
      ( "Remote": (Remote), name: Text, n Integer ) *{
        @get = -> name
      }
    `);
    expect(lineal.ast.dependencies).toEqual(delimited.ast.dependencies);
    expect(lineal.interface.params).toBe(delimited.interface.params);
  });
});

describe('file-class header — lineal forms, rejected variants', () => {
  it('*\\n decl (no closing `*`) parses as a no-entries header + body', () => {
    // Without a closing `*`, the lines after the opening `*` are the body.
    const { ast } = extract(`
      *
        value Integer
    `);
    expect(ast.dependencies).toEqual([]);
  });

  it('*\\n params\\n = (retired `=` closer) is a parse error', () => {
    expect(() => compileSource(`
      *
        value Integer
      =
        @get = -> value
    `)).toThrow();
  });

  it('* alone (empty body) compiles', () => {
    expect(() => compileSource(`
      *
    `)).not.toThrow();
  });
});
