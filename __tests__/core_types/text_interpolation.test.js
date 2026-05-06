import { expectBehavior, compileSource } from '../helpers.js';

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

describe('Text interpolation — Text values', () => {
  const script = `
      @literalInside
        =
        -> result: "hello #{"world"}"

      @fromConst
        =
        name Text = "World"
        -> result: "Hello, #{name}!"

      @fromRef
        =
        name Text! = "World"
        -> result: "Hello, #{name}!" as Text

      @multipleRefs
        =
        a Text! = "foo"
        b Text! = "bar"
        -> result: "#{a}-#{b}" as Text

      @surrounding
        =
        name Text = "X"
        -> result: "pre #{name} post"

      @emptyValue
        =
        name Text = ""
        -> result: "[#{name}]"

      @leading
        =
        name Text = "X"
        -> result: "#{name} trails"

      @trailing
        =
        name Text = "X"
        -> result: "leads #{name}"

      @onlyInterpolation
        =
        name Text = "solo"
        -> result: "#{name}"
  `;

  it('text literal inside interpolation', async () => {
    await expectBehavior(script, { input: { id: '1', op: '@literalInside', from: 'c' } }, { output: { id: '1', 'bv-a': { result: 'Text' }, re: { result: 'hello world' }, to: 'c' } });
  });

  it('Text constant', async () => {
    await expectBehavior(script, { input: { id: '2', op: '@fromConst', from: 'c' } }, { output: { id: '2', 'bv-a': { result: 'Text' }, re: { result: 'Hello, World!' }, to: 'c' } });
  });

  it('Text ref', async () => {
    await expectBehavior(script, { input: { id: '3', op: '@fromRef', from: 'c' } }, { output: { id: '3', 'bv-a': { result: 'Text' }, re: { result: 'Hello, World!' }, to: 'c' } });
  });

  it('multiple interpolations in one string', async () => {
    await expectBehavior(script, { input: { id: '4', op: '@multipleRefs', from: 'c' } }, { output: { id: '4', 'bv-a': { result: 'Text' }, re: { result: 'foo-bar' }, to: 'c' } });
  });

  it('surrounding text preserved', async () => {
    await expectBehavior(script, { input: { id: '5', op: '@surrounding', from: 'c' } }, { output: { id: '5', 'bv-a': { result: 'Text' }, re: { result: 'pre X post' }, to: 'c' } });
  });

  it('empty value interpolates to empty', async () => {
    await expectBehavior(script, { input: { id: '6', op: '@emptyValue', from: 'c' } }, { output: { id: '6', 'bv-a': { result: 'Text' }, re: { result: '[]' }, to: 'c' } });
  });

  it('interpolation at start', async () => {
    await expectBehavior(script, { input: { id: '7', op: '@leading', from: 'c' } }, { output: { id: '7', 'bv-a': { result: 'Text' }, re: { result: 'X trails' }, to: 'c' } });
  });

  it('interpolation at end', async () => {
    await expectBehavior(script, { input: { id: '8', op: '@trailing', from: 'c' } }, { output: { id: '8', 'bv-a': { result: 'Text' }, re: { result: 'leads X' }, to: 'c' } });
  });

  it('interpolation with no surrounding text', async () => {
    await expectBehavior(script, { input: { id: '9', op: '@onlyInterpolation', from: 'c' } }, { output: { id: '9', 'bv-a': { result: 'Text' }, re: { result: 'solo' }, to: 'c' } });
  });
});

// ─── GraphemeText values ─────────────────────────────────────────────────────

describe('Text interpolation — GraphemeText values', () => {
  const script = `
      @gtSimple
        =
        g GraphemeText! = "hello"
        -> result: "#{g}" as Text

      @gtSurrounding
        =
        g GraphemeText! = "world"
        -> result: "hello #{g}!" as Text

      @gtEmoji
        =
        g GraphemeText! = "a\u{1F600}b"
        -> result: "#{g}" as Text
  `;

  it('GraphemeText ref interpolates to its text', async () => {
    await expectBehavior(script, { input: { id: '1', op: '@gtSimple', from: 'c' } }, { output: { id: '1', 'bv-a': { result: 'Text' }, re: { result: 'hello' }, to: 'c' } });
  });

  it('GraphemeText in surrounding text', async () => {
    await expectBehavior(script, { input: { id: '2', op: '@gtSurrounding', from: 'c' } }, { output: { id: '2', 'bv-a': { result: 'Text' }, re: { result: 'hello world!' }, to: 'c' } });
  });

  it('GraphemeText with emoji grapheme cluster preserved', async () => {
    await expectBehavior(script, { input: { id: '3', op: '@gtEmoji', from: 'c' } }, { output: { id: '3', 'bv-a': { result: 'Text' }, re: { result: 'a\u{1F600}b' }, to: 'c' } });
  });
});

// ─── Integer values ──────────────────────────────────────────────────────────

describe('Text interpolation — Integer values', () => {
  const script = `
      @intLit
        =
        -> result: "count=#{42}"

      @intConst
        =
        n Integer = 7
        -> result: "n=#{n}"

      @intZero
        =
        -> result: "#{0}"

      @intLarge
        =
        n Integer = 123456789
        -> result: "#{n}"

      @intParam = (n Integer) -> result: "#{n}"
  `;

  it('integer literal', async () => {
    await expectBehavior(script, { input: { id: '1', op: '@intLit', from: 'c' } }, { output: { id: '1', 'bv-a': { result: 'Text' }, re: { result: 'count=42' }, to: 'c' } });
  });

  it('integer constant', async () => {
    await expectBehavior(script, { input: { id: '2', op: '@intConst', from: 'c' } }, { output: { id: '2', 'bv-a': { result: 'Text' }, re: { result: 'n=7' }, to: 'c' } });
  });

  it('negative integer (via param)', async () => {
    await expectBehavior(
      script,
      { input: { id: '3', op: [[-3], '@intParam'], 'bv-a': [['Integer']], from: 'c' } },
      { output: { id: '3', 'bv-a': { result: 'Text' }, re: { result: '-3' }, to: 'c' } },
    );
  });

  it('zero', async () => {
    await expectBehavior(script, { input: { id: '4', op: '@intZero', from: 'c' } }, { output: { id: '4', 'bv-a': { result: 'Text' }, re: { result: '0' }, to: 'c' } });
  });

  it('large integer', async () => {
    await expectBehavior(script, { input: { id: '5', op: '@intLarge', from: 'c' } }, { output: { id: '5', 'bv-a': { result: 'Text' }, re: { result: '123456789' }, to: 'c' } });
  });
});

// ─── Decimal values ──────────────────────────────────────────────────────────

describe('Text interpolation — Decimal values', () => {
  const script = `
      @decConst
        =
        d Decimal = 1.5
        -> result: "#{d}"

      @decWithText
        =
        d Decimal = 3.14
        -> result: "pi=#{d}"

      @decHighPrecision
        =
        d Decimal = 0.123456
        -> result: "#{d}"

      @decParam = (d Decimal) -> result: "#{d}"
  `;

  it('decimal constant', async () => {
    await expectBehavior(script, { input: { id: '1', op: '@decConst', from: 'c' } }, { output: { id: '1', 'bv-a': { result: 'Text' }, re: { result: '1.5' }, to: 'c' } });
  });

  it('decimal with surrounding text', async () => {
    await expectBehavior(script, { input: { id: '2', op: '@decWithText', from: 'c' } }, { output: { id: '2', 'bv-a': { result: 'Text' }, re: { result: 'pi=3.14' }, to: 'c' } });
  });

  it('negative decimal (via param)', async () => {
    await expectBehavior(
      script,
      { input: { id: '3', op: [[-2.5], '@decParam'], 'bv-a': [['Decimal']], from: 'c' } },
      { output: { id: '3', 'bv-a': { result: 'Text' }, re: { result: '-2.5' }, to: 'c' } },
    );
  });

  it('high-precision decimal preserved', async () => {
    await expectBehavior(script, { input: { id: '4', op: '@decHighPrecision', from: 'c' } }, { output: { id: '4', 'bv-a': { result: 'Text' }, re: { result: '0.123456' }, to: 'c' } });
  });
});

// ─── Float values — e-notation with required decimal point + signed exponent ──

describe('Text interpolation — Float values (e-notation)', () => {
  const script = `
      @fltParam = (f Float) -> result: "#{f}"
      @fltWithText = (f Float) -> result: "v=#{f}"
  `;

  function inpF(op, f) {
    return { input: { id: '1', op: [[f], op], 'bv-a': [['Float']], from: 'c' } };
  }
  function outTxt(result) {
    return { output: { id: '1', 'bv-a': { result: 'Text' }, re: { result }, to: 'c' } };
  }

  it('1.5 → "1.5e+0"', async () => {
    await expectBehavior(script, inpF('@fltParam', 1.5e0), outTxt('1.5e+0'));
  });

  it('1.0e-10 → "1.0e-10"', async () => {
    await expectBehavior(script, inpF('@fltParam', 1.0e-10), outTxt('1.0e-10'));
  });

  it('2.5e+10 → "2.5e+10"', async () => {
    await expectBehavior(script, inpF('@fltParam', 2.5e10), outTxt('2.5e+10'));
  });

  it('negative: -3.0e+2 → "-3.0e+2"', async () => {
    await expectBehavior(script, inpF('@fltParam', -3.0e2), outTxt('-3.0e+2'));
  });

  it('integer-valued float keeps required decimal: 1.0 → "1.0e+0"', async () => {
    await expectBehavior(script, inpF('@fltParam', 1.0), outTxt('1.0e+0'));
  });

  it('float with surrounding text', async () => {
    await expectBehavior(script, inpF('@fltWithText', 1.5e0), outTxt('v=1.5e+0'));
  });

  // Full IEEE-754 double precision must survive stringification unchanged.
  // 0.1 + 0.2 in double is exactly 0.30000000000000004 — the classic case.
  // Its shortest round-trippable mantissa has 17 significant digits; every
  // one of them must appear in the output.
  it('full precision preserved — no truncation on 0.1 + 0.2', async () => {
    await expectBehavior(script, inpF('@fltParam', 0.1 + 0.2), outTxt('3.0000000000000004e-1'));
  });
});

// ─── Boolean values ──────────────────────────────────────────────────────────

describe('Text interpolation — Boolean values', () => {
  const script = `
      @tLit = -> result: "#{true}"
      @fLit = -> result: "#{false}"
      @tConst
        =
        b Boolean = true
        -> result: "flag=#{b}"
      @fConst
        =
        b Boolean = false
        -> result: "flag=#{b}"
      @fromCompare
        =
        a Integer = 3
        b Integer = 4
        -> result: "eq=#{a == b}"
  `;

  it('true literal', async () => {
    await expectBehavior(script, { input: { id: '1', op: '@tLit', from: 'c' } }, { output: { id: '1', 'bv-a': { result: 'Text' }, re: { result: 'true' }, to: 'c' } });
  });

  it('false literal', async () => {
    await expectBehavior(script, { input: { id: '2', op: '@fLit', from: 'c' } }, { output: { id: '2', 'bv-a': { result: 'Text' }, re: { result: 'false' }, to: 'c' } });
  });

  it('true constant', async () => {
    await expectBehavior(script, { input: { id: '3', op: '@tConst', from: 'c' } }, { output: { id: '3', 'bv-a': { result: 'Text' }, re: { result: 'flag=true' }, to: 'c' } });
  });

  it('false constant', async () => {
    await expectBehavior(script, { input: { id: '4', op: '@fConst', from: 'c' } }, { output: { id: '4', 'bv-a': { result: 'Text' }, re: { result: 'flag=false' }, to: 'c' } });
  });

  it('boolean expression (equality)', async () => {
    await expectBehavior(script, { input: { id: '5', op: '@fromCompare', from: 'c' } }, { output: { id: '5', 'bv-a': { result: 'Text' }, re: { result: 'eq=false' }, to: 'c' } });
  });
});

// ─── Expressions inside interpolation ────────────────────────────────────────

describe('Text interpolation — expressions', () => {
  const script = `
      @arith
        =
        a Integer = 3
        b Integer = 4
        -> result: "#{a + b}"

      @concat
        =
        name Text = "world"
        -> result: "#{name + "!"}"

      @mixedMulti
        =
        n Integer = 7
        -> result: "item #{n} of #{n * 2}"

      @mixedTypes
        =
        name Text = "box"
        count Integer = 3
        ready Boolean = true
        -> result: "#{name}: #{count} (ready=#{ready})"
  `;

  it('arithmetic inside interpolation', async () => {
    await expectBehavior(script, { input: { id: '1', op: '@arith', from: 'c' } }, { output: { id: '1', 'bv-a': { result: 'Text' }, re: { result: '7' }, to: 'c' } });
  });

  it('concatenation inside interpolation', async () => {
    await expectBehavior(script, { input: { id: '2', op: '@concat', from: 'c' } }, { output: { id: '2', 'bv-a': { result: 'Text' }, re: { result: 'world!' }, to: 'c' } });
  });

  it('multiple expressions mixed with literal text', async () => {
    await expectBehavior(script, { input: { id: '3', op: '@mixedMulti', from: 'c' } }, { output: { id: '3', 'bv-a': { result: 'Text' }, re: { result: 'item 7 of 14' }, to: 'c' } });
  });

  it('mixed types in one string', async () => {
    await expectBehavior(script, { input: { id: '4', op: '@mixedTypes', from: 'c' } }, { output: { id: '4', 'bv-a': { result: 'Text' }, re: { result: 'box: 3 (ready=true)' }, to: 'c' } });
  });
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

describe('Text — escape sequences in double-quoted strings', () => {
  const script = `
      @escHash
        =
        name Text = "world"
        -> result: "\\#{name} vs #{name}"

      @escBackslash
        =
        -> result: "back\\\\slash"

      @escQuote
        =
        -> result: "say \\"hi\\""

      @escApostropheCourtesy
        =
        -> result: "it\\'s fine"

      @escNewline
        =
        -> result: "line1\\nline2"

      @escTab
        =
        -> result: "a\\tb"

      @escCR
        =
        -> result: "a\\rb"

      @escUnicode
        =
        -> result: "smile \\u{1F600}!"

      @escHex
        =
        -> result: "byte=\\x41"

      @escMixed
        =
        name Text = "X"
        -> result: "\\#{ignored}-#{name}-\\"q\\""
  `;

  it('\\#{...} produces literal "#{...}" and suppresses interpolation there', async () => {
    await expectBehavior(script, { input: { id: '1', op: '@escHash', from: 'c' } }, { output: { id: '1', 'bv-a': { result: 'Text' }, re: { result: '#{name} vs world' }, to: 'c' } });
  });

  it('\\\\ produces a single literal backslash', async () => {
    await expectBehavior(script, { input: { id: '2', op: '@escBackslash', from: 'c' } }, { output: { id: '2', 'bv-a': { result: 'Text' }, re: { result: 'back\\slash' }, to: 'c' } });
  });

  it('\\" produces literal double quote', async () => {
    await expectBehavior(script, { input: { id: '3', op: '@escQuote', from: 'c' } }, { output: { id: '3', 'bv-a': { result: 'Text' }, re: { result: 'say "hi"' }, to: 'c' } });
  });

  it("\\' is accepted as courtesy and yields literal single quote", async () => {
    await expectBehavior(script, { input: { id: '4', op: '@escApostropheCourtesy', from: 'c' } }, { output: { id: '4', 'bv-a': { result: 'Text' }, re: { result: "it's fine" }, to: 'c' } });
  });

  it('\\n produces newline', async () => {
    await expectBehavior(script, { input: { id: '5', op: '@escNewline', from: 'c' } }, { output: { id: '5', 'bv-a': { result: 'Text' }, re: { result: 'line1\nline2' }, to: 'c' } });
  });

  it('\\t produces tab', async () => {
    await expectBehavior(script, { input: { id: '6', op: '@escTab', from: 'c' } }, { output: { id: '6', 'bv-a': { result: 'Text' }, re: { result: 'a\tb' }, to: 'c' } });
  });

  it('\\r produces carriage return', async () => {
    await expectBehavior(script, { input: { id: '7', op: '@escCR', from: 'c' } }, { output: { id: '7', 'bv-a': { result: 'Text' }, re: { result: 'a\rb' }, to: 'c' } });
  });

  it('\\u{XXXX} produces Unicode scalar', async () => {
    await expectBehavior(script, { input: { id: '8', op: '@escUnicode', from: 'c' } }, { output: { id: '8', 'bv-a': { result: 'Text' }, re: { result: 'smile \u{1F600}!' }, to: 'c' } });
  });

  it('\\xXX produces single byte from two-digit hex', async () => {
    await expectBehavior(script, { input: { id: '9', op: '@escHex', from: 'c' } }, { output: { id: '9', 'bv-a': { result: 'Text' }, re: { result: 'byte=A' }, to: 'c' } });
  });

  it('escaped and unescaped interpolation coexist', async () => {
    await expectBehavior(script, { input: { id: '10', op: '@escMixed', from: 'c' } }, { output: { id: '10', 'bv-a': { result: 'Text' }, re: { result: '#{ignored}-X-"q"' }, to: 'c' } });
  });
});

// ─── Double-quoted string compile errors ─────────────────────────────────────

describe('Text — double-quoted string compile errors', () => {
  it('\\# not followed by { is a compile error', () => {
    expect(() => compileSource(`@bad = { -> result: "a\\#b" }\n`))
      .toThrow();
  });

  it('bare backslash followed by unrecognised char is a compile error', () => {
    expect(() => compileSource(`@bad = { -> result: "a\\qb" }\n`))
      .toThrow();
  });

  it('bare \\ with nothing useful following it is a compile error', () => {
    // "\ " — backslash then space — not a valid escape
    expect(() => compileSource(`@bad = { -> result: "a\\ b" }\n`))
      .toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Single-quoted strings — RAW
//
// No interpolation. No backslash escapes (backslash is a literal character).
// Double quote is a literal character (needs no escape).
// A literal single quote is written by DOUBLING: 'How''s that?' → How's that?
// ═══════════════════════════════════════════════════════════════════════════════

describe('Text — single-quoted strings are raw', () => {
  const script = `
      @rawHash
        =
        -> result: 'hello #{name}'

      @rawBackslash
        =
        -> result: 'a\\nb'

      @rawDoubleQuote
        =
        -> result: 'say "hi"'

      @doubledQuote
        =
        -> result: 'How''s that?'

      @emptySingle
        =
        -> result: ''

      @tripleAtEdges
        =
        -> result: '''wrapped'''

      @rawBraces
        =
        -> result: '{not a closure}'
  `;

  it('#{ ... } is literal, not interpolated', async () => {
    await expectBehavior(script, { input: { id: '1', op: '@rawHash', from: 'c' } }, { output: { id: '1', 'bv-a': { result: 'Text' }, re: { result: 'hello #{name}' }, to: 'c' } });
  });

  it('backslash is a literal character (no escapes)', async () => {
    // Source is: 'a\nb' — four chars: a, backslash, n, b
    await expectBehavior(script, { input: { id: '2', op: '@rawBackslash', from: 'c' } }, { output: { id: '2', 'bv-a': { result: 'Text' }, re: { result: 'a\\nb' }, to: 'c' } });
  });

  it('double quote is a literal character', async () => {
    await expectBehavior(script, { input: { id: '3', op: '@rawDoubleQuote', from: 'c' } }, { output: { id: '3', 'bv-a': { result: 'Text' }, re: { result: 'say "hi"' }, to: 'c' } });
  });

  it("doubled '' produces a single literal '", async () => {
    await expectBehavior(script, { input: { id: '4', op: '@doubledQuote', from: 'c' } }, { output: { id: '4', 'bv-a': { result: 'Text' }, re: { result: "How's that?" }, to: 'c' } });
  });

  it('empty single-quoted string', async () => {
    await expectBehavior(script, { input: { id: '5', op: '@emptySingle', from: 'c' } }, { output: { id: '5', 'bv-a': { result: 'Text' }, re: { result: '' }, to: 'c' } });
  });

  it("'''wrapped''' produces \"'wrapped'\"", async () => {
    await expectBehavior(script, { input: { id: '6', op: '@tripleAtEdges', from: 'c' } }, { output: { id: '6', 'bv-a': { result: 'Text' }, re: { result: "'wrapped'" }, to: 'c' } });
  });

  it('{...} is literal inside single quotes (not a closure context)', async () => {
    await expectBehavior(script, { input: { id: '7', op: '@rawBraces', from: 'c' } }, { output: { id: '7', 'bv-a': { result: 'Text' }, re: { result: '{not a closure}' }, to: 'c' } });
  });
});
