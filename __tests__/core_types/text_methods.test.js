import { expectBehavior } from '../helpers.js';

describe('Text methods', () => {
  const script = `
      // Text.upper / Text.lower
      @upper = () -> result: Text.upper("hello")
      @lower = () -> result: Text.lower("HELLO")
      @upperRef = { t *Text = "hello"; return result: t.upper }
      @lowerRef = { t *Text = "HELLO"; return result: t.lower }
      @upperConst = { t Text = "world"; return result: upper(t) }

      // Text.trim / trim_start / trim_end
      @trim = () -> result: Text.trim("  hi  ")
      @trimStart = () -> result: Text.trim_start("  hi  ")
      @trimEnd = () -> result: Text.trim_end("  hi  ")
      @trimRef = { t *Text = "  ok  "; return result: t.trim }

      // Text.first / Text.last
      @first = () -> result: Text.first("hello")
      @last = () -> result: Text.last("hello")
      @firstEmpty = () -> result: Text.first("")
      @firstEmoji = () -> result: Text.first("\u{1F600}abc")
      @lastRef = { t *Text = "world"; return result: t.last }

      // Text.repeat
      @repeat = () -> result: Text.repeat("ab", 3)
      @repeatRef = { t *Text = "x"; return result: t.repeat(4) }
      @repeatZero = () -> result: Text.repeat("abc", 0)

      // Text.empty?
      @emptyTrue = () -> result: Text.empty?("")
      @emptyFalse = () -> result: Text.empty?("x")
      @emptyRef = { t *Text = ""; return result: t.empty? }

      // Text.slice
      @sliceFrom = () -> result: Text.slice("hello", 1)
      @sliceRange = () -> result: Text.slice("hello", 1, 3)
      @sliceRef = { t *Text = "abcde"; return result: t.slice(0, 2) }
      @sliceEmoji = () -> result: Text.slice("a\u{1F600}b", 1, 2)

      // Text.contains / starts_with / ends_with
      @containsYes = () -> result: Text.contains("hello world", "world")
      @containsNo = () -> result: Text.contains("hello", "xyz")
      @startsWith = () -> result: Text.starts_with("hello", "hel")
      @startsNo = () -> result: Text.starts_with("hello", "ell")
      @endsWith = () -> result: Text.ends_with("hello", "llo")
      @endsNo = () -> result: Text.ends_with("hello", "hel")
      @containsRef = { t *Text = "foobar"; return result: t.contains("bar") }

      // Text.index_of
      @found = () -> result: Text.index_of("hello world", "world")
      @notFound = () -> result: Text.index_of("hello", "xyz")
      @indexRef = { t *Text = "abcde"; return result: t.index_of("cd") }

      // Text.before / Text.after
      @before = () -> result: Text.before("hello-world", "-")
      @after = () -> result: Text.after("hello-world", "-")
      @beforeMiss = () -> result: Text.before("hello", "x")
      @afterMiss = () -> result: Text.after("hello", "x")
      @beforeRef = { t *Text = "foo:bar"; return result: t.before(":") }

      // Text.replace / Text.replace_first
      @replaceAll = () -> result: Text.replace("aabaa", "a", "x")
      @replaceFirst = () -> result: Text.replace_first("aabaa", "a", "x")
      @replaceRef = { t *Text = "hello world"; return result: t.replace("o", "0") }

      // Regex arguments
      @containsRe = () -> result: Text.contains("hello 123 world", /\\d+/)
      @containsReNo = () -> result: Text.contains("hello world", /\\d+/)
      @indexRe = () -> result: Text.index_of("abc 42 def", /\\d+/)
      @replaceRe = () -> result: Text.replace("a1b2c3", /\\d/, "x")
      @replaceFirstRe = () -> result: Text.replace_first("a1b2c3", /\\d/, "x")
      @startsRe = () -> result: Text.starts_with("123abc", /\\d+/)
      @endsRe = () -> result: Text.ends_with("abc123", /\\d+/)
      @beforeRe = () -> result: Text.before("hello 42 world", /\\d+/)
      @afterRe = () -> result: Text.after("hello 42 world", /\\d+/)

      // Bang methods — mutation
      @bangUpper
        =
        t *Text = "hello"
        t.upper!
        return result: t

      @bangLower
        =
        t *Text = "HELLO"
        t.lower!
        return result: t

      @bangTrim
        =
        t *Text = "  hi  "
        t.trim!
        return result: t

      @bangSlice
        =
        t *Text = "hello world"
        t.slice!(0, 5)
        return result: t

      @bangReplace
        =
        t *Text = "aabaa"
        t.replace!("a", "x")
        return result: t

      // Text.reverse
      @rev = () -> result: Text.reverse("hello")
      @revRef = { t *Text = "abcde"; return result: t.reverse }
      @revEmoji = () -> result: Text.reverse("a\u{1F600}b")
      @revEmpty = () -> result: Text.reverse("")
      @revBare = { t Text = "xyz"; return result: reverse(t) }

      // Bang methods — additional
      @bangReverse
        =
        t *Text = "hello"
        t.reverse!
        return result: t

      @bangTrimStart
        =
        t *Text = "  hi  "
        t.trim_start!
        return result: t

      @bangTrimEnd
        =
        t *Text = "  hi  "
        t.trim_end!
        return result: t

      @bangBefore
        =
        t *Text = "hello-world"
        t.before!("-")
        return result: t

      @bangAfter
        =
        t *Text = "hello-world"
        t.after!("-")
        return result: t

      @bangReplaceFirst
        =
        t *Text = "aabaa"
        t.replace_first!("a", "x")
        return result: t

      // Text.concat
      @concatFunc = () -> result: Text.concat("hello", " world")
      @concatRef = { t *Text = "hello"; return result: t.concat(" world") }

      // Text.append!
      @appendBang
        =
        t *Text = "hello"
        t.append!(" world")
        return result: t

      // Text.at
      @atFunc = () -> result: Text.at("hello", 1)
      @atRef = { t *Text = "hello"; return result: t.at(0) }
      @atEmoji = () -> result: Text.at("a\u{1F600}b", 1)

      // Text bang forms — same-type-returning mutators
      @upperBang   = { t *Text = "hi";        t.upper!; return result: t }
      @lowerBang   = { t *Text = "HI";        t.lower!; return result: t }
      @trimBang    = { t *Text = "  hi  ";    t.trim!; return result: t }
      @reverseBang = { t *Text = "abc";       t.reverse!; return result: t }
      @repeatBang  = { t *Text = "ab";        t.repeat!(3); return result: t }
      @replaceBang = { t *Text = "aabaa";     t.replace!("a","x"); return result: t }
      @replaceFirstBang = { t *Text = "aaa";  t.replace_first!("a","X"); return result: t }
      @beforeBang  = { t *Text = "hello bye"; t.before!(" "); return result: t }
      @afterBang   = { t *Text = "hello bye"; t.after!(" "); return result: t }
      @sliceBang   = { t *Text = "abcde";     t.slice!(1, 4); return result: t }
      @concatBang  = { t *Text = "hello";     t.concat!(" world"); return result: t }
  `;

  // ═══════════════════════════════════════════════════════════════════════════════
  // Text methods — simple (no regex, no List return)
  // ═══════════════════════════════════════════════════════════════════════════════

  it('Text.upper / Text.lower — Text.upper literal', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'upper', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Text' }], re: [{ result: 'HELLO' }], to: 'c' } });
  });
  it('Text.upper / Text.lower — Text.lower literal', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'lower', from: 'c' } }, { output: { id: '2', 'ty': [{ result: 'Text' }], re: [{ result: 'hello' }], to: 'c' } });
  });
  it('Text.upper / Text.lower — ref.upper', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'upperRef', from: 'c' } }, { output: { id: '3', 'ty': [{ result: 'Text' }], re: [{ result: 'HELLO' }], to: 'c' } });
  });
  it('Text.upper / Text.lower — ref.lower', async () => {
    await expectBehavior(script, { input: { id: '4', op: 'lowerRef', from: 'c' } }, { output: { id: '4', 'ty': [{ result: 'Text' }], re: [{ result: 'hello' }], to: 'c' } });
  });
  it('Text.upper / Text.lower — upper(const) bare call', async () => {
    await expectBehavior(script, { input: { id: '5', op: 'upperConst', from: 'c' } }, { output: { id: '5', 'ty': [{ result: 'Text' }], re: [{ result: 'WORLD' }], to: 'c' } });
  });

  it('Text.trim / trim_start / trim_end — trim both sides', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'trim', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Text' }], re: [{ result: 'hi' }], to: 'c' } });
  });
  it('Text.trim / trim_start / trim_end — trim_start', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'trimStart', from: 'c' } }, { output: { id: '2', 'ty': [{ result: 'Text' }], re: [{ result: 'hi  ' }], to: 'c' } });
  });
  it('Text.trim / trim_start / trim_end — trim_end', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'trimEnd', from: 'c' } }, { output: { id: '3', 'ty': [{ result: 'Text' }], re: [{ result: '  hi' }], to: 'c' } });
  });
  it('Text.trim / trim_start / trim_end — ref.trim', async () => {
    await expectBehavior(script, { input: { id: '4', op: 'trimRef', from: 'c' } }, { output: { id: '4', 'ty': [{ result: 'Text' }], re: [{ result: 'ok' }], to: 'c' } });
  });

  it('Text.first / Text.last — first scalar', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'first', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Text' }], re: [{ result: 'h' }], to: 'c' } });
  });
  it('Text.first / Text.last — last scalar', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'last', from: 'c' } }, { output: { id: '2', 'ty': [{ result: 'Text' }], re: [{ result: 'o' }], to: 'c' } });
  });
  it('Text.first / Text.last — first of empty', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'firstEmpty', from: 'c' } }, { output: { id: '3', 'ty': [{ result: 'Text' }], re: [{ result: '' }], to: 'c' } });
  });
  it('Text.first / Text.last — first of emoji string — full scalar', async () => {
    await expectBehavior(script, { input: { id: '4', op: 'firstEmoji', from: 'c' } }, { output: { id: '4', 'ty': [{ result: 'Text' }], re: [{ result: '\u{1F600}' }], to: 'c' } });
  });
  it('Text.first / Text.last — ref.last', async () => {
    await expectBehavior(script, { input: { id: '5', op: 'lastRef', from: 'c' } }, { output: { id: '5', 'ty': [{ result: 'Text' }], re: [{ result: 'd' }], to: 'c' } });
  });

  it('Text.repeat — repeat 3 times', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'repeat', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Text' }], re: [{ result: 'ababab' }], to: 'c' } });
  });
  it('Text.repeat — ref.repeat', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'repeatRef', from: 'c' } }, { output: { id: '2', 'ty': [{ result: 'Text' }], re: [{ result: 'xxxx' }], to: 'c' } });
  });
  it('Text.repeat — repeat 0 times', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'repeatZero', from: 'c' } }, { output: { id: '3', 'ty': [{ result: 'Text' }], re: [{ result: '' }], to: 'c' } });
  });

  it('Text.empty? — empty string is true', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'emptyTrue', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Boolean' }], re: [{ result: true }], to: 'c' } });
  });
  it('Text.empty? — non-empty is false', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'emptyFalse', from: 'c' } }, { output: { id: '2', 'ty': [{ result: 'Boolean' }], re: [{ result: false }], to: 'c' } });
  });
  it('Text.empty? — ref.empty?', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'emptyRef', from: 'c' } }, { output: { id: '3', 'ty': [{ result: 'Boolean' }], re: [{ result: true }], to: 'c' } });
  });

  it('Text.slice — slice(1) — from index to end', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'sliceFrom', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Text' }], re: [{ result: 'ello' }], to: 'c' } });
  });
  it('Text.slice — slice(1, 3) — range', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'sliceRange', from: 'c' } }, { output: { id: '2', 'ty': [{ result: 'Text' }], re: [{ result: 'el' }], to: 'c' } });
  });
  it('Text.slice — ref.slice(0, 2)', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'sliceRef', from: 'c' } }, { output: { id: '3', 'ty': [{ result: 'Text' }], re: [{ result: 'ab' }], to: 'c' } });
  });
  it('Text.slice — slice across emoji — scalar indexed', async () => {
    await expectBehavior(script, { input: { id: '4', op: 'sliceEmoji', from: 'c' } }, { output: { id: '4', 'ty': [{ result: 'Text' }], re: [{ result: '\u{1F600}' }], to: 'c' } });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // Pattern-accepting methods (string args)
  // ═══════════════════════════════════════════════════════════════════════════════

  it('Text.contains / starts_with / ends_with — contains match', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'containsYes', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Boolean' }], re: [{ result: true }], to: 'c' } });
  });
  it('Text.contains / starts_with / ends_with — contains no match', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'containsNo', from: 'c' } }, { output: { id: '2', 'ty': [{ result: 'Boolean' }], re: [{ result: false }], to: 'c' } });
  });
  it('Text.contains / starts_with / ends_with — starts_with match', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'startsWith', from: 'c' } }, { output: { id: '3', 'ty': [{ result: 'Boolean' }], re: [{ result: true }], to: 'c' } });
  });
  it('Text.contains / starts_with / ends_with — starts_with no match', async () => {
    await expectBehavior(script, { input: { id: '4', op: 'startsNo', from: 'c' } }, { output: { id: '4', 'ty': [{ result: 'Boolean' }], re: [{ result: false }], to: 'c' } });
  });
  it('Text.contains / starts_with / ends_with — ends_with match', async () => {
    await expectBehavior(script, { input: { id: '5', op: 'endsWith', from: 'c' } }, { output: { id: '5', 'ty': [{ result: 'Boolean' }], re: [{ result: true }], to: 'c' } });
  });
  it('Text.contains / starts_with / ends_with — ends_with no match', async () => {
    await expectBehavior(script, { input: { id: '6', op: 'endsNo', from: 'c' } }, { output: { id: '6', 'ty': [{ result: 'Boolean' }], re: [{ result: false }], to: 'c' } });
  });
  it('Text.contains / starts_with / ends_with — ref.contains', async () => {
    await expectBehavior(script, { input: { id: '7', op: 'containsRef', from: 'c' } }, { output: { id: '7', 'ty': [{ result: 'Boolean' }], re: [{ result: true }], to: 'c' } });
  });

  it('Text.index_of — index_of found', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'found', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 6 }], to: 'c' } });
  });
  it('Text.index_of — index_of not found returns -1', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'notFound', from: 'c' } }, { output: { id: '2', 'ty': [{ result: 'Integer' }], re: [{ result: -1 }], to: 'c' } });
  });
  it('Text.index_of — ref.index_of', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'indexRef', from: 'c' } }, { output: { id: '3', 'ty': [{ result: 'Integer' }], re: [{ result: 2 }], to: 'c' } });
  });

  it('Text.before / Text.after — before separator', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'before', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Text' }], re: [{ result: 'hello' }], to: 'c' } });
  });
  it('Text.before / Text.after — after separator', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'after', from: 'c' } }, { output: { id: '2', 'ty': [{ result: 'Text' }], re: [{ result: 'world' }], to: 'c' } });
  });
  it('Text.before / Text.after — before no match returns whole text', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'beforeMiss', from: 'c' } }, { output: { id: '3', 'ty': [{ result: 'Text' }], re: [{ result: 'hello' }], to: 'c' } });
  });
  it('Text.before / Text.after — after no match returns empty', async () => {
    await expectBehavior(script, { input: { id: '4', op: 'afterMiss', from: 'c' } }, { output: { id: '4', 'ty': [{ result: 'Text' }], re: [{ result: '' }], to: 'c' } });
  });
  it('Text.before / Text.after — ref.before', async () => {
    await expectBehavior(script, { input: { id: '5', op: 'beforeRef', from: 'c' } }, { output: { id: '5', 'ty': [{ result: 'Text' }], re: [{ result: 'foo' }], to: 'c' } });
  });

  it('Text.replace / Text.replace_first — replace all occurrences', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'replaceAll', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Text' }], re: [{ result: 'xxbxx' }], to: 'c' } });
  });
  it('Text.replace / Text.replace_first — replace_first — only first occurrence', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'replaceFirst', from: 'c' } }, { output: { id: '2', 'ty': [{ result: 'Text' }], re: [{ result: 'xabaa' }], to: 'c' } });
  });
  it('Text.replace / Text.replace_first — ref.replace', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'replaceRef', from: 'c' } }, { output: { id: '3', 'ty': [{ result: 'Text' }], re: [{ result: 'hell0 w0rld' }], to: 'c' } });
  });

  // split and lines tests deferred — List return type integration

  // ═══════════════════════════════════════════════════════════════════════════════
  // Regex literal arguments
  // ═══════════════════════════════════════════════════════════════════════════════

  it('Regex arguments — contains with regex', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'containsRe', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Boolean' }], re: [{ result: true }], to: 'c' } });
  });
  it('Regex arguments — contains with regex — no match', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'containsReNo', from: 'c' } }, { output: { id: '2', 'ty': [{ result: 'Boolean' }], re: [{ result: false }], to: 'c' } });
  });
  it('Regex arguments — index_of with regex', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'indexRe', from: 'c' } }, { output: { id: '3', 'ty': [{ result: 'Integer' }], re: [{ result: 4 }], to: 'c' } });
  });
  it('Regex arguments — replace with regex (all)', async () => {
    await expectBehavior(script, { input: { id: '4', op: 'replaceRe', from: 'c' } }, { output: { id: '4', 'ty': [{ result: 'Text' }], re: [{ result: 'axbxcx' }], to: 'c' } });
  });
  it('Regex arguments — replace_first with regex', async () => {
    await expectBehavior(script, { input: { id: '5', op: 'replaceFirstRe', from: 'c' } }, { output: { id: '5', 'ty': [{ result: 'Text' }], re: [{ result: 'axb2c3' }], to: 'c' } });
  });
  it('Regex arguments — starts_with regex', async () => {
    await expectBehavior(script, { input: { id: '6', op: 'startsRe', from: 'c' } }, { output: { id: '6', 'ty': [{ result: 'Boolean' }], re: [{ result: true }], to: 'c' } });
  });
  it('Regex arguments — ends_with regex', async () => {
    await expectBehavior(script, { input: { id: '7', op: 'endsRe', from: 'c' } }, { output: { id: '7', 'ty': [{ result: 'Boolean' }], re: [{ result: true }], to: 'c' } });
  });
  it('Regex arguments — before regex', async () => {
    await expectBehavior(script, { input: { id: '8', op: 'beforeRe', from: 'c' } }, { output: { id: '8', 'ty': [{ result: 'Text' }], re: [{ result: 'hello ' }], to: 'c' } });
  });
  it('Regex arguments — after regex', async () => {
    await expectBehavior(script, { input: { id: '9', op: 'afterRe', from: 'c' } }, { output: { id: '9', 'ty': [{ result: 'Text' }], re: [{ result: ' world' }], to: 'c' } });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // Bang methods — mutate ref in place
  // ═══════════════════════════════════════════════════════════════════════════════

  it('Bang methods — mutation — t.upper! mutates ref', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'bangUpper', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Text' }], re: [{ result: 'HELLO' }], to: 'c' } });
  });

  it('Bang methods — mutation — t.lower! mutates ref', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'bangLower', from: 'c' } }, { output: { id: '2', 'ty': [{ result: 'Text' }], re: [{ result: 'hello' }], to: 'c' } });
  });

  it('Bang methods — mutation — t.trim! mutates ref', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'bangTrim', from: 'c' } }, { output: { id: '3', 'ty': [{ result: 'Text' }], re: [{ result: 'hi' }], to: 'c' } });
  });

  it('Bang methods — mutation — t.slice!(0, 5) mutates ref', async () => {
    await expectBehavior(script, { input: { id: '4', op: 'bangSlice', from: 'c' } }, { output: { id: '4', 'ty': [{ result: 'Text' }], re: [{ result: 'hello' }], to: 'c' } });
  });

  it('Bang methods — mutation — t.replace!("a", "x") mutates ref', async () => {
    await expectBehavior(script, { input: { id: '5', op: 'bangReplace', from: 'c' } }, { output: { id: '5', 'ty': [{ result: 'Text' }], re: [{ result: 'xxbxx' }], to: 'c' } });
  });

  it('Text.reverse — reverse ascii', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'rev', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Text' }], re: [{ result: 'olleh' }], to: 'c' } });
  });
  it('Text.reverse — ref.reverse', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'revRef', from: 'c' } }, { output: { id: '2', 'ty': [{ result: 'Text' }], re: [{ result: 'edcba' }], to: 'c' } });
  });
  it('Text.reverse — reverse with emoji — scalar-level', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'revEmoji', from: 'c' } }, { output: { id: '3', 'ty': [{ result: 'Text' }], re: [{ result: 'b\u{1F600}a' }], to: 'c' } });
  });
  it('Text.reverse — reverse empty', async () => {
    await expectBehavior(script, { input: { id: '4', op: 'revEmpty', from: 'c' } }, { output: { id: '4', 'ty': [{ result: 'Text' }], re: [{ result: '' }], to: 'c' } });
  });
  it('Text.reverse — bare reverse(const)', async () => {
    await expectBehavior(script, { input: { id: '5', op: 'revBare', from: 'c' } }, { output: { id: '5', 'ty': [{ result: 'Text' }], re: [{ result: 'zyx' }], to: 'c' } });
  });

  it('Bang methods — additional — t.reverse!', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'bangReverse', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Text' }], re: [{ result: 'olleh' }], to: 'c' } });
  });
  it('Bang methods — additional — t.trim_start!', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'bangTrimStart', from: 'c' } }, { output: { id: '2', 'ty': [{ result: 'Text' }], re: [{ result: 'hi  ' }], to: 'c' } });
  });
  it('Bang methods — additional — t.trim_end!', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'bangTrimEnd', from: 'c' } }, { output: { id: '3', 'ty': [{ result: 'Text' }], re: [{ result: '  hi' }], to: 'c' } });
  });
  it('Bang methods — additional — t.before!("-")', async () => {
    await expectBehavior(script, { input: { id: '4', op: 'bangBefore', from: 'c' } }, { output: { id: '4', 'ty': [{ result: 'Text' }], re: [{ result: 'hello' }], to: 'c' } });
  });
  it('Bang methods — additional — t.after!("-")', async () => {
    await expectBehavior(script, { input: { id: '5', op: 'bangAfter', from: 'c' } }, { output: { id: '5', 'ty': [{ result: 'Text' }], re: [{ result: 'world' }], to: 'c' } });
  });
  it('Bang methods — additional — t.replace_first!("a", "x")', async () => {
    await expectBehavior(script, { input: { id: '6', op: 'bangReplaceFirst', from: 'c' } }, { output: { id: '6', 'ty': [{ result: 'Text' }], re: [{ result: 'xabaa' }], to: 'c' } });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // Text.concat / Text.append! / Text.at
  // ═══════════════════════════════════════════════════════════════════════════════

  it('Text.concat — Text.concat(a, b)', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'concatFunc', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Text' }], re: [{ result: 'hello world' }], to: 'c' } });
  });
  it('Text.concat — ref.concat(b)', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'concatRef', from: 'c' } }, { output: { id: '2', 'ty': [{ result: 'Text' }], re: [{ result: 'hello world' }], to: 'c' } });
  });

  it('Text.append! — t.append!(b) mutates ref', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'appendBang', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Text' }], re: [{ result: 'hello world' }], to: 'c' } });
  });

  it('Text.at — Text.at(text, 1)', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'atFunc', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Text' }], re: [{ result: 'e' }], to: 'c' } });
  });
  it('Text.at — ref.at(0)', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'atRef', from: 'c' } }, { output: { id: '2', 'ty': [{ result: 'Text' }], re: [{ result: 'h' }], to: 'c' } });
  });
  it('Text.at — at emoji — scalar indexed', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'atEmoji', from: 'c' } }, { output: { id: '3', 'ty': [{ result: 'Text' }], re: [{ result: '\u{1F600}' }], to: 'c' } });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // Bang-form coverage — representative sample.
  //
  // The bang transform in pushExprOrBang is generic across all same-type-returning
  // methods, so we don't need to exercise every one. These cover the categories:
  // transform-of-self (upper!, reverse!), trim family, replace, before/after,
  // slice, repeat. If the bang machinery breaks, at least one of these will fail.
  // ═══════════════════════════════════════════════════════════════════════════════

  it('Text bang forms — same-type-returning mutators — upper! mutates ref to upper-cased', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'upperBang', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Text' }], re: [{ result: 'HI' }], to: 'c' } });
  });
  it('Text bang forms — same-type-returning mutators — lower! mutates ref to lower-cased', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'lowerBang', from: 'c' } }, { output: { id: '2', 'ty': [{ result: 'Text' }], re: [{ result: 'hi' }], to: 'c' } });
  });
  it('Text bang forms — same-type-returning mutators — trim! mutates ref to trimmed', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'trimBang', from: 'c' } }, { output: { id: '3', 'ty': [{ result: 'Text' }], re: [{ result: 'hi' }], to: 'c' } });
  });
  it('Text bang forms — same-type-returning mutators — reverse! mutates ref to reversed', async () => {
    await expectBehavior(script, { input: { id: '4', op: 'reverseBang', from: 'c' } }, { output: { id: '4', 'ty': [{ result: 'Text' }], re: [{ result: 'cba' }], to: 'c' } });
  });
  it('Text bang forms — same-type-returning mutators — repeat! mutates ref to repeated', async () => {
    await expectBehavior(script, { input: { id: '5', op: 'repeatBang', from: 'c' } }, { output: { id: '5', 'ty': [{ result: 'Text' }], re: [{ result: 'ababab' }], to: 'c' } });
  });
  it('Text bang forms — same-type-returning mutators — replace! mutates all occurrences', async () => {
    await expectBehavior(script, { input: { id: '6', op: 'replaceBang', from: 'c' } }, { output: { id: '6', 'ty': [{ result: 'Text' }], re: [{ result: 'xxbxx' }], to: 'c' } });
  });
  it('Text bang forms — same-type-returning mutators — replace_first! mutates first occurrence', async () => {
    await expectBehavior(script, { input: { id: '7', op: 'replaceFirstBang', from: 'c' } }, { output: { id: '7', 'ty': [{ result: 'Text' }], re: [{ result: 'Xaa' }], to: 'c' } });
  });
  it('Text bang forms — same-type-returning mutators — before! mutates ref to prefix', async () => {
    await expectBehavior(script, { input: { id: '8', op: 'beforeBang', from: 'c' } }, { output: { id: '8', 'ty': [{ result: 'Text' }], re: [{ result: 'hello' }], to: 'c' } });
  });
  it('Text bang forms — same-type-returning mutators — after! mutates ref to suffix', async () => {
    await expectBehavior(script, { input: { id: '9', op: 'afterBang', from: 'c' } }, { output: { id: '9', 'ty': [{ result: 'Text' }], re: [{ result: 'bye' }], to: 'c' } });
  });
  it('Text bang forms — same-type-returning mutators — slice! mutates ref to range', async () => {
    await expectBehavior(script, { input: { id: '10', op: 'sliceBang', from: 'c' } }, { output: { id: '10', 'ty': [{ result: 'Text' }], re: [{ result: 'bcd' }], to: 'c' } });
  });
  it('Text bang forms — same-type-returning mutators — concat! mutates ref to concatenated', async () => {
    await expectBehavior(script, { input: { id: '11', op: 'concatBang', from: 'c' } }, { output: { id: '11', 'ty': [{ result: 'Text' }], re: [{ result: 'hello world' }], to: 'c' } });
  });
});
