import { compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Constructor `*(params)` syntax — replaces the old `<params>` form.
//
// Forms covered:
//   Delimited:
//     Cls = *(params) { body }
//     Cls = *(params) = body .
//     Cls = *() { body }     — empty params via parens
//   No-params shorthand:
//     Cls = * { body }
//     Cls = * = body .       — body-opening `=` required
//     Cls * = body .         — leading `=` optional in no-params lineal
//     Cls=*=\nbody\n.        — fully compressed
//   Lineal with-params (params on a new line):
//     Cls = *
//       p1 Type
//       p2 Type
//     =
//       body
//   Subclass forms:
//     Sub = *(Base | params) { body }
//     Sub = *(Base |) -> expr
//     Sub = *(Base *name | params) { body }
//   Public `@`:
//     @Cls = *(params) { body }
//   Service coercion:
//     Coerced = Thing as *(p: Type) -> { iface }
//   File-level header:
//     *( "/path": (Alias) ... ) =\n body
// ═══════════════════════════════════════════════════════════════════════════════

describe('constructor *(...) — delimited with-params', () => {
  it('single param', () => {
    expect(() => compileSource(`
      Counter = *(start Integer) {
        count *Integer = start
        @get = -> value: count
      }
      @test = {
        c = Counter(0)
        :value Integer = c.get()
        -> :value
      }
    `)).not.toThrow();
  });

  it('multiple params', () => {
    expect(() => compileSource(`
      Pair = *(a Integer, b Integer) {
        @sum = -> total: (a + b)
      }
      @test = {
        p = Pair(3, 4)
        :total Integer = p.sum()
        -> :total
      }
    `)).not.toThrow();
  });

  it('lineal body with `=`', () => {
    expect(() => compileSource(`
      Counter = *(start Integer)
        =
        count *Integer = start
        @get = -> value: count
        .
      @test = -> 1
    `)).not.toThrow();
  });

  it('lineal body without `=` (direct content)', () => {
    expect(() => compileSource(`
      Counter = *(start Integer)
        count *Integer = start
        @get = -> value: count
        .
      @test = -> 1
    `)).not.toThrow();
  });

  it('rejects `=` immediately before `{`', () => {
    expect(() => compileSource(`
      Bad = *(x Integer) = {
        @get = -> v: x
      }
    `)).toThrow(/'=' is not valid before '\{'/);
  });
});

describe('constructor * — no-params brace', () => {
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

describe('constructor * = — no-params lineal body', () => {
  it('* = body .', () => {
    expect(() => compileSource(`
      Greeter = * =
        @hello = -> greeting: "hi"
        .
      @test = -> 1
    `)).not.toThrow();
  });

  it('drops leading `=`: Cls * = body .', () => {
    expect(() => compileSource(`
      Greeter * =
        @hello = -> greeting: "hi"
        .
      @test = -> 1
    `)).not.toThrow();
  });

  it('compressed: Cls=*= body .', () => {
    expect(() => compileSource(`
      Greeter=*=
        @hello = -> greeting: "hi"
        .
      @test = -> 1
    `)).not.toThrow();
  });

  it('compressed without leading `=`: Cls*=', () => {
    expect(() => compileSource(`
      Greeter*=
        @hello = -> greeting: "hi"
        .
      @test = -> 1
    `)).not.toThrow();
  });

  it('newlines around `*`: Cls\\n*\\n=', () => {
    expect(() => compileSource(`
      Greeter
      *
      =
        @hello = -> greeting: "hi"
        .
      @test = -> 1
    `)).not.toThrow();
  });

  it('newlines around `=*`: Cls\\n=\\n*\\n=', () => {
    expect(() => compileSource(`
      Greeter
      =
      *
      =
        @hello = -> greeting: "hi"
        .
      @test = -> 1
    `)).not.toThrow();
  });
});

describe('constructor *\\n params (lineal with-params)', () => {
  it('params on new lines, body opener =', () => {
    expect(() => compileSource(`
      Counter = *
        start Integer
      =
        count *Integer = start
        @get = -> value: count
        .
      @test = -> 1
    `)).not.toThrow();
  });

  it('multiple params with newlines', () => {
    expect(() => compileSource(`
      Pair = *
        a Integer
        b Integer
      =
        @sum = -> total: (a + b)
        .
      @test = -> 1
    `)).not.toThrow();
  });

  it('whitespace tolerant: Cls\\n=\\n*\\n  params\\n=\\nbody', () => {
    expect(() => compileSource(`
      Counter
      =
      *
        start Integer
      =
        count *Integer = start
        @get = -> value: count
        .
      @test = -> 1
    `)).not.toThrow();
  });

  it('with-params lineal requires leading `=`', () => {
    // Cls *\n params\n =\n body — without leading `=`, this is rejected
    expect(() => compileSource(`
      Counter *
        start Integer
      =
        count *Integer = start
        @get = -> value: count
        .
      @test = -> 1
    `)).toThrow();
  });
});

describe('constructor *(...) — empty params via parens', () => {
  it('*() { body }', () => {
    expect(() => compileSource(`
      Greeter = *() {
        @hello = -> greeting: "hi"
      }
      @test = -> 1
    `)).not.toThrow();
  });
});

describe('constructor *(...) — subclass forms', () => {
  it('Sub = *(Base | params) { body }', () => {
    expect(() => compileSource(`
      Base = *(value Integer) {
        @get = -> result: value
      }
      Sub = *(Base | label Text) {
        @label = -> :label
      }
      @test = -> 1
    `)).not.toThrow();
  });

  it('Sub = *(Base |) -> expr  (declaration return)', () => {
    expect(() => compileSource(`
      Base = * {
        label Text = ingest
        @label = -> :label
      }
      Greeting = *(Base |) -> "hello"
      @test = -> 1
    `)).not.toThrow();
  });

  it('Sub = *(Base *name | params) { body }  (wrap form)', () => {
    expect(() => compileSource(`
      Base = *(x Integer) {
        @x = -> v: x
      }
      Wrap = *(Base *base | y Integer) {
        @y = -> v: y
      }
      @test = -> 1
    `)).not.toThrow();
  });
});

describe('public constructor @Cls = *(...)', () => {
  it('@Cls = *(params) { body }', () => {
    expect(() => compileSource(`
      @Counter = *(start Integer) {
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
      *(
        "thing.bv": (Thing) #
      )
      =

      Coerced = Thing as *(a: Integer) -> { get: () -> (value: Integer) }
      @test = -> 1
    `)).not.toThrow();
  });
});

describe('file-level header — *( ... )', () => {
  it('single named scalar param', () => {
    expect(() => compileSource(`
      *( value: Integer )
      =

      @get = -> :value
    `)).not.toThrow();
  });

  it('multi-line named scalar params', () => {
    expect(() => compileSource(`
      *(
        name: Text
        count: Integer
      )
      =

      @label = -> line: name
    `)).not.toThrow();
  });

  it('inline manifest constructor: (Alias) *(p: Type) -> { iface }', () => {
    expect(() => compileSource(`
      *(
        "thing.bv": (Thing) *(a: Integer) -> { get: () -> (value: Integer) }
        base: Integer
      )
      =

      t = Thing(a: base)
      @go = { :value Integer = t.get(); -> :value }
    `)).not.toThrow();
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

  // eslint-disable-next-line jest/no-disabled-tests
  it('rejects old service coercion as *(p: Type)', () => {
    // Build with concatenation so the conversion script can't rewrite the
    // literal old-syntax fixture.
    const oldAsClause = 'as ' + '<' + ':a Integer' + '>';
    expect(() => compileSource(`*(\n  "thing.bv": (Thing) #\n)\n=\n\nCoerced = Thing ${oldAsClause} -> { get: () -> (value: Integer) }\n@test = -> 1\n`)).toThrow();
  });
});
