import { expectBehavior } from '../helpers.js';

const out = (id, type, value) => ({ output: { id, 'bv-a': { result: type }, re: { result: value }, to: 'c' } });
const inp = (id, op) => ({ input: { id, op, from: 'c' } });

// ═══════════════════════════════════════════════════════════════════════════════
// Indexing correctness — verify Blob (byte) and Text (scalar)
// return different values for the same input
// ═══════════════════════════════════════════════════════════════════════════════

describe('size — Blob vs Text', () => {
  const script = `
      @blobSize = -> result: Blob.size("caf\u{00E9}") as Integer
      @textSize = -> result: Text.size("caf\u{00E9}") as Integer
  `;

  it('Blob.size "café" = 5 bytes (é is 2 bytes)', async () => {
    await expectBehavior(script, inp('1', '@blobSize'), out('1', 'Integer', 5));
  });
  it('Text.size "café" = 4 scalars (precomposed é)', async () => {
    await expectBehavior(script, inp('2', '@textSize'), out('2', 'Integer', 4));
  });
});

describe('size — Blob vs Text with combining chars', () => {
  const script = `
      @blobSize = -> result: Blob.size("e\u{0301}") as Integer
      @textSize = -> result: Text.size("e\u{0301}") as Integer
  `;

  it('Blob.size = 3 bytes', async () => {
    await expectBehavior(script, inp('1', '@blobSize'), out('1', 'Integer', 3));
  });
  it('Text.size = 2 scalars', async () => {
    await expectBehavior(script, inp('2', '@textSize'), out('2', 'Integer', 2));
  });
});

describe('index_of — Blob vs Text', () => {
  const script = `
      @blobIdx = -> result: Blob.index_of("e\u{0301}x", "x") as Integer
      @textIdx = -> result: Text.index_of("e\u{0301}x", "x") as Integer
  `;

  it('Blob.index_of = 3 (byte offset)', async () => {
    await expectBehavior(script, inp('1', '@blobIdx'), out('1', 'Integer', 3));
  });
  it('Text.index_of = 2 (scalar offset)', async () => {
    await expectBehavior(script, inp('2', '@textIdx'), out('2', 'Integer', 2));
  });
});

describe('slice — Blob vs Text', () => {
  const script = `
      @textSlice = -> result: Text.slice("e\u{0301}xyz", 0, 1) as Text
  `;

  it('Text.slice(0,1) = "e" (first scalar only)', async () => {
    await expectBehavior(script, inp('1', '@textSlice'), out('1', 'Text', 'e'));
  });
});

describe('first/last — Text', () => {
  const script = `
      @textFirst = -> result: Text.first("e\u{0301}x") as Text
      @textLast = -> result: Text.last("xe\u{0301}") as Text
  `;

  it('Text.first = "e" (first scalar)', async () => {
    await expectBehavior(script, inp('1', '@textFirst'), out('1', 'Text', 'e'));
  });
  it('Text.last = combining acute (U+0301)', async () => {
    await expectBehavior(script, inp('2', '@textLast'), out('2', 'Text', '\u{0301}'));
  });
});

describe('reverse — Text', () => {
  const script = `
      @textReverse = -> result: Text.reverse("ae\u{0301}b") as Text
  `;

  it('Text.reverse — reverses scalars (breaks combining)', async () => {
    await expectBehavior(script, inp('1', '@textReverse'), out('1', 'Text', 'b\u{0301}ea'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Casting — Blob ↔ Text
// ═══════════════════════════════════════════════════════════════════════════════

describe('Casting — Blob ↔ Text', () => {
  const script = `
      @blobToText
        =
        b Blob = "hello"
        t Text = b as Text
        -> result: Text.size(t) as Integer

      @textToBlob
        =
        t Text = "hello"
        b Blob = t as Blob
        -> result: Blob.size(b) as Integer
  `;

  it('Blob → Text', async () => {
    await expectBehavior(script, inp('1', '@blobToText'), out('1', 'Integer', 5));
  });
  it('Text → Blob', async () => {
    await expectBehavior(script, inp('2', '@textToBlob'), out('2', 'Integer', 5));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Regex edge cases on Text
// ═══════════════════════════════════════════════════════════════════════════════

describe('Regex edge cases', () => {
  const script = `
      @reContainsDigits = -> result: Text.contains("abc 123 def", /\\d+/) as Boolean
      @reContainsNoMatch = -> result: Text.contains("no digits here", /\\d+/) as Boolean
      @reReplaceAll = -> result: Text.replace("abc 123 def 456", /\\d+/, "NUM") as Text
      @reReplaceFirst = -> result: Text.replace_first("abc 123 def 456", /\\d+/, "NUM") as Text
      @reCaseInsensitive = -> result: Text.contains("Hello World", /hello/i) as Boolean
      @reStartsWithDigits = -> result: Text.starts_with("123abc", /\\d+/) as Boolean
      @reStartsWithNoMatch = -> result: Text.starts_with("abc123", /\\d+/) as Boolean
      @reEndsWithDigits = -> result: Text.ends_with("abc123", /\\d+/) as Boolean
      @reBeforePattern = -> result: Text.before("price: $42.00", /\\d/) as Text
      @reAfterPattern = -> result: Text.after("price: $42.00", /\\$/) as Text
      @reIndexOfPattern = -> result: Text.index_of("abc 42 def", /\\d+/) as Integer
  `;

  it('regex contains — digits', async () => {
    await expectBehavior(script, inp('1', '@reContainsDigits'), out('1', 'Boolean', true));
  });
  it('regex contains — no match', async () => {
    await expectBehavior(script, inp('2', '@reContainsNoMatch'), out('2', 'Boolean', false));
  });
  it('regex replace all', async () => {
    await expectBehavior(script, inp('3', '@reReplaceAll'), out('3', 'Text', 'abc NUM def NUM'));
  });
  it('regex replace first', async () => {
    await expectBehavior(script, inp('4', '@reReplaceFirst'), out('4', 'Text', 'abc NUM def 456'));
  });
  it('regex case insensitive flag', async () => {
    await expectBehavior(script, inp('5', '@reCaseInsensitive'), out('5', 'Boolean', true));
  });
  it('regex starts_with — match at start', async () => {
    await expectBehavior(script, inp('6', '@reStartsWithDigits'), out('6', 'Boolean', true));
  });
  it('regex starts_with — no match at start', async () => {
    await expectBehavior(script, inp('7', '@reStartsWithNoMatch'), out('7', 'Boolean', false));
  });
  it('regex ends_with', async () => {
    await expectBehavior(script, inp('8', '@reEndsWithDigits'), out('8', 'Boolean', true));
  });
  it('regex before pattern', async () => {
    await expectBehavior(script, inp('9', '@reBeforePattern'), out('9', 'Text', 'price: $'));
  });
  it('regex after pattern', async () => {
    await expectBehavior(script, inp('10', '@reAfterPattern'), out('10', 'Text', '42.00'));
  });
  it('regex index_of — scalar position', async () => {
    await expectBehavior(script, inp('11', '@reIndexOfPattern'), out('11', 'Integer', 4));
  });
});
