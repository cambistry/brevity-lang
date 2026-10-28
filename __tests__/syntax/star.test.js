import { compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Class `*` constructor syntax.
//
// Forms covered:
//   Delimited (the `*` marks the body; optional `->`; space allowed):
//     Cls = (params) *{ body }   |  Cls = (params) -> *{ body }
//     Cls = () *{ body }         |  Cls = -> *{ body }  |  Cls = *{ body }
//   Lineal (each `*` alone on its line; LFs are syntax):
//     Cls =                  Cls =
//     *                      *
//     params, one per line   body
//     *                      .
//     body
//     .
//   The closing `*` may be followed by `{ body }` (same line or next).
//   `Cls\n=` may replace `Cls =`; `Cls <<` opens a lineal overload.
//   Subclass forms:
//     Sub = (Base | params) *{ body }
//     Sub = (Base |) *{ expr }      — ingest / declaration return
//     Sub = (Base *name | params) *{ body }
//   Public `@`:
//     @Cls = (params) *{ body }
//   Service coercion:
//     Coerced = Thing as *(p: Type) -> { iface }
//   File-level header:
//     ( "/path": (Alias) ) *{ body }  |  *\n "/path": (Alias)\n *\n body
// ═══════════════════════════════════════════════════════════════════════════════

describe('class (params) *{...} — delimited with-params', () => {
  it('single param', () => {
    expect(() => compileSource(`
      Counter = (start Integer) *{
        count *Integer = start
        @get = -> value: count
      }
      @test = {
        c = Counter(0)
        :value Integer = c.get()
        return :value
      }
    `)).not.toThrow();
  });

  it('multiple params', () => {
    expect(() => compileSource(`
      Pair = (a Integer, b Integer) *{
        @sum = -> total: (a + b)
      }
      @test = {
        p = Pair(3, 4)
        :total Integer = p.sum()
        return :total
      }
    `)).not.toThrow();
  });

  it('optional arrow: (params) -> *{ body }', () => {
    expect(() => compileSource(`
      Counter = (start Integer) -> *{
        @get = -> value: start
      }
      @test = -> 1
    `)).not.toThrow();
  });

  it('space between `*` and `{`', () => {
    expect(() => compileSource(`
      Counter = (start Integer) * {
        @get = -> value: start
      }
      @test = -> 1
    `)).not.toThrow();
  });

  it('a parenthesized expression times a value is still multiplication', () => {
    expect(() => compileSource(`
      a = 2
      x = (a) * 3
      @test = -> 1
    `)).not.toThrow();
  });

  it('rejects retired *(params) { body }', () => {
    expect(() => compileSource(`
      Counter = *(start Integer) {
        @get = -> value: start
      }
      @test = -> 1
    `)).toThrow(/is retired/);
  });

  it('rejects `=` immediately before `*{`', () => {
    expect(() => compileSource(`
      Bad = (x Integer) = *{
        @get = -> v: x
      }
    `)).toThrow();
  });
});

describe('class * — no-params brace', () => {
  it('* { body }', () => {
    expect(() => compileSource(`
      Greeter = * {
        @hello = -> greeting: "hi"
      }
      @test = -> 1
    `)).not.toThrow();
  });

  it('*{ body } (no space)', () => {
    expect(() => compileSource(`
      Greeter = *{
        @hello = -> greeting: "hi"
      }
      @test = -> 1
    `)).not.toThrow();
  });
});

describe('class — lineal header, no params', () => {
  it('Cls =\\n*\\nbody .', () => {
    expect(() => compileSource(`
      Greeter =
        *
        @hello = -> greeting: "hi"
        .
      @test = -> 1
    `)).not.toThrow();
  });

  it('Cls\\n=\\n*\\nbody .', () => {
    expect(() => compileSource(`
      Greeter
      =
      *
        @hello = -> greeting: "hi"
        .
      @test = -> 1
    `)).not.toThrow();
  });

  it('Cls =\\n*\\n{ body } (delimited body)', () => {
    expect(() => compileSource(`
      Greeter =
        *
        {
          @hello = -> greeting: "hi"
        }
      @test = -> 1
    `)).not.toThrow();
  });

  it('no-params body opening with a param-shaped ref decl', () => {
    expect(() => compileSource(`
      Counter =
        *
        count *Integer = 0
        @get = -> value: count
        .
      @test = -> 1
    `)).not.toThrow();
  });

  it('no-params body containing a nested lineal class', () => {
    expect(() => compileSource(`
      Outer =
        *
        Inner =
          *
          @hi = -> greeting: "hi"
          .
        @get = -> ok: "ok"
        .
      @test = -> 1
    `)).not.toThrow();
  });

  it('rejects * = body . (star not alone on its line)', () => {
    expect(() => compileSource(`
      Greeter = * =
        @hello = -> greeting: "hi"
        .
      @test = -> 1
    `)).toThrow();
  });

  it('rejects Cls * = body . (no leading `=`)', () => {
    expect(() => compileSource(`
      Greeter * =
        @hello = -> greeting: "hi"
        .
      @test = -> 1
    `)).toThrow();
  });

  it('rejects compressed Cls=*=', () => {
    expect(() => compileSource(`
      Greeter=*=
        @hello = -> greeting: "hi"
        .
      @test = -> 1
    `)).toThrow();
  });

  it('rejects compressed Cls*=', () => {
    expect(() => compileSource(`
      Greeter*=
        @hello = -> greeting: "hi"
        .
      @test = -> 1
    `)).toThrow();
  });

  it('rejects Cls\\n*\\nbody (no leading `=`)', () => {
    expect(() => compileSource(`
      Greeter
      *
        @hello = -> greeting: "hi"
        .
      @test = -> 1
    `)).toThrow(/requires '=' before '\*'/);
  });
});

describe('class — lineal header with params', () => {
  it('Cls =\\n*\\nparams\\n*\\nbody .', () => {
    expect(() => compileSource(`
      Counter =
        *
        start Integer
        *
        count *Integer = start
        @get = -> value: count
        .
      @test = -> 1
    `)).not.toThrow();
  });

  it('multiple params, one per line', () => {
    expect(() => compileSource(`
      Pair =
        *
        a Integer
        b Integer
        *
        @sum = -> total: (a + b)
        .
      @test = -> 1
    `)).not.toThrow();
  });

  it('Cls\\n=\\n*\\nparams\\n*\\nbody (header `=` on its own line)', () => {
    expect(() => compileSource(`
      Counter
      =
      *
        start Integer
      *
        count *Integer = start
        @get = -> value: count
        .
      @test = -> 1
    `)).not.toThrow();
  });

  it('closing star followed by `{` on the same line', () => {
    expect(() => compileSource(`
      Counter =
        *
        start Integer
        * {
          @get = -> value: start
        }
      @test = -> 1
    `)).not.toThrow();
  });

  it('closing star, then `{` on the next line', () => {
    expect(() => compileSource(`
      Counter =
        *
        start Integer
        *
        {
          @get = -> value: start
        }
      @test = -> 1
    `)).not.toThrow();
  });

  it('whitespace around the stars is permitted', () => {
    expect(() => compileSource('Counter =\n   *   \n  start Integer\n\t*\t\n  @get = -> value: start\n  .\n@test = -> 1\n')).not.toThrow();
  });

  it('rejects `Cls = *` with the star on the `=` line', () => {
    expect(() => compileSource(`
      Counter = *
        start Integer
        *
        @get = -> value: start
        .
      @test = -> 1
    `)).toThrow(/must be alone on its line/);
  });

  it('rejects a param sharing the opening star\'s line', () => {
    expect(() => compileSource(`
      Counter =
        * start Integer
        *
        @get = -> value: start
        .
      @test = -> 1
    `)).toThrow();
  });

  it('rejects the retired `=` closer after params', () => {
    expect(() => compileSource(`
      Counter =
        *
        start Integer
        =
        @get = -> value: start
        .
      @test = -> 1
    `)).toThrow(/closed by '\*' alone on its line/);
  });

  it('rejects lineal params without a leading `=`', () => {
    expect(() => compileSource(`
      Counter
      *
        start Integer
      *
        @get = -> value: start
        .
      @test = -> 1
    `)).toThrow(/requires '=' before '\*'/);
  });
});

describe('class — lineal overload', () => {
  it('Cls <<\\n*\\nparams\\n*\\nbody', () => {
    expect(() => compileSource(`
      Box = (value Integer) *{
        @get = -> result: value
      }
      Box <<
        *
        label Text
        *
        @get = -> result: 0
        .
      @test = -> 1
    `)).not.toThrow();
  });
});

describe('public class — lineal header', () => {
  it('@Cls =\\n*\\nparams\\n*\\nbody', () => {
    expect(() => compileSource(`
      @Counter =
        *
        start Integer
        *
        count *Integer = start
        @get = -> value: count
        .
      @test = -> 1
    `)).not.toThrow();
  });
});

describe('class () *{...} — empty params via parens', () => {
  it('() *{ body }', () => {
    expect(() => compileSource(`
      Greeter = () *{
        @hello = -> greeting: "hi"
      }
      @test = -> 1
    `)).not.toThrow();
  });

  it('-> *{ body } (arrow, no params)', () => {
    expect(() => compileSource(`
      Greeter = -> *{
        @hello = -> greeting: "hi"
      }
      @test = -> 1
    `)).not.toThrow();
  });
});

describe('class (...) *{...} — subclass forms', () => {

  it('Sub = (Base | params) *{ body }', () => {
    expect(() => compileSource(`
      Base = (value Integer) *{
        @get = -> result: value
      }
      Sub = (Base | label Text) *{
        @label = -> :label
      }
      @test = -> 1
    `)).not.toThrow();
  });

  it('Sub = (Base |) *{ expr }  (declaration return)', () => {
    expect(() => compileSource(`
      Base = * {
        label Text = ingest
        @label = -> :label
      }
      Greeting = (Base |) *{ "hello" }
      @test = -> 1
    `)).not.toThrow();
  });

  it('Sub = (Base *name | params) *{ body }  (wrap form)', () => {
    expect(() => compileSource(`
      Base = (x Integer) *{
        @x = -> v: x
      }
      Wrap = (Base *base | y Integer) *{
        @y = -> v: y
      }
      @test = -> 1
    `)).not.toThrow();
  });
});

describe('public class @Cls = (...) *{...}', () => {
  it('@Cls = (params) *{ body }', () => {
    expect(() => compileSource(`
      @Counter = (start Integer) *{
        count *Integer = start
        @get = -> value: count
      }
      @test = -> 1
    `)).not.toThrow();
  });

  it('@Cls = * { body }  (no params)', () => {
    expect(() => compileSource(`
      @Greeter = * {
        @hello = -> greeting: "hi"
      }
      @test = -> 1
    `)).not.toThrow();
  });
});

describe('service coercion — `as *(...)`', () => {
  it('Coerced = Alias as *(p: Type) -> { iface }', () => {
    expect(() => compileSource(`
      *
        "thing.bv": (Thing) #
      *

      Coerced = Thing as *(a: Integer) -> { get: () -> (value: Integer) }
      @test = -> 1
    `)).not.toThrow();
  });
});

describe('file-level header — lineal', () => {
  it('single named scalar param', () => {
    expect(() => compileSource(`
      *
        value: Integer
      *

      @get = -> :value
    `)).not.toThrow();
  });

  it('multiple named scalar params, one per line', () => {
    expect(() => compileSource(`
      *
        name: Text
        count: Integer
      *

      @label = -> line: name
    `)).not.toThrow();
  });

  it('inline manifest class: (Alias) *(p: Type) -> { iface }', () => {
    expect(() => compileSource(`
      *
        "thing.bv": (Thing) *(a: Integer) -> { get: () -> (value: Integer) }
        base: Integer
      *

      t = Thing(a: base)
      @go = { :value Integer = t.get(); return :value }
    `)).not.toThrow();
  });

  it('delimited: ( deps ) *{ body }', () => {
    expect(() => compileSource(`
      ( value: Integer ) *{
        @get = -> :value
      }
    `)).not.toThrow();
  });

  it('rejects retired *( deps ) header', () => {
    expect(() => compileSource(`
      *( value: Integer ) {
        @get = -> :value
      }
    `)).toThrow(/file headers are retired/);
  });
});

describe('hard error — old `<...>` syntax', () => {
  it('rejects Cls = <params> { body }', () => {
    expect(() => compileSource('Counter = <start Integer> {\n  @get = -> v: start\n}\n@test = -> 1\n')).toThrow();
  });

  it('rejects @Cls = <params> { body }', () => {
    expect(() => compileSource('@Counter = <start Integer> {\n  @get = -> v: start\n}\n@test = -> 1\n')).toThrow();
  });

  it('rejects file-level <...> header', () => {
    expect(() => compileSource('< :value Integer >\n=\n\n@get = -> :value\n')).toThrow();
  });

  it('rejects file-level <...> header with deps', () => {
    expect(() => compileSource('<\n  "thing.bv": (Thing) #\n>\n=\n\n@test = -> 1\n')).toThrow();
  });

  it('rejects old service coercion as *(p: Type)', () => {
    // Build with concatenation so the conversion script can't rewrite the
    // literal old-syntax fixture.
    const oldAsClause = 'as ' + '<' + ':a Integer' + '>';
    expect(() => compileSource(`*\n  "thing.bv": (Thing) #\n*\n\nCoerced = Thing ${oldAsClause} -> { get: () -> (value: Integer) }\n@test = -> 1\n`)).toThrow();
  });
});
