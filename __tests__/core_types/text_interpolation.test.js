import { expectBehavior, compileSource } from '../helpers.js';

describe('text interpolation — runtime', () => {
  const script = `
    // Text interpolation — Text values
      @literalInside
        =
        return result: "hello #{"world"}"

      @fromConst
        =
        name Text = "World"
        return result: "Hello, #{name}!"

      @fromRef
        =
        name *Text = "World"
        return result: "Hello, #{name}!" as Text

      @multipleRefs
        =
        a *Text = "foo"
        b *Text = "bar"
        return result: "#{a}-#{b}" as Text

      @surrounding
        =
        name Text = "X"
        return result: "pre #{name} post"

      @emptyValue
        =
        name Text = ""
        return result: "[#{name}]"

      @leading
        =
        name Text = "X"
        return result: "#{name} trails"

      @trailing
        =
        name Text = "X"
        return result: "leads #{name}"

      @onlyInterpolation
        =
        name Text = "solo"
        return result: "#{name}"

    // Text interpolation — GraphemeText values
      @gtSimple
        =
        g *GraphemeText = "hello"
        return result: "#{g}" as Text

      @gtSurrounding
        =
        g *GraphemeText = "world"
        return result: "hello #{g}!" as Text

      @gtEmoji
        =
        g *GraphemeText = "a\u{1F600}b"
        return result: "#{g}" as Text

    // Text interpolation — Integer values
      @intLit
        =
        return result: "count=#{42}"

      @intConst
        =
        n Integer = 7
        return result: "n=#{n}"

      @intZero
        =
        return result: "#{0}"

      @intLarge
        =
        n Integer = 123456789
        return result: "#{n}"

      @intParam = (n Integer) -> result: "#{n}"

    // Text interpolation — Decimal values
      @decConst
        =
        d Decimal = 1.5
        return result: "#{d}"

      @decWithText
        =
        d Decimal = 3.14
        return result: "pi=#{d}"

      @decHighPrecision
        =
        d Decimal = 0.123456
        return result: "#{d}"

      @decParam = (d Decimal) -> result: "#{d}"

    // Text interpolation — Float values (e-notation)
      @fltParam = (f Float) -> result: "#{f}"
      @fltWithText = (f Float) -> result: "v=#{f}"

    // Text interpolation — Boolean values
      @tLit = () -> result: "#{true}"
      @fLit = () -> result: "#{false}"
      @tConst
        =
        b Boolean = true
        return result: "flag=#{b}"
      @fConst
        =
        b Boolean = false
        return result: "flag=#{b}"
      @fromCompare
        =
        a Integer = 3
        b Integer = 4
        return result: "eq=#{a == b}"

    // Text interpolation — expressions
      @arith
        =
        a Integer = 3
        b Integer = 4
        return result: "#{a + b}"

      @concat
        =
        name Text = "world"
        return result: "#{name + "!"}"

      @mixedMulti
        =
        n Integer = 7
        return result: "item #{n} of #{n * 2}"

      @mixedTypes
        =
        name Text = "box"
        count Integer = 3
        ready Boolean = true
        return result: "#{name}: #{count} (ready=#{ready})"

    // Text — escape sequences in double-quoted strings
      @escHash
        =
        name Text = "world"
        return result: "\\#{name} vs #{name}"

      @escBackslash
        =
        return result: "back\\\\slash"

      @escQuote
        =
        return result: "say \\"hi\\""

      @escApostropheCourtesy
        =
        return result: "it\\'s fine"

      @escNewline
        =
        return result: "line1\\nline2"

      @escTab
        =
        return result: "a\\tb"

      @escCR
        =
        return result: "a\\rb"

      @escUnicode
        =
        return result: "smile \\u{1F600}!"

      @escHex
        =
        return result: "byte=\\x41"

      @escMixed
        =
        name Text = "X"
        return result: "\\#{ignored}-#{name}-\\"q\\""

    // Text — single-quoted strings are raw
      @rawHash
        =
        return result: 'hello #{name}'

      @rawBackslash
        =
        return result: 'a\\nb'

      @rawDoubleQuote
        =
        return result: 'say "hi"'

      @doubledQuote
        =
        return result: 'How''s that?'

      @emptySingle
        =
        return result: ''

      @tripleAtEdges
        =
        return result: '''wrapped'''

      @rawBraces
        =
        return result: '{not a closure}'
  `;

  // ═══════════════════════════════════════════════════════════════════════════════
  // Text interpolation — "#{ expr }" inside double-quoted strings.
  //
  // Interpolation is pure string interpolation: snapshot the value of `expr`,
  // stringify it, and splice it into the surrounding string. Interpolation has
  // no reactivity semantics of its own — reactivity only arises when the whole
  // string literal is wrapped in a closure `{ ... }`.
  //
  // Only double-quoted strings support interpolation and backslash escapes.
  // Single-quoted strings are RAW: no interpolation, no backslash escapes;
  // a literal single quote is written by doubling it ('').
  //
  // Stringification rules:
  //   Integer  → decimal ("42", "-3", "0")
  //   Decimal  → decimal with preserved form ("1.5", "-2.5", "3.14")
  //   Float    → JSON-compatible e-notation: mantissa (with required decimal
  //              point, no truncation) + "e" + signed exponent ("1.5e+0",
  //              "1.0e-10", "2.5e+10"). Use Decimal for non-exponent output.
  //   Boolean      → "true" | "false"
  //   Text         → itself
  //   GraphemeText → its text content (itself)
  // ═══════════════════════════════════════════════════════════════════════════════
  
  // ─── Text values ─────────────────────────────────────────────────────────────

  it('Text interpolation — Text values — text literal inside interpolation', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'literalInside', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Text' }], re: [{ result: 'hello world' }], to: 'c' } });
  });

  it('Text interpolation — Text values — Text constant', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'fromConst', from: 'c' } }, { output: { id: '2', 'ty': [{ result: 'Text' }], re: [{ result: 'Hello, World!' }], to: 'c' } });
  });

  it('Text interpolation — Text values — Text ref', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'fromRef', from: 'c' } }, { output: { id: '3', 'ty': [{ result: 'Text' }], re: [{ result: 'Hello, World!' }], to: 'c' } });
  });

  it('Text interpolation — Text values — multiple interpolations in one string', async () => {
    await expectBehavior(script, { input: { id: '4', op: 'multipleRefs', from: 'c' } }, { output: { id: '4', 'ty': [{ result: 'Text' }], re: [{ result: 'foo-bar' }], to: 'c' } });
  });

  it('Text interpolation — Text values — surrounding text preserved', async () => {
    await expectBehavior(script, { input: { id: '5', op: 'surrounding', from: 'c' } }, { output: { id: '5', 'ty': [{ result: 'Text' }], re: [{ result: 'pre X post' }], to: 'c' } });
  });

  it('Text interpolation — Text values — empty value interpolates to empty', async () => {
    await expectBehavior(script, { input: { id: '6', op: 'emptyValue', from: 'c' } }, { output: { id: '6', 'ty': [{ result: 'Text' }], re: [{ result: '[]' }], to: 'c' } });
  });

  it('Text interpolation — Text values — interpolation at start', async () => {
    await expectBehavior(script, { input: { id: '7', op: 'leading', from: 'c' } }, { output: { id: '7', 'ty': [{ result: 'Text' }], re: [{ result: 'X trails' }], to: 'c' } });
  });

  it('Text interpolation — Text values — interpolation at end', async () => {
    await expectBehavior(script, { input: { id: '8', op: 'trailing', from: 'c' } }, { output: { id: '8', 'ty': [{ result: 'Text' }], re: [{ result: 'leads X' }], to: 'c' } });
  });

  it('Text interpolation — Text values — interpolation with no surrounding text', async () => {
    await expectBehavior(script, { input: { id: '9', op: 'onlyInterpolation', from: 'c' } }, { output: { id: '9', 'ty': [{ result: 'Text' }], re: [{ result: 'solo' }], to: 'c' } });
  });

  // ─── GraphemeText values ─────────────────────────────────────────────────────

  it('Text interpolation — GraphemeText values — GraphemeText ref interpolates to its text', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'gtSimple', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Text' }], re: [{ result: 'hello' }], to: 'c' } });
  });

  it('Text interpolation — GraphemeText values — GraphemeText in surrounding text', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'gtSurrounding', from: 'c' } }, { output: { id: '2', 'ty': [{ result: 'Text' }], re: [{ result: 'hello world!' }], to: 'c' } });
  });

  it('Text interpolation — GraphemeText values — GraphemeText with emoji grapheme cluster preserved', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'gtEmoji', from: 'c' } }, { output: { id: '3', 'ty': [{ result: 'Text' }], re: [{ result: 'a\u{1F600}b' }], to: 'c' } });
  });

  // ─── Integer values ──────────────────────────────────────────────────────────

  it('Text interpolation — Integer values — integer literal', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'intLit', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Text' }], re: [{ result: 'count=42' }], to: 'c' } });
  });

  it('Text interpolation — Integer values — integer constant', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'intConst', from: 'c' } }, { output: { id: '2', 'ty': [{ result: 'Text' }], re: [{ result: 'n=7' }], to: 'c' } });
  });

  it('Text interpolation — Integer values — negative integer (via param)', async () => {
    await expectBehavior(
      script,
      { input: { id: '3', op: [[-3], 'intParam'], 'ty': [['Integer']], from: 'c' } },
      { output: { id: '3', 'ty': [{ result: 'Text' }], re: [{ result: '-3' }], to: 'c' } },
    );
  });

  it('Text interpolation — Integer values — zero', async () => {
    await expectBehavior(script, { input: { id: '4', op: 'intZero', from: 'c' } }, { output: { id: '4', 'ty': [{ result: 'Text' }], re: [{ result: '0' }], to: 'c' } });
  });

  it('Text interpolation — Integer values — large integer', async () => {
    await expectBehavior(script, { input: { id: '5', op: 'intLarge', from: 'c' } }, { output: { id: '5', 'ty': [{ result: 'Text' }], re: [{ result: '123456789' }], to: 'c' } });
  });

  // ─── Decimal values ──────────────────────────────────────────────────────────

  it('Text interpolation — Decimal values — decimal constant', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'decConst', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Text' }], re: [{ result: '1.5' }], to: 'c' } });
  });

  it('Text interpolation — Decimal values — decimal with surrounding text', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'decWithText', from: 'c' } }, { output: { id: '2', 'ty': [{ result: 'Text' }], re: [{ result: 'pi=3.14' }], to: 'c' } });
  });

  it('Text interpolation — Decimal values — negative decimal (via param)', async () => {
    await expectBehavior(
      script,
      { input: { id: '3', op: [[-2.5], 'decParam'], 'ty': [['Decimal']], from: 'c' } },
      { output: { id: '3', 'ty': [{ result: 'Text' }], re: [{ result: '-2.5' }], to: 'c' } },
    );
  });

  it('Text interpolation — Decimal values — high-precision decimal preserved', async () => {
    await expectBehavior(script, { input: { id: '4', op: 'decHighPrecision', from: 'c' } }, { output: { id: '4', 'ty': [{ result: 'Text' }], re: [{ result: '0.123456' }], to: 'c' } });
  });

  // ─── Float values — e-notation with required decimal point + signed exponent ──

  function inpF(op, f) {
    return { input: { id: '1', op: [[f], op], 'ty': [['Float']], from: 'c' } };
  }
  function outTxt(result) {
    return { output: { id: '1', 'ty': [{ result: 'Text' }], re: [{ result }], to: 'c' } };
  }

  it('Text interpolation — Float values (e-notation) — 1.5 → "1.5e+0"', async () => {
    await expectBehavior(script, inpF('fltParam', 1.5e0), outTxt('1.5e+0'));
  });

  it('Text interpolation — Float values (e-notation) — 1.0e-10 → "1.0e-10"', async () => {
    await expectBehavior(script, inpF('fltParam', 1.0e-10), outTxt('1.0e-10'));
  });

  it('Text interpolation — Float values (e-notation) — 2.5e+10 → "2.5e+10"', async () => {
    await expectBehavior(script, inpF('fltParam', 2.5e10), outTxt('2.5e+10'));
  });

  it('Text interpolation — Float values (e-notation) — negative: -3.0e+2 → "-3.0e+2"', async () => {
    await expectBehavior(script, inpF('fltParam', -3.0e2), outTxt('-3.0e+2'));
  });

  it('Text interpolation — Float values (e-notation) — integer-valued float keeps required decimal: 1.0 → "1.0e+0"', async () => {
    await expectBehavior(script, inpF('fltParam', 1.0), outTxt('1.0e+0'));
  });

  it('Text interpolation — Float values (e-notation) — float with surrounding text', async () => {
    await expectBehavior(script, inpF('fltWithText', 1.5e0), outTxt('v=1.5e+0'));
  });

  // Full IEEE-754 double precision must survive stringification unchanged.
  // 0.1 + 0.2 in double is exactly 0.30000000000000004 — the classic case.
  // Its shortest round-trippable mantissa has 17 significant digits; every
  // one of them must appear in the output.
  it('Text interpolation — Float values (e-notation) — full precision preserved — no truncation on 0.1 + 0.2', async () => {
    await expectBehavior(script, inpF('fltParam', 0.1 + 0.2), outTxt('3.0000000000000004e-1'));
  });

  // ─── Boolean values ──────────────────────────────────────────────────────────

  it('Text interpolation — Boolean values — true literal', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'tLit', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Text' }], re: [{ result: 'true' }], to: 'c' } });
  });

  it('Text interpolation — Boolean values — false literal', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'fLit', from: 'c' } }, { output: { id: '2', 'ty': [{ result: 'Text' }], re: [{ result: 'false' }], to: 'c' } });
  });

  it('Text interpolation — Boolean values — true constant', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'tConst', from: 'c' } }, { output: { id: '3', 'ty': [{ result: 'Text' }], re: [{ result: 'flag=true' }], to: 'c' } });
  });

  it('Text interpolation — Boolean values — false constant', async () => {
    await expectBehavior(script, { input: { id: '4', op: 'fConst', from: 'c' } }, { output: { id: '4', 'ty': [{ result: 'Text' }], re: [{ result: 'flag=false' }], to: 'c' } });
  });

  it('Text interpolation — Boolean values — boolean expression (equality)', async () => {
    await expectBehavior(script, { input: { id: '5', op: 'fromCompare', from: 'c' } }, { output: { id: '5', 'ty': [{ result: 'Text' }], re: [{ result: 'eq=false' }], to: 'c' } });
  });

  // ─── Expressions inside interpolation ────────────────────────────────────────

  it('Text interpolation — expressions — arithmetic inside interpolation', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'arith', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Text' }], re: [{ result: '7' }], to: 'c' } });
  });

  it('Text interpolation — expressions — concatenation inside interpolation', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'concat', from: 'c' } }, { output: { id: '2', 'ty': [{ result: 'Text' }], re: [{ result: 'world!' }], to: 'c' } });
  });

  it('Text interpolation — expressions — multiple expressions mixed with literal text', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'mixedMulti', from: 'c' } }, { output: { id: '3', 'ty': [{ result: 'Text' }], re: [{ result: 'item 7 of 14' }], to: 'c' } });
  });

  it('Text interpolation — expressions — mixed types in one string', async () => {
    await expectBehavior(script, { input: { id: '4', op: 'mixedTypes', from: 'c' } }, { output: { id: '4', 'ty': [{ result: 'Text' }], re: [{ result: 'box: 3 (ready=true)' }], to: 'c' } });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // Escape sequences in double-quoted strings
  //
  // Supported:
  //   \#{   → literal "#{"  (suppresses interpolation)
  //   \\    → literal "\"
  //   \"    → literal "
  //   \'    → literal "'"   (courtesy; unnecessary but accepted)
  //   \n \t \r  → newline / tab / carriage return
  //   \u{…} → Unicode scalar by hex code point
  //   \xXX  → single byte by two-digit hex
  //
  // A bare backslash (not followed by a recognised escape char or `{` after `#`)
  // is a compile error.
  // ═══════════════════════════════════════════════════════════════════════════════

  it('Text — escape sequences in double-quoted strings — \\#{...} produces literal "#{...}" and suppresses interpolation there', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'escHash', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Text' }], re: [{ result: '#{name} vs world' }], to: 'c' } });
  });

  it('Text — escape sequences in double-quoted strings — \\\\ produces a single literal backslash', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'escBackslash', from: 'c' } }, { output: { id: '2', 'ty': [{ result: 'Text' }], re: [{ result: 'back\\slash' }], to: 'c' } });
  });

  it('Text — escape sequences in double-quoted strings — \\" produces literal double quote', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'escQuote', from: 'c' } }, { output: { id: '3', 'ty': [{ result: 'Text' }], re: [{ result: 'say "hi"' }], to: 'c' } });
  });

  it("\\' is accepted as courtesy and yields literal single quote", async () => {
    await expectBehavior(script, { input: { id: '4', op: 'escApostropheCourtesy', from: 'c' } }, { output: { id: '4', 'ty': [{ result: 'Text' }], re: [{ result: "it's fine" }], to: 'c' } });
  });

  it('Text — escape sequences in double-quoted strings — \\n produces newline', async () => {
    await expectBehavior(script, { input: { id: '5', op: 'escNewline', from: 'c' } }, { output: { id: '5', 'ty': [{ result: 'Text' }], re: [{ result: 'line1\nline2' }], to: 'c' } });
  });

  it('Text — escape sequences in double-quoted strings — \\t produces tab', async () => {
    await expectBehavior(script, { input: { id: '6', op: 'escTab', from: 'c' } }, { output: { id: '6', 'ty': [{ result: 'Text' }], re: [{ result: 'a\tb' }], to: 'c' } });
  });

  it('Text — escape sequences in double-quoted strings — \\r produces carriage return', async () => {
    await expectBehavior(script, { input: { id: '7', op: 'escCR', from: 'c' } }, { output: { id: '7', 'ty': [{ result: 'Text' }], re: [{ result: 'a\rb' }], to: 'c' } });
  });

  it('Text — escape sequences in double-quoted strings — \\u{XXXX} produces Unicode scalar', async () => {
    await expectBehavior(script, { input: { id: '8', op: 'escUnicode', from: 'c' } }, { output: { id: '8', 'ty': [{ result: 'Text' }], re: [{ result: 'smile \u{1F600}!' }], to: 'c' } });
  });

  it('Text — escape sequences in double-quoted strings — \\xXX produces single byte from two-digit hex', async () => {
    await expectBehavior(script, { input: { id: '9', op: 'escHex', from: 'c' } }, { output: { id: '9', 'ty': [{ result: 'Text' }], re: [{ result: 'byte=A' }], to: 'c' } });
  });

  it('Text — escape sequences in double-quoted strings — escaped and unescaped interpolation coexist', async () => {
    await expectBehavior(script, { input: { id: '10', op: 'escMixed', from: 'c' } }, { output: { id: '10', 'ty': [{ result: 'Text' }], re: [{ result: '#{ignored}-X-"q"' }], to: 'c' } });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // Single-quoted strings — RAW
  //
  // No interpolation. No backslash escapes (backslash is a literal character).
  // Double quote is a literal character (needs no escape).
  // A literal single quote is written by DOUBLING: 'How''s that?' → How's that?
  // ═══════════════════════════════════════════════════════════════════════════════

  it('Text — single-quoted strings are raw — #{ ... } is literal, not interpolated', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'rawHash', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Text' }], re: [{ result: 'hello #{name}' }], to: 'c' } });
  });

  it('Text — single-quoted strings are raw — backslash is a literal character (no escapes)', async () => {
    // Source is: 'a\nb' — four chars: a, backslash, n, b
    await expectBehavior(script, { input: { id: '2', op: 'rawBackslash', from: 'c' } }, { output: { id: '2', 'ty': [{ result: 'Text' }], re: [{ result: 'a\\nb' }], to: 'c' } });
  });

  it('Text — single-quoted strings are raw — double quote is a literal character', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'rawDoubleQuote', from: 'c' } }, { output: { id: '3', 'ty': [{ result: 'Text' }], re: [{ result: 'say "hi"' }], to: 'c' } });
  });

  it("doubled '' produces a single literal '", async () => {
    await expectBehavior(script, { input: { id: '4', op: 'doubledQuote', from: 'c' } }, { output: { id: '4', 'ty': [{ result: 'Text' }], re: [{ result: "How's that?" }], to: 'c' } });
  });

  it('Text — single-quoted strings are raw — empty single-quoted string', async () => {
    await expectBehavior(script, { input: { id: '5', op: 'emptySingle', from: 'c' } }, { output: { id: '5', 'ty': [{ result: 'Text' }], re: [{ result: '' }], to: 'c' } });
  });

  it("'''wrapped''' produces \"'wrapped'\"", async () => {
    await expectBehavior(script, { input: { id: '6', op: 'tripleAtEdges', from: 'c' } }, { output: { id: '6', 'ty': [{ result: 'Text' }], re: [{ result: "'wrapped'" }], to: 'c' } });
  });

  it('Text — single-quoted strings are raw — {...} is literal inside single quotes (not a closure context)', async () => {
    await expectBehavior(script, { input: { id: '7', op: 'rawBraces', from: 'c' } }, { output: { id: '7', 'ty': [{ result: 'Text' }], re: [{ result: '{not a closure}' }], to: 'c' } });
  });
});

// ─── Double-quoted string compile errors ─────────────────────────────────────

describe('Text — double-quoted string compile errors', () => {
  it('\\# not followed by { is a compile error', () => {
    expect(() => compileSource(`@bad = { return result: "a\\#b" }\n`))
      .toThrow();
  });

  it('bare backslash followed by unrecognised char is a compile error', () => {
    expect(() => compileSource(`@bad = { return result: "a\\qb" }\n`))
      .toThrow();
  });

  it('bare \\ with nothing useful following it is a compile error', () => {
    // "\ " — backslash then space — not a valid escape
    expect(() => compileSource(`@bad = { return result: "a\\ b" }\n`))
      .toThrow();
  });
});