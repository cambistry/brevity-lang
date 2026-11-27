import { expectBehavior } from '../helpers.js';

describe('Blob methods', () => {
  const script = `
      // Blob.empty?
      @emptyYes = () -> result: Blob.empty?("")
      @emptyNo = () -> result: Blob.empty?("x")
      @emptyRef = { b *Blob = ""; return result: b.empty? }

      // Blob.slice
      @sliceFrom = () -> result: Blob.slice("hello", 1)
      @sliceRange = () -> result: Blob.slice("hello", 1, 3)
      @sliceRef = { b *Blob = "abcde"; return result: b.slice(0, 2) }

      // Blob.first / Blob.last
      @first = () -> result: Blob.first("hello")
      @last = () -> result: Blob.last("hello")
      @firstEmpty = () -> result: Blob.first("")
      @lastRef = { b *Blob = "world"; return result: b.last }

      // Blob.repeat / Blob.reverse
      @repeat = () -> result: Blob.repeat("ab", 3)
      @reverse = () -> result: Blob.reverse("abc")
      @reverseRef = { b *Blob = "xyz"; return result: b.reverse }

      // Blob.trim / trim_start / trim_end
      @trim = () -> result: Blob.trim("  hi  ")
      @trimStart = () -> result: Blob.trim_start("  hi  ")
      @trimEnd = () -> result: Blob.trim_end("  hi  ")

      // Blob.contains / starts_with / ends_with
      @containsYes = () -> result: Blob.contains("hello world", "world")
      @containsNo = () -> result: Blob.contains("hello", "xyz")
      @startsWith = () -> result: Blob.starts_with("hello", "hel")
      @endsWith = () -> result: Blob.ends_with("hello", "llo")
      @containsRef = { b *Blob = "foobar"; return result: b.contains("bar") }

      // Blob.index_of
      @found = () -> result: Blob.index_of("hello world", "world")
      @notFound = () -> result: Blob.index_of("hello", "xyz")
      @indexRef = { b *Blob = "abcde"; return result: b.index_of("cd") }

      // Blob.before / Blob.after
      @before = () -> result: Blob.before("hello-world", "-")
      @after = () -> result: Blob.after("hello-world", "-")
      @beforeMiss = () -> result: Blob.before("hello", "x")
      @afterMiss = () -> result: Blob.after("hello", "x")

      // Blob.replace / Blob.replace_first
      @replaceAll = () -> result: Blob.replace("aabaa", "a", "x")
      @replaceFirst = () -> result: Blob.replace_first("aabaa", "a", "x")
      @replaceRef = { b *Blob = "hello"; return result: b.replace("l", "r") }

      // Blob vs Text — byte vs scalar size
      @blobSizeAccented
        =
        return result: Blob.size("\u{00E9}")

      @textSizeAccented
        =
        return result: Text.size("\u{00E9}")

      @blobSizeEmoji
        =
        return result: Blob.size("\u{1F600}")

      @textSizeEmoji
        =
        return result: size("\u{1F600}")

      // Blob bang methods
      @bangReverse
        =
        b *Blob = "hello"
        b.reverse!
        return result: b

      @bangSlice
        =
        b *Blob = "hello world"
        b.slice!(0, 5)
        return result: b

      @bangReplace
        =
        b *Blob = "aabaa"
        b.replace!("a", "x")
        return result: b

      @bangTrim
        =
        b *Blob = "  hi  "
        b.trim!
        return result: b

      // Blob regex — pattern matching
      @containsRe = () -> result: Blob.contains("hello 123 world", /\\d+/)
      @containsReNo = () -> result: Blob.contains("hello world", /\\d+/)
      @startsRe = () -> result: Blob.starts_with("123abc", /\\d+/)
      @startsReNo = () -> result: Blob.starts_with("abc123", /\\d+/)
      @endsRe = () -> result: Blob.ends_with("abc123", /\\d+/)
      @indexRe = () -> result: Blob.index_of("abc 42 def", /\\d+/)
      @beforeRe = () -> result: Blob.before("hello 42 world", /\\d+/)
      @afterRe = () -> result: Blob.after("hello 42 world", /\\d+/)
      @replaceRe = () -> result: Blob.replace("a1b2c3", /\\d/, "x")
      @replaceFirstRe = () -> result: Blob.replace_first("a1b2c3", /\\d/, "x")

      // Blob.concat
      @concatFunc = () -> result: Blob.concat("hello", " world")
      @concatRef = { b *Blob = "hello"; return result: b.concat(" world") }

      // Blob.append!
      @appendBang
        =
        b *Blob = "hello"
        b.append!(" world")
        return result: b

      // Blob.at
      @atFunc = () -> result: Blob.at("hello", 0)
      @atRef = { b *Blob = "ABC"; return result: b.at(1) }

      // Blob.zeros
      @zeros = () -> result: Blob.size(Blob.zeros(5))

      // Blob.from_hex / Blob.to_hex
      @toHex = () -> result: Blob.to_hex("hello")
      @roundtrip = () -> result: Blob.from_hex("68656c6c6f")

      // Blob.from_base64 / Blob.to_base64
      @toB64 = () -> result: Blob.to_base64("hello")
      @fromB64 = () -> result: Blob.from_base64("aGVsbG8=")

      // Blob.from_utf8 / Blob.to_utf8
      @toUtf8 = () -> result: Blob.to_utf8("hello")
      @fromUtf8 = () -> result: Blob.from_utf8("hello")

      // Blob.xor
      @xorSelf = () -> result: Blob.to_hex(Blob.xor("hello", "hello"))

      // Blob.constant_time_equals
      @eqYes = () -> result: Blob.constant_time_equals("hello", "hello")
      @eqNo = () -> result: Blob.constant_time_equals("hello", "world")
      @eqLen = () -> result: Blob.constant_time_equals("hi", "hello")
  `;

  // ═══════════════════════════════════════════════════════════════════════════════
  // Blob methods — byte-level operations
  // ═══════════════════════════════════════════════════════════════════════════════

  it('Blob.empty? — empty blob', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'emptyYes', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Boolean' }], re: [{ result: true }], to: 'c' } });
  });
  it('Blob.empty? — non-empty blob', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'emptyNo', from: 'c' } }, { output: { id: '2', 'ty': [{ result: 'Boolean' }], re: [{ result: false }], to: 'c' } });
  });
  it('Blob.empty? — ref.empty?', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'emptyRef', from: 'c' } }, { output: { id: '3', 'ty': [{ result: 'Boolean' }], re: [{ result: true }], to: 'c' } });
  });

  it('Blob.slice — slice from index to end', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'sliceFrom', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Blob' }], re: [{ result: 'ello' }], to: 'c' } });
  });
  it('Blob.slice — slice range', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'sliceRange', from: 'c' } }, { output: { id: '2', 'ty': [{ result: 'Blob' }], re: [{ result: 'el' }], to: 'c' } });
  });
  it('Blob.slice — ref.slice', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'sliceRef', from: 'c' } }, { output: { id: '3', 'ty': [{ result: 'Blob' }], re: [{ result: 'ab' }], to: 'c' } });
  });

  it('Blob.first / Blob.last — first byte', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'first', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Blob' }], re: [{ result: 'h' }], to: 'c' } });
  });
  it('Blob.first / Blob.last — last byte', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'last', from: 'c' } }, { output: { id: '2', 'ty': [{ result: 'Blob' }], re: [{ result: 'o' }], to: 'c' } });
  });
  it('Blob.first / Blob.last — first of empty', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'firstEmpty', from: 'c' } }, { output: { id: '3', 'ty': [{ result: 'Blob' }], re: [{ result: '' }], to: 'c' } });
  });
  it('Blob.first / Blob.last — ref.last', async () => {
    await expectBehavior(script, { input: { id: '4', op: 'lastRef', from: 'c' } }, { output: { id: '4', 'ty': [{ result: 'Blob' }], re: [{ result: 'd' }], to: 'c' } });
  });

  it('Blob.repeat / Blob.reverse — repeat', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'repeat', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Blob' }], re: [{ result: 'ababab' }], to: 'c' } });
  });
  it('Blob.repeat / Blob.reverse — reverse', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'reverse', from: 'c' } }, { output: { id: '2', 'ty': [{ result: 'Blob' }], re: [{ result: 'cba' }], to: 'c' } });
  });
  it('Blob.repeat / Blob.reverse — ref.reverse', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'reverseRef', from: 'c' } }, { output: { id: '3', 'ty': [{ result: 'Blob' }], re: [{ result: 'zyx' }], to: 'c' } });
  });

  it('Blob.trim / trim_start / trim_end — trim', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'trim', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Blob' }], re: [{ result: 'hi' }], to: 'c' } });
  });
  it('Blob.trim / trim_start / trim_end — trim_start', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'trimStart', from: 'c' } }, { output: { id: '2', 'ty': [{ result: 'Blob' }], re: [{ result: 'hi  ' }], to: 'c' } });
  });
  it('Blob.trim / trim_start / trim_end — trim_end', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'trimEnd', from: 'c' } }, { output: { id: '3', 'ty': [{ result: 'Blob' }], re: [{ result: '  hi' }], to: 'c' } });
  });

  it('Blob.contains / starts_with / ends_with — contains match', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'containsYes', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Boolean' }], re: [{ result: true }], to: 'c' } });
  });
  it('Blob.contains / starts_with / ends_with — contains no match', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'containsNo', from: 'c' } }, { output: { id: '2', 'ty': [{ result: 'Boolean' }], re: [{ result: false }], to: 'c' } });
  });
  it('Blob.contains / starts_with / ends_with — starts_with', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'startsWith', from: 'c' } }, { output: { id: '3', 'ty': [{ result: 'Boolean' }], re: [{ result: true }], to: 'c' } });
  });
  it('Blob.contains / starts_with / ends_with — ends_with', async () => {
    await expectBehavior(script, { input: { id: '4', op: 'endsWith', from: 'c' } }, { output: { id: '4', 'ty': [{ result: 'Boolean' }], re: [{ result: true }], to: 'c' } });
  });
  it('Blob.contains / starts_with / ends_with — ref.contains', async () => {
    await expectBehavior(script, { input: { id: '5', op: 'containsRef', from: 'c' } }, { output: { id: '5', 'ty': [{ result: 'Boolean' }], re: [{ result: true }], to: 'c' } });
  });

  it('Blob.index_of — found — byte offset', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'found', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 6 }], to: 'c' } });
  });
  it('Blob.index_of — not found returns -1', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'notFound', from: 'c' } }, { output: { id: '2', 'ty': [{ result: 'Integer' }], re: [{ result: -1 }], to: 'c' } });
  });
  it('Blob.index_of — ref.index_of', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'indexRef', from: 'c' } }, { output: { id: '3', 'ty': [{ result: 'Integer' }], re: [{ result: 2 }], to: 'c' } });
  });

  it('Blob.before / Blob.after — before', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'before', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Blob' }], re: [{ result: 'hello' }], to: 'c' } });
  });
  it('Blob.before / Blob.after — after', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'after', from: 'c' } }, { output: { id: '2', 'ty': [{ result: 'Blob' }], re: [{ result: 'world' }], to: 'c' } });
  });
  it('Blob.before / Blob.after — before no match', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'beforeMiss', from: 'c' } }, { output: { id: '3', 'ty': [{ result: 'Blob' }], re: [{ result: 'hello' }], to: 'c' } });
  });
  it('Blob.before / Blob.after — after no match', async () => {
    await expectBehavior(script, { input: { id: '4', op: 'afterMiss', from: 'c' } }, { output: { id: '4', 'ty': [{ result: 'Blob' }], re: [{ result: '' }], to: 'c' } });
  });

  it('Blob.replace / Blob.replace_first — replace all', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'replaceAll', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Blob' }], re: [{ result: 'xxbxx' }], to: 'c' } });
  });
  it('Blob.replace / Blob.replace_first — replace_first', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'replaceFirst', from: 'c' } }, { output: { id: '2', 'ty': [{ result: 'Blob' }], re: [{ result: 'xabaa' }], to: 'c' } });
  });
  it('Blob.replace / Blob.replace_first — ref.replace', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'replaceRef', from: 'c' } }, { output: { id: '3', 'ty': [{ result: 'Blob' }], re: [{ result: 'herro' }], to: 'c' } });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // Blob — byte-level size differs from Text scalar size
  // ═══════════════════════════════════════════════════════════════════════════════

  it('Blob vs Text — byte vs scalar size — Blob.size e-acute = 2 bytes', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'blobSizeAccented', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 2 }], to: 'c' } });
  });
  it('Blob vs Text — byte vs scalar size — Text.size e-acute = 1 scalar', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'textSizeAccented', from: 'c' } }, { output: { id: '2', 'ty': [{ result: 'Integer' }], re: [{ result: 1 }], to: 'c' } });
  });
  it('Blob vs Text — byte vs scalar size — Blob.size emoji = 4 bytes', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'blobSizeEmoji', from: 'c' } }, { output: { id: '3', 'ty': [{ result: 'Integer' }], re: [{ result: 4 }], to: 'c' } });
  });
  it('Blob vs Text — byte vs scalar size — Text.size emoji = 1 scalar', async () => {
    await expectBehavior(script, { input: { id: '4', op: 'textSizeEmoji', from: 'c' } }, { output: { id: '4', 'ty': [{ result: 'Integer' }], re: [{ result: 1 }], to: 'c' } });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // Blob bang methods
  // ═══════════════════════════════════════════════════════════════════════════════

  it('Blob bang methods — b.reverse!', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'bangReverse', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Blob' }], re: [{ result: 'olleh' }], to: 'c' } });
  });
  it('Blob bang methods — b.slice!(0, 5)', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'bangSlice', from: 'c' } }, { output: { id: '2', 'ty': [{ result: 'Blob' }], re: [{ result: 'hello' }], to: 'c' } });
  });
  it('Blob bang methods — b.replace!("a", "x")', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'bangReplace', from: 'c' } }, { output: { id: '3', 'ty': [{ result: 'Blob' }], re: [{ result: 'xxbxx' }], to: 'c' } });
  });
  it('Blob bang methods — b.trim!', async () => {
    await expectBehavior(script, { input: { id: '4', op: 'bangTrim', from: 'c' } }, { output: { id: '4', 'ty': [{ result: 'Blob' }], re: [{ result: 'hi' }], to: 'c' } });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // Blob — regex support (byte-level, no Unicode mode)
  // ═══════════════════════════════════════════════════════════════════════════════

  it('Blob regex — pattern matching — contains with regex', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'containsRe', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Boolean' }], re: [{ result: true }], to: 'c' } });
  });
  it('Blob regex — pattern matching — contains with regex — no match', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'containsReNo', from: 'c' } }, { output: { id: '2', 'ty': [{ result: 'Boolean' }], re: [{ result: false }], to: 'c' } });
  });
  it('Blob regex — pattern matching — starts_with regex — match', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'startsRe', from: 'c' } }, { output: { id: '3', 'ty': [{ result: 'Boolean' }], re: [{ result: true }], to: 'c' } });
  });
  it('Blob regex — pattern matching — starts_with regex — no match', async () => {
    await expectBehavior(script, { input: { id: '4', op: 'startsReNo', from: 'c' } }, { output: { id: '4', 'ty': [{ result: 'Boolean' }], re: [{ result: false }], to: 'c' } });
  });
  it('Blob regex — pattern matching — ends_with regex', async () => {
    await expectBehavior(script, { input: { id: '5', op: 'endsRe', from: 'c' } }, { output: { id: '5', 'ty': [{ result: 'Boolean' }], re: [{ result: true }], to: 'c' } });
  });
  it('Blob regex — pattern matching — index_of regex — returns byte offset', async () => {
    await expectBehavior(script, { input: { id: '6', op: 'indexRe', from: 'c' } }, { output: { id: '6', 'ty': [{ result: 'Integer' }], re: [{ result: 4 }], to: 'c' } });
  });
  it('Blob regex — pattern matching — before regex', async () => {
    await expectBehavior(script, { input: { id: '7', op: 'beforeRe', from: 'c' } }, { output: { id: '7', 'ty': [{ result: 'Blob' }], re: [{ result: 'hello ' }], to: 'c' } });
  });
  it('Blob regex — pattern matching — after regex', async () => {
    await expectBehavior(script, { input: { id: '8', op: 'afterRe', from: 'c' } }, { output: { id: '8', 'ty': [{ result: 'Blob' }], re: [{ result: ' world' }], to: 'c' } });
  });
  it('Blob regex — pattern matching — replace all with regex', async () => {
    await expectBehavior(script, { input: { id: '9', op: 'replaceRe', from: 'c' } }, { output: { id: '9', 'ty': [{ result: 'Blob' }], re: [{ result: 'axbxcx' }], to: 'c' } });
  });
  it('Blob regex — pattern matching — replace_first with regex', async () => {
    await expectBehavior(script, { input: { id: '10', op: 'replaceFirstRe', from: 'c' } }, { output: { id: '10', 'ty': [{ result: 'Blob' }], re: [{ result: 'axb2c3' }], to: 'c' } });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // Blob.concat / Blob.append! / Blob.at
  // ═══════════════════════════════════════════════════════════════════════════════

  it('Blob.concat — Blob.concat(a, b)', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'concatFunc', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Blob' }], re: [{ result: 'hello world' }], to: 'c' } });
  });
  it('Blob.concat — ref.concat(b)', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'concatRef', from: 'c' } }, { output: { id: '2', 'ty': [{ result: 'Blob' }], re: [{ result: 'hello world' }], to: 'c' } });
  });

  it('Blob.append! — b.append!(v) mutates ref', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'appendBang', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Blob' }], re: [{ result: 'hello world' }], to: 'c' } });
  });

  it('Blob.at — Blob.at — returns byte as Integer', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'atFunc', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 104 }], to: 'c' } });
  });
  it('Blob.at — ref.at(1)', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'atRef', from: 'c' } }, { output: { id: '2', 'ty': [{ result: 'Integer' }], re: [{ result: 66 }], to: 'c' } });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // Blob crypto helpers
  // ═══════════════════════════════════════════════════════════════════════════════

  it('Blob.zeros — creates blob of n zero bytes', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'zeros', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 5 }], to: 'c' } });
  });

  it('Blob.from_hex / Blob.to_hex — to_hex', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'toHex', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Text' }], re: [{ result: '68656c6c6f' }], to: 'c' } });
  });
  it('Blob.from_hex / Blob.to_hex — from_hex round-trips', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'roundtrip', from: 'c' } }, { output: { id: '2', 'ty': [{ result: 'Blob' }], re: [{ result: 'hello' }], to: 'c' } });
  });

  it('Blob.from_base64 / Blob.to_base64 — to_base64', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'toB64', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Text' }], re: [{ result: 'aGVsbG8=' }], to: 'c' } });
  });
  it('Blob.from_base64 / Blob.to_base64 — from_base64', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'fromB64', from: 'c' } }, { output: { id: '2', 'ty': [{ result: 'Blob' }], re: [{ result: 'hello' }], to: 'c' } });
  });

  it('Blob.from_utf8 / Blob.to_utf8 — to_utf8 — identity for ASCII', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'toUtf8', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Text' }], re: [{ result: 'hello' }], to: 'c' } });
  });
  it('Blob.from_utf8 / Blob.to_utf8 — from_utf8 — identity for ASCII', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'fromUtf8', from: 'c' } }, { output: { id: '2', 'ty': [{ result: 'Blob' }], re: [{ result: 'hello' }], to: 'c' } });
  });

  it('Blob.xor — xor with self produces zeros', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'xorSelf', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Text' }], re: [{ result: '0000000000' }], to: 'c' } });
  });

  it('Blob.constant_time_equals — equal blobs', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'eqYes', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Boolean' }], re: [{ result: true }], to: 'c' } });
  });
  it('Blob.constant_time_equals — different blobs', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'eqNo', from: 'c' } }, { output: { id: '2', 'ty': [{ result: 'Boolean' }], re: [{ result: false }], to: 'c' } });
  });
  it('Blob.constant_time_equals — different lengths', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'eqLen', from: 'c' } }, { output: { id: '3', 'ty': [{ result: 'Boolean' }], re: [{ result: false }], to: 'c' } });
  });
});
