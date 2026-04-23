import { expectBehavior } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Text methods — simple (no regex, no List return)
// ═══════════════════════════════════════════════════════════════════════════════

const out = (id, type, value) => ({ output: { id, 'bv-a': { result: type }, re: { result: value }, to: 'c' } });
const inp = (id, op) => ({ input: { id, op, from: 'c' } });

describe('Text.upper / Text.lower', () => {
  const script = `
      @upper = -> result: Text.upper("hello")
      @lower = -> result: Text.lower("HELLO")
      @upperRef = { t *Text = "hello"; -> result: t.upper }
      @lowerRef = { t *Text = "HELLO"; -> result: t.lower }
      @upperConst = { t Text = "world"; -> result: upper(t) }
  `;

  it('Text.upper literal', async () => {
    await expectBehavior(script, inp('1', '@upper'), out('1', 'Text', 'HELLO'));
  });
  it('Text.lower literal', async () => {
    await expectBehavior(script, inp('2', '@lower'), out('2', 'Text', 'hello'));
  });
  it('ref.upper', async () => {
    await expectBehavior(script, inp('3', '@upperRef'), out('3', 'Text', 'HELLO'));
  });
  it('ref.lower', async () => {
    await expectBehavior(script, inp('4', '@lowerRef'), out('4', 'Text', 'hello'));
  });
  it('upper(const) bare call', async () => {
    await expectBehavior(script, inp('5', '@upperConst'), out('5', 'Text', 'WORLD'));
  });
});

describe('Text.trim / trim_start / trim_end', () => {
  const script = `
      @trim = -> result: Text.trim("  hi  ")
      @trimStart = -> result: Text.trim_start("  hi  ")
      @trimEnd = -> result: Text.trim_end("  hi  ")
      @trimRef = { t *Text = "  ok  "; -> result: t.trim }
  `;

  it('trim both sides', async () => {
    await expectBehavior(script, inp('1', '@trim'), out('1', 'Text', 'hi'));
  });
  it('trim_start', async () => {
    await expectBehavior(script, inp('2', '@trimStart'), out('2', 'Text', 'hi  '));
  });
  it('trim_end', async () => {
    await expectBehavior(script, inp('3', '@trimEnd'), out('3', 'Text', '  hi'));
  });
  it('ref.trim', async () => {
    await expectBehavior(script, inp('4', '@trimRef'), out('4', 'Text', 'ok'));
  });
});

describe('Text.first / Text.last', () => {
  const script = `
      @first = -> result: Text.first("hello")
      @last = -> result: Text.last("hello")
      @firstEmpty = -> result: Text.first("")
      @firstEmoji = -> result: Text.first("\u{1F600}abc")
      @lastRef = { t *Text = "world"; -> result: t.last }
  `;

  it('first scalar', async () => {
    await expectBehavior(script, inp('1', '@first'), out('1', 'Text', 'h'));
  });
  it('last scalar', async () => {
    await expectBehavior(script, inp('2', '@last'), out('2', 'Text', 'o'));
  });
  it('first of empty', async () => {
    await expectBehavior(script, inp('3', '@firstEmpty'), out('3', 'Text', ''));
  });
  it('first of emoji string — full scalar', async () => {
    await expectBehavior(script, inp('4', '@firstEmoji'), out('4', 'Text', '\u{1F600}'));
  });
  it('ref.last', async () => {
    await expectBehavior(script, inp('5', '@lastRef'), out('5', 'Text', 'd'));
  });
});

describe('Text.repeat', () => {
  const script = `
      @repeat = -> result: Text.repeat("ab", 3)
      @repeatRef = { t *Text = "x"; -> result: t.repeat(4) }
      @repeatZero = -> result: Text.repeat("abc", 0)
  `;

  it('repeat 3 times', async () => {
    await expectBehavior(script, inp('1', '@repeat'), out('1', 'Text', 'ababab'));
  });
  it('ref.repeat', async () => {
    await expectBehavior(script, inp('2', '@repeatRef'), out('2', 'Text', 'xxxx'));
  });
  it('repeat 0 times', async () => {
    await expectBehavior(script, inp('3', '@repeatZero'), out('3', 'Text', ''));
  });
});

describe('Text.empty?', () => {
  const script = `
      @emptyTrue = -> result: Text.empty?("")
      @emptyFalse = -> result: Text.empty?("x")
      @emptyRef = { t *Text = ""; -> result: t.empty? }
  `;

  it('empty string is true', async () => {
    await expectBehavior(script, inp('1', '@emptyTrue'), out('1', 'Boolean', true));
  });
  it('non-empty is false', async () => {
    await expectBehavior(script, inp('2', '@emptyFalse'), out('2', 'Boolean', false));
  });
  it('ref.empty?', async () => {
    await expectBehavior(script, inp('3', '@emptyRef'), out('3', 'Boolean', true));
  });
});

describe('Text.slice', () => {
  const script = `
      @sliceFrom = -> result: Text.slice("hello", 1)
      @sliceRange = -> result: Text.slice("hello", 1, 3)
      @sliceRef = { t *Text = "abcde"; -> result: t.slice(0, 2) }
      @sliceEmoji = -> result: Text.slice("a\u{1F600}b", 1, 2)
  `;

  it('slice(1) — from index to end', async () => {
    await expectBehavior(script, inp('1', '@sliceFrom'), out('1', 'Text', 'ello'));
  });
  it('slice(1, 3) — range', async () => {
    await expectBehavior(script, inp('2', '@sliceRange'), out('2', 'Text', 'el'));
  });
  it('ref.slice(0, 2)', async () => {
    await expectBehavior(script, inp('3', '@sliceRef'), out('3', 'Text', 'ab'));
  });
  it('slice across emoji — scalar indexed', async () => {
    await expectBehavior(script, inp('4', '@sliceEmoji'), out('4', 'Text', '\u{1F600}'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Pattern-accepting methods (string args)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Text.contains / starts_with / ends_with', () => {
  const script = `
      @containsYes = -> result: Text.contains("hello world", "world")
      @containsNo = -> result: Text.contains("hello", "xyz")
      @startsWith = -> result: Text.starts_with("hello", "hel")
      @startsNo = -> result: Text.starts_with("hello", "ell")
      @endsWith = -> result: Text.ends_with("hello", "llo")
      @endsNo = -> result: Text.ends_with("hello", "hel")
      @containsRef = { t *Text = "foobar"; -> result: t.contains("bar") }
  `;

  it('contains match', async () => {
    await expectBehavior(script, inp('1', '@containsYes'), out('1', 'Boolean', true));
  });
  it('contains no match', async () => {
    await expectBehavior(script, inp('2', '@containsNo'), out('2', 'Boolean', false));
  });
  it('starts_with match', async () => {
    await expectBehavior(script, inp('3', '@startsWith'), out('3', 'Boolean', true));
  });
  it('starts_with no match', async () => {
    await expectBehavior(script, inp('4', '@startsNo'), out('4', 'Boolean', false));
  });
  it('ends_with match', async () => {
    await expectBehavior(script, inp('5', '@endsWith'), out('5', 'Boolean', true));
  });
  it('ends_with no match', async () => {
    await expectBehavior(script, inp('6', '@endsNo'), out('6', 'Boolean', false));
  });
  it('ref.contains', async () => {
    await expectBehavior(script, inp('7', '@containsRef'), out('7', 'Boolean', true));
  });
});

describe('Text.index_of', () => {
  const script = `
      @found = -> result: Text.index_of("hello world", "world")
      @notFound = -> result: Text.index_of("hello", "xyz")
      @indexRef = { t *Text = "abcde"; -> result: t.index_of("cd") }
  `;

  it('index_of found', async () => {
    await expectBehavior(script, inp('1', '@found'), out('1', 'Integer', 6));
  });
  it('index_of not found returns -1', async () => {
    await expectBehavior(script, inp('2', '@notFound'), out('2', 'Integer', -1));
  });
  it('ref.index_of', async () => {
    await expectBehavior(script, inp('3', '@indexRef'), out('3', 'Integer', 2));
  });
});

describe('Text.before / Text.after', () => {
  const script = `
      @before = -> result: Text.before("hello-world", "-")
      @after = -> result: Text.after("hello-world", "-")
      @beforeMiss = -> result: Text.before("hello", "x")
      @afterMiss = -> result: Text.after("hello", "x")
      @beforeRef = { t *Text = "foo:bar"; -> result: t.before(":") }
  `;

  it('before separator', async () => {
    await expectBehavior(script, inp('1', '@before'), out('1', 'Text', 'hello'));
  });
  it('after separator', async () => {
    await expectBehavior(script, inp('2', '@after'), out('2', 'Text', 'world'));
  });
  it('before no match returns whole text', async () => {
    await expectBehavior(script, inp('3', '@beforeMiss'), out('3', 'Text', 'hello'));
  });
  it('after no match returns empty', async () => {
    await expectBehavior(script, inp('4', '@afterMiss'), out('4', 'Text', ''));
  });
  it('ref.before', async () => {
    await expectBehavior(script, inp('5', '@beforeRef'), out('5', 'Text', 'foo'));
  });
});

describe('Text.replace / Text.replace_first', () => {
  const script = `
      @replaceAll = -> result: Text.replace("aabaa", "a", "x")
      @replaceFirst = -> result: Text.replace_first("aabaa", "a", "x")
      @replaceRef = { t *Text = "hello world"; -> result: t.replace("o", "0") }
  `;

  it('replace all occurrences', async () => {
    await expectBehavior(script, inp('1', '@replaceAll'), out('1', 'Text', 'xxbxx'));
  });
  it('replace_first — only first occurrence', async () => {
    await expectBehavior(script, inp('2', '@replaceFirst'), out('2', 'Text', 'xabaa'));
  });
  it('ref.replace', async () => {
    await expectBehavior(script, inp('3', '@replaceRef'), out('3', 'Text', 'hell0 w0rld'));
  });
});

// split and lines tests deferred — List return type integration

// ═══════════════════════════════════════════════════════════════════════════════
// Regex literal arguments
// ═══════════════════════════════════════════════════════════════════════════════

describe('Regex arguments', () => {
  const script = `
      @containsRe = -> result: Text.contains("hello 123 world", /\\d+/)
      @containsReNo = -> result: Text.contains("hello world", /\\d+/)
      @indexRe = -> result: Text.index_of("abc 42 def", /\\d+/)
      @replaceRe = -> result: Text.replace("a1b2c3", /\\d/, "x")
      @replaceFirstRe = -> result: Text.replace_first("a1b2c3", /\\d/, "x")
      @startsRe = -> result: Text.starts_with("123abc", /\\d+/)
      @endsRe = -> result: Text.ends_with("abc123", /\\d+/)
      @beforeRe = -> result: Text.before("hello 42 world", /\\d+/)
      @afterRe = -> result: Text.after("hello 42 world", /\\d+/)
  `;

  it('contains with regex', async () => {
    await expectBehavior(script, inp('1', '@containsRe'), out('1', 'Boolean', true));
  });
  it('contains with regex — no match', async () => {
    await expectBehavior(script, inp('2', '@containsReNo'), out('2', 'Boolean', false));
  });
  it('index_of with regex', async () => {
    await expectBehavior(script, inp('3', '@indexRe'), out('3', 'Integer', 4));
  });
  it('replace with regex (all)', async () => {
    await expectBehavior(script, inp('4', '@replaceRe'), out('4', 'Text', 'axbxcx'));
  });
  it('replace_first with regex', async () => {
    await expectBehavior(script, inp('5', '@replaceFirstRe'), out('5', 'Text', 'axb2c3'));
  });
  it('starts_with regex', async () => {
    await expectBehavior(script, inp('6', '@startsRe'), out('6', 'Boolean', true));
  });
  it('ends_with regex', async () => {
    await expectBehavior(script, inp('7', '@endsRe'), out('7', 'Boolean', true));
  });
  it('before regex', async () => {
    await expectBehavior(script, inp('8', '@beforeRe'), out('8', 'Text', 'hello '));
  });
  it('after regex', async () => {
    await expectBehavior(script, inp('9', '@afterRe'), out('9', 'Text', ' world'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Bang methods — mutate ref in place
// ═══════════════════════════════════════════════════════════════════════════════

describe('Bang methods — mutation', () => {
  const script = `
      @bangUpper
        =
        t *Text = "hello"
        t.upper!
        -> result: t

      @bangLower
        =
        t *Text = "HELLO"
        t.lower!
        -> result: t

      @bangTrim
        =
        t *Text = "  hi  "
        t.trim!
        -> result: t

      @bangSlice
        =
        t *Text = "hello world"
        t.slice!(0, 5)
        -> result: t

      @bangReplace
        =
        t *Text = "aabaa"
        t.replace!("a", "x")
        -> result: t
  `;

  it('t.upper! mutates ref', async () => {
    await expectBehavior(script, inp('1', '@bangUpper'), out('1', 'Text', 'HELLO'));
  });

  it('t.lower! mutates ref', async () => {
    await expectBehavior(script, inp('2', '@bangLower'), out('2', 'Text', 'hello'));
  });

  it('t.trim! mutates ref', async () => {
    await expectBehavior(script, inp('3', '@bangTrim'), out('3', 'Text', 'hi'));
  });

  it('t.slice!(0, 5) mutates ref', async () => {
    await expectBehavior(script, inp('4', '@bangSlice'), out('4', 'Text', 'hello'));
  });

  it('t.replace!("a", "x") mutates ref', async () => {
    await expectBehavior(script, inp('5', '@bangReplace'), out('5', 'Text', 'xxbxx'));
  });
});

describe('Text.reverse', () => {
  const script = `
      @rev = -> result: Text.reverse("hello")
      @revRef = { t *Text = "abcde"; -> result: t.reverse }
      @revEmoji = -> result: Text.reverse("a\u{1F600}b")
      @revEmpty = -> result: Text.reverse("")
      @revBare = { t Text = "xyz"; -> result: reverse(t) }
  `;

  it('reverse ascii', async () => {
    await expectBehavior(script, inp('1', '@rev'), out('1', 'Text', 'olleh'));
  });
  it('ref.reverse', async () => {
    await expectBehavior(script, inp('2', '@revRef'), out('2', 'Text', 'edcba'));
  });
  it('reverse with emoji — scalar-level', async () => {
    await expectBehavior(script, inp('3', '@revEmoji'), out('3', 'Text', 'b\u{1F600}a'));
  });
  it('reverse empty', async () => {
    await expectBehavior(script, inp('4', '@revEmpty'), out('4', 'Text', ''));
  });
  it('bare reverse(const)', async () => {
    await expectBehavior(script, inp('5', '@revBare'), out('5', 'Text', 'zyx'));
  });
});

describe('Bang methods — additional', () => {
  const script = `
      @bangReverse
        =
        t *Text = "hello"
        t.reverse!
        -> result: t

      @bangTrimStart
        =
        t *Text = "  hi  "
        t.trim_start!
        -> result: t

      @bangTrimEnd
        =
        t *Text = "  hi  "
        t.trim_end!
        -> result: t

      @bangBefore
        =
        t *Text = "hello-world"
        t.before!("-")
        -> result: t

      @bangAfter
        =
        t *Text = "hello-world"
        t.after!("-")
        -> result: t

      @bangReplaceFirst
        =
        t *Text = "aabaa"
        t.replace_first!("a", "x")
        -> result: t
  `;

  it('t.reverse!', async () => {
    await expectBehavior(script, inp('1', '@bangReverse'), out('1', 'Text', 'olleh'));
  });
  it('t.trim_start!', async () => {
    await expectBehavior(script, inp('2', '@bangTrimStart'), out('2', 'Text', 'hi  '));
  });
  it('t.trim_end!', async () => {
    await expectBehavior(script, inp('3', '@bangTrimEnd'), out('3', 'Text', '  hi'));
  });
  it('t.before!("-")', async () => {
    await expectBehavior(script, inp('4', '@bangBefore'), out('4', 'Text', 'hello'));
  });
  it('t.after!("-")', async () => {
    await expectBehavior(script, inp('5', '@bangAfter'), out('5', 'Text', 'world'));
  });
  it('t.replace_first!("a", "x")', async () => {
    await expectBehavior(script, inp('6', '@bangReplaceFirst'), out('6', 'Text', 'xabaa'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Text.concat / Text.append! / Text.at
// ═══════════════════════════════════════════════════════════════════════════════

describe('Text.concat', () => {
  const script = `
      @concatFunc = -> result: Text.concat("hello", " world")
      @concatRef = { t *Text = "hello"; -> result: t.concat(" world") }
  `;

  it('Text.concat(a, b)', async () => {
    await expectBehavior(script, inp('1', '@concatFunc'), out('1', 'Text', 'hello world'));
  });
  it('ref.concat(b)', async () => {
    await expectBehavior(script, inp('2', '@concatRef'), out('2', 'Text', 'hello world'));
  });
});

describe('Text.append!', () => {
  const script = `
      @appendBang
        =
        t *Text = "hello"
        t.append!(" world")
        -> result: t
  `;

  it('t.append!(b) mutates ref', async () => {
    await expectBehavior(script, inp('1', '@appendBang'), out('1', 'Text', 'hello world'));
  });
});

describe('Text.at', () => {
  const script = `
      @atFunc = -> result: Text.at("hello", 1)
      @atRef = { t *Text = "hello"; -> result: t.at(0) }
      @atEmoji = -> result: Text.at("a\u{1F600}b", 1)
  `;

  it('Text.at(text, 1)', async () => {
    await expectBehavior(script, inp('1', '@atFunc'), out('1', 'Text', 'e'));
  });
  it('ref.at(0)', async () => {
    await expectBehavior(script, inp('2', '@atRef'), out('2', 'Text', 'h'));
  });
  it('at emoji — scalar indexed', async () => {
    await expectBehavior(script, inp('3', '@atEmoji'), out('3', 'Text', '\u{1F600}'));
  });
});
