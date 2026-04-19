import { expectBehavior } from '../helpers.js';

const out = (id, type, value) => ({ output: { id, 'bv-a': { result: type }, re: { result: value }, to: 'c' } });
const inp = (id, op) => ({ input: { id, op, from: 'c' } });

// ═══════════════════════════════════════════════════════════════════════════════
// Blob methods — byte-level operations
// ═══════════════════════════════════════════════════════════════════════════════

describe('Blob.empty?', () => {
  const script = `
      @emptyYes = -> result: Blob.empty?("") as Boolean
      @emptyNo = -> result: Blob.empty?("x") as Boolean
      @emptyRef = { b *Blob = ""; -> result: b.empty? as Boolean }
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
      @sliceFrom = -> result: Blob.slice("hello", 1) as Blob
      @sliceRange = -> result: Blob.slice("hello", 1, 3) as Blob
      @sliceRef = { b *Blob = "abcde"; -> result: b.slice(0, 2) as Blob }
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
      @first = -> result: Blob.first("hello") as Blob
      @last = -> result: Blob.last("hello") as Blob
      @firstEmpty = -> result: Blob.first("") as Blob
      @lastRef = { b *Blob = "world"; -> result: b.last as Blob }
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
      @repeat = -> result: Blob.repeat("ab", 3) as Blob
      @reverse = -> result: Blob.reverse("abc") as Blob
      @reverseRef = { b *Blob = "xyz"; -> result: b.reverse as Blob }
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
      @trim = -> result: Blob.trim("  hi  ") as Blob
      @trimStart = -> result: Blob.trim_start("  hi  ") as Blob
      @trimEnd = -> result: Blob.trim_end("  hi  ") as Blob
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
      @containsYes = -> result: Blob.contains("hello world", "world") as Boolean
      @containsNo = -> result: Blob.contains("hello", "xyz") as Boolean
      @startsWith = -> result: Blob.starts_with("hello", "hel") as Boolean
      @endsWith = -> result: Blob.ends_with("hello", "llo") as Boolean
      @containsRef = { b *Blob = "foobar"; -> result: b.contains("bar") as Boolean }
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
      @found = -> result: Blob.index_of("hello world", "world") as Integer
      @notFound = -> result: Blob.index_of("hello", "xyz") as Integer
      @indexRef = { b *Blob = "abcde"; -> result: b.index_of("cd") as Integer }
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
      @before = -> result: Blob.before("hello-world", "-") as Blob
      @after = -> result: Blob.after("hello-world", "-") as Blob
      @beforeMiss = -> result: Blob.before("hello", "x") as Blob
      @afterMiss = -> result: Blob.after("hello", "x") as Blob
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
      @replaceAll = -> result: Blob.replace("aabaa", "a", "x") as Blob
      @replaceFirst = -> result: Blob.replace_first("aabaa", "a", "x") as Blob
      @replaceRef = { b *Blob = "hello"; -> result: b.replace("l", "r") as Blob }
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
        -> result: Blob.size("\u{00E9}") as Integer

      @textSizeAccented
        =
        -> result: Text.size("\u{00E9}") as Integer

      @blobSizeEmoji
        =
        -> result: Blob.size("\u{1F600}") as Integer

      @textSizeEmoji
        =
        -> result: size("\u{1F600}") as Integer
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
        b *Blob = "hello"
        b.reverse!
        -> result: b as Blob

      @bangSlice
        =
        b *Blob = "hello world"
        b.slice!(0, 5)
        -> result: b as Blob

      @bangReplace
        =
        b *Blob = "aabaa"
        b.replace!("a", "x")
        -> result: b as Blob

      @bangTrim
        =
        b *Blob = "  hi  "
        b.trim!
        -> result: b as Blob
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
