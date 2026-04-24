import { expectBehavior } from '../helpers.js';

const out = (id, type, value) => ({ output: { id, 'bv-a': { result: type }, re: { result: value }, to: 'c' } });
const inp = (id, op) => ({ input: { id, op, from: 'c' } });

// ═══════════════════════════════════════════════════════════════════════════════
// Blob methods — byte-level operations
// ═══════════════════════════════════════════════════════════════════════════════

describe('Blob.empty?', () => {
  const script = `
      @emptyYes = -> result: Blob.empty?("")
      @emptyNo = -> result: Blob.empty?("x")
      @emptyRef = { b Blob! = ""; -> result: b.empty? }
  `;

  it('empty blob', async () => {
    await expectBehavior(script, inp('1', '@emptyYes'), out('1', 'Boolean', true));
  });
  it('non-empty blob', async () => {
    await expectBehavior(script, inp('2', '@emptyNo'), out('2', 'Boolean', false));
  });
  it('ref.empty?', async () => {
    await expectBehavior(script, inp('3', '@emptyRef'), out('3', 'Boolean', true));
  });
});

describe('Blob.slice', () => {
  const script = `
      @sliceFrom = -> result: Blob.slice("hello", 1)
      @sliceRange = -> result: Blob.slice("hello", 1, 3)
      @sliceRef = { b Blob! = "abcde"; -> result: b.slice(0, 2) }
  `;

  it('slice from index to end', async () => {
    await expectBehavior(script, inp('1', '@sliceFrom'), out('1', 'Blob', 'ello'));
  });
  it('slice range', async () => {
    await expectBehavior(script, inp('2', '@sliceRange'), out('2', 'Blob', 'el'));
  });
  it('ref.slice', async () => {
    await expectBehavior(script, inp('3', '@sliceRef'), out('3', 'Blob', 'ab'));
  });
});

describe('Blob.first / Blob.last', () => {
  const script = `
      @first = -> result: Blob.first("hello")
      @last = -> result: Blob.last("hello")
      @firstEmpty = -> result: Blob.first("")
      @lastRef = { b Blob! = "world"; -> result: b.last }
  `;

  it('first byte', async () => {
    await expectBehavior(script, inp('1', '@first'), out('1', 'Blob', 'h'));
  });
  it('last byte', async () => {
    await expectBehavior(script, inp('2', '@last'), out('2', 'Blob', 'o'));
  });
  it('first of empty', async () => {
    await expectBehavior(script, inp('3', '@firstEmpty'), out('3', 'Blob', ''));
  });
  it('ref.last', async () => {
    await expectBehavior(script, inp('4', '@lastRef'), out('4', 'Blob', 'd'));
  });
});

describe('Blob.repeat / Blob.reverse', () => {
  const script = `
      @repeat = -> result: Blob.repeat("ab", 3)
      @reverse = -> result: Blob.reverse("abc")
      @reverseRef = { b Blob! = "xyz"; -> result: b.reverse }
  `;

  it('repeat', async () => {
    await expectBehavior(script, inp('1', '@repeat'), out('1', 'Blob', 'ababab'));
  });
  it('reverse', async () => {
    await expectBehavior(script, inp('2', '@reverse'), out('2', 'Blob', 'cba'));
  });
  it('ref.reverse', async () => {
    await expectBehavior(script, inp('3', '@reverseRef'), out('3', 'Blob', 'zyx'));
  });
});

describe('Blob.trim / trim_start / trim_end', () => {
  const script = `
      @trim = -> result: Blob.trim("  hi  ")
      @trimStart = -> result: Blob.trim_start("  hi  ")
      @trimEnd = -> result: Blob.trim_end("  hi  ")
  `;

  it('trim', async () => {
    await expectBehavior(script, inp('1', '@trim'), out('1', 'Blob', 'hi'));
  });
  it('trim_start', async () => {
    await expectBehavior(script, inp('2', '@trimStart'), out('2', 'Blob', 'hi  '));
  });
  it('trim_end', async () => {
    await expectBehavior(script, inp('3', '@trimEnd'), out('3', 'Blob', '  hi'));
  });
});

describe('Blob.contains / starts_with / ends_with', () => {
  const script = `
      @containsYes = -> result: Blob.contains("hello world", "world")
      @containsNo = -> result: Blob.contains("hello", "xyz")
      @startsWith = -> result: Blob.starts_with("hello", "hel")
      @endsWith = -> result: Blob.ends_with("hello", "llo")
      @containsRef = { b Blob! = "foobar"; -> result: b.contains("bar") }
  `;

  it('contains match', async () => {
    await expectBehavior(script, inp('1', '@containsYes'), out('1', 'Boolean', true));
  });
  it('contains no match', async () => {
    await expectBehavior(script, inp('2', '@containsNo'), out('2', 'Boolean', false));
  });
  it('starts_with', async () => {
    await expectBehavior(script, inp('3', '@startsWith'), out('3', 'Boolean', true));
  });
  it('ends_with', async () => {
    await expectBehavior(script, inp('4', '@endsWith'), out('4', 'Boolean', true));
  });
  it('ref.contains', async () => {
    await expectBehavior(script, inp('5', '@containsRef'), out('5', 'Boolean', true));
  });
});

describe('Blob.index_of', () => {
  const script = `
      @found = -> result: Blob.index_of("hello world", "world")
      @notFound = -> result: Blob.index_of("hello", "xyz")
      @indexRef = { b Blob! = "abcde"; -> result: b.index_of("cd") }
  `;

  it('found — byte offset', async () => {
    await expectBehavior(script, inp('1', '@found'), out('1', 'Integer', 6));
  });
  it('not found returns -1', async () => {
    await expectBehavior(script, inp('2', '@notFound'), out('2', 'Integer', -1));
  });
  it('ref.index_of', async () => {
    await expectBehavior(script, inp('3', '@indexRef'), out('3', 'Integer', 2));
  });
});

describe('Blob.before / Blob.after', () => {
  const script = `
      @before = -> result: Blob.before("hello-world", "-")
      @after = -> result: Blob.after("hello-world", "-")
      @beforeMiss = -> result: Blob.before("hello", "x")
      @afterMiss = -> result: Blob.after("hello", "x")
  `;

  it('before', async () => {
    await expectBehavior(script, inp('1', '@before'), out('1', 'Blob', 'hello'));
  });
  it('after', async () => {
    await expectBehavior(script, inp('2', '@after'), out('2', 'Blob', 'world'));
  });
  it('before no match', async () => {
    await expectBehavior(script, inp('3', '@beforeMiss'), out('3', 'Blob', 'hello'));
  });
  it('after no match', async () => {
    await expectBehavior(script, inp('4', '@afterMiss'), out('4', 'Blob', ''));
  });
});

describe('Blob.replace / Blob.replace_first', () => {
  const script = `
      @replaceAll = -> result: Blob.replace("aabaa", "a", "x")
      @replaceFirst = -> result: Blob.replace_first("aabaa", "a", "x")
      @replaceRef = { b Blob! = "hello"; -> result: b.replace("l", "r") }
  `;

  it('replace all', async () => {
    await expectBehavior(script, inp('1', '@replaceAll'), out('1', 'Blob', 'xxbxx'));
  });
  it('replace_first', async () => {
    await expectBehavior(script, inp('2', '@replaceFirst'), out('2', 'Blob', 'xabaa'));
  });
  it('ref.replace', async () => {
    await expectBehavior(script, inp('3', '@replaceRef'), out('3', 'Blob', 'herro'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Blob — byte-level size differs from Text scalar size
// ═══════════════════════════════════════════════════════════════════════════════

describe('Blob vs Text — byte vs scalar size', () => {
  const script = `
      @blobSizeAccented
        =
        -> result: Blob.size("\u{00E9}")

      @textSizeAccented
        =
        -> result: Text.size("\u{00E9}")

      @blobSizeEmoji
        =
        -> result: Blob.size("\u{1F600}")

      @textSizeEmoji
        =
        -> result: size("\u{1F600}")
  `;

  it('Blob.size e-acute = 2 bytes', async () => {
    await expectBehavior(script, inp('1', '@blobSizeAccented'), out('1', 'Integer', 2));
  });
  it('Text.size e-acute = 1 scalar', async () => {
    await expectBehavior(script, inp('2', '@textSizeAccented'), out('2', 'Integer', 1));
  });
  it('Blob.size emoji = 4 bytes', async () => {
    await expectBehavior(script, inp('3', '@blobSizeEmoji'), out('3', 'Integer', 4));
  });
  it('Text.size emoji = 1 scalar', async () => {
    await expectBehavior(script, inp('4', '@textSizeEmoji'), out('4', 'Integer', 1));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Blob bang methods
// ═══════════════════════════════════════════════════════════════════════════════

describe('Blob bang methods', () => {
  const script = `
      @bangReverse
        =
        b Blob! = "hello"
        b.reverse!
        -> result: b

      @bangSlice
        =
        b Blob! = "hello world"
        b.slice!(0, 5)
        -> result: b

      @bangReplace
        =
        b Blob! = "aabaa"
        b.replace!("a", "x")
        -> result: b

      @bangTrim
        =
        b Blob! = "  hi  "
        b.trim!
        -> result: b
  `;

  it('b.reverse!', async () => {
    await expectBehavior(script, inp('1', '@bangReverse'), out('1', 'Blob', 'olleh'));
  });
  it('b.slice!(0, 5)', async () => {
    await expectBehavior(script, inp('2', '@bangSlice'), out('2', 'Blob', 'hello'));
  });
  it('b.replace!("a", "x")', async () => {
    await expectBehavior(script, inp('3', '@bangReplace'), out('3', 'Blob', 'xxbxx'));
  });
  it('b.trim!', async () => {
    await expectBehavior(script, inp('4', '@bangTrim'), out('4', 'Blob', 'hi'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Blob — regex support (byte-level, no Unicode mode)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Blob regex — pattern matching', () => {
  const script = `
      @containsRe = -> result: Blob.contains("hello 123 world", /\\d+/)
      @containsReNo = -> result: Blob.contains("hello world", /\\d+/)
      @startsRe = -> result: Blob.starts_with("123abc", /\\d+/)
      @startsReNo = -> result: Blob.starts_with("abc123", /\\d+/)
      @endsRe = -> result: Blob.ends_with("abc123", /\\d+/)
      @indexRe = -> result: Blob.index_of("abc 42 def", /\\d+/)
      @beforeRe = -> result: Blob.before("hello 42 world", /\\d+/)
      @afterRe = -> result: Blob.after("hello 42 world", /\\d+/)
      @replaceRe = -> result: Blob.replace("a1b2c3", /\\d/, "x")
      @replaceFirstRe = -> result: Blob.replace_first("a1b2c3", /\\d/, "x")
  `;

  it('contains with regex', async () => {
    await expectBehavior(script, inp('1', '@containsRe'), out('1', 'Boolean', true));
  });
  it('contains with regex — no match', async () => {
    await expectBehavior(script, inp('2', '@containsReNo'), out('2', 'Boolean', false));
  });
  it('starts_with regex — match', async () => {
    await expectBehavior(script, inp('3', '@startsRe'), out('3', 'Boolean', true));
  });
  it('starts_with regex — no match', async () => {
    await expectBehavior(script, inp('4', '@startsReNo'), out('4', 'Boolean', false));
  });
  it('ends_with regex', async () => {
    await expectBehavior(script, inp('5', '@endsRe'), out('5', 'Boolean', true));
  });
  it('index_of regex — returns byte offset', async () => {
    await expectBehavior(script, inp('6', '@indexRe'), out('6', 'Integer', 4));
  });
  it('before regex', async () => {
    await expectBehavior(script, inp('7', '@beforeRe'), out('7', 'Blob', 'hello '));
  });
  it('after regex', async () => {
    await expectBehavior(script, inp('8', '@afterRe'), out('8', 'Blob', ' world'));
  });
  it('replace all with regex', async () => {
    await expectBehavior(script, inp('9', '@replaceRe'), out('9', 'Blob', 'axbxcx'));
  });
  it('replace_first with regex', async () => {
    await expectBehavior(script, inp('10', '@replaceFirstRe'), out('10', 'Blob', 'axb2c3'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Blob.concat / Blob.append! / Blob.at
// ═══════════════════════════════════════════════════════════════════════════════

describe('Blob.concat', () => {
  const script = `
      @concatFunc = -> result: Blob.concat("hello", " world")
      @concatRef = { b Blob! = "hello"; -> result: b.concat(" world") }
  `;

  it('Blob.concat(a, b)', async () => {
    await expectBehavior(script, inp('1', '@concatFunc'), out('1', 'Blob', 'hello world'));
  });
  it('ref.concat(b)', async () => {
    await expectBehavior(script, inp('2', '@concatRef'), out('2', 'Blob', 'hello world'));
  });
});

describe('Blob.append!', () => {
  const script = `
      @appendBang
        =
        b Blob! = "hello"
        b.append!(" world")
        -> result: b
  `;

  it('b.append!(v) mutates ref', async () => {
    await expectBehavior(script, inp('1', '@appendBang'), out('1', 'Blob', 'hello world'));
  });
});

describe('Blob.at', () => {
  const script = `
      @atFunc = -> result: Blob.at("hello", 0)
      @atRef = { b Blob! = "ABC"; -> result: b.at(1) }
  `;

  it('Blob.at — returns byte as Integer', async () => {
    await expectBehavior(script, inp('1', '@atFunc'), out('1', 'Integer', 104));
  });
  it('ref.at(1)', async () => {
    await expectBehavior(script, inp('2', '@atRef'), out('2', 'Integer', 66));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Blob crypto helpers
// ═══════════════════════════════════════════════════════════════════════════════

describe('Blob.zeros', () => {
  const script = `
      @zeros = -> result: Blob.size(Blob.zeros(5))
  `;

  it('creates blob of n zero bytes', async () => {
    await expectBehavior(script, inp('1', '@zeros'), out('1', 'Integer', 5));
  });
});

describe('Blob.from_hex / Blob.to_hex', () => {
  const script = `
      @toHex = -> result: Blob.to_hex("hello")
      @roundtrip = -> result: Blob.from_hex("68656c6c6f")
  `;

  it('to_hex', async () => {
    await expectBehavior(script, inp('1', '@toHex'), out('1', 'Text', '68656c6c6f'));
  });
  it('from_hex round-trips', async () => {
    await expectBehavior(script, inp('2', '@roundtrip'), out('2', 'Blob', 'hello'));
  });
});

describe('Blob.from_base64 / Blob.to_base64', () => {
  const script = `
      @toB64 = -> result: Blob.to_base64("hello")
      @fromB64 = -> result: Blob.from_base64("aGVsbG8=")
  `;

  it('to_base64', async () => {
    await expectBehavior(script, inp('1', '@toB64'), out('1', 'Text', 'aGVsbG8='));
  });
  it('from_base64', async () => {
    await expectBehavior(script, inp('2', '@fromB64'), out('2', 'Blob', 'hello'));
  });
});

describe('Blob.from_utf8 / Blob.to_utf8', () => {
  const script = `
      @toUtf8 = -> result: Blob.to_utf8("hello")
      @fromUtf8 = -> result: Blob.from_utf8("hello")
  `;

  it('to_utf8 — identity for ASCII', async () => {
    await expectBehavior(script, inp('1', '@toUtf8'), out('1', 'Text', 'hello'));
  });
  it('from_utf8 — identity for ASCII', async () => {
    await expectBehavior(script, inp('2', '@fromUtf8'), out('2', 'Blob', 'hello'));
  });
});

describe('Blob.xor', () => {
  const script = `
      @xorSelf = -> result: Blob.to_hex(Blob.xor("hello", "hello"))
  `;

  it('xor with self produces zeros', async () => {
    await expectBehavior(script, inp('1', '@xorSelf'), out('1', 'Text', '0000000000'));
  });
});

describe('Blob.constant_time_equals', () => {
  const script = `
      @eqYes = -> result: Blob.constant_time_equals("hello", "hello")
      @eqNo = -> result: Blob.constant_time_equals("hello", "world")
      @eqLen = -> result: Blob.constant_time_equals("hi", "hello")
  `;

  it('equal blobs', async () => {
    await expectBehavior(script, inp('1', '@eqYes'), out('1', 'Boolean', true));
  });
  it('different blobs', async () => {
    await expectBehavior(script, inp('2', '@eqNo'), out('2', 'Boolean', false));
  });
  it('different lengths', async () => {
    await expectBehavior(script, inp('3', '@eqLen'), out('3', 'Boolean', false));
  });
});
