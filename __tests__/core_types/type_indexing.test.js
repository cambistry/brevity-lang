import { expectBehavior } from '../helpers.js';

const out = (id, type, value) => ({ output: { id, 'bv-a': { result: type }, re: { result: value }, to: 'c' } });
const inp = (id, op) => ({ input: { id, op, from: 'c' } });

// ═══════════════════════════════════════════════════════════════════════════════
// Indexing correctness — verify Blob (byte), Text (scalar), GraphemeText
// (grapheme) return different values for the same input
// ═══════════════════════════════════════════════════════════════════════════════

describe('size — three levels on same input', () => {
  // "café" — e + combining acute: 4 graphemes, 5 scalars, 6 bytes (UTF-8)
  const script = `
      @blobSize = -> result: Blob.size("caf\u{00E9}") as Integer
      @textSize = -> result: Text.size("caf\u{00E9}") as Integer
      @gtSize = -> result: GraphemeText.size("caf\u{00E9}") as Integer
  `;

  it('Blob.size "café" = 5 bytes (é is 2 bytes)', async () => {
    await expectBehavior(script, inp('1', '@blobSize'), out('1', 'Integer', 5));
  });
  it('Text.size "café" = 4 scalars (precomposed é)', async () => {
    await expectBehavior(script, inp('2', '@textSize'), out('2', 'Integer', 4));
  });
  it('GraphemeText.size "café" = 4 graphemes', async () => {
    await expectBehavior(script, inp('3', '@gtSize'), out('3', 'Integer', 4));
  });
});

describe('size — three levels with combining chars', () => {
  // "e\u0301" — e + combining acute: 1 grapheme, 2 scalars, 3 bytes
  const script = `
      @blobSize = -> result: Blob.size("e\u{0301}") as Integer
      @textSize = -> result: Text.size("e\u{0301}") as Integer
      @gtSize = -> result: GraphemeText.size("e\u{0301}") as Integer
  `;

  it('Blob.size = 3 bytes', async () => {
    await expectBehavior(script, inp('1', '@blobSize'), out('1', 'Integer', 3));
  });
  it('Text.size = 2 scalars', async () => {
    await expectBehavior(script, inp('2', '@textSize'), out('2', 'Integer', 2));
  });
  it('GraphemeText.size = 1 grapheme', async () => {
    await expectBehavior(script, inp('3', '@gtSize'), out('3', 'Integer', 1));
  });
});

describe('index_of — three levels', () => {
  // "e\u0301x" — find "x": byte 3, scalar 2, grapheme 1
  const script = `
      @blobIdx = -> result: Blob.index_of("e\u{0301}x", "x") as Integer
      @textIdx = -> result: Text.index_of("e\u{0301}x", "x") as Integer
      @gtIdx = -> result: GraphemeText.index_of("e\u{0301}x", "x") as Integer
  `;

  it('Blob.index_of = 3 (byte offset)', async () => {
    await expectBehavior(script, inp('1', '@blobIdx'), out('1', 'Integer', 3));
  });
  it('Text.index_of = 2 (scalar offset)', async () => {
    await expectBehavior(script, inp('2', '@textIdx'), out('2', 'Integer', 2));
  });
  it('GraphemeText.index_of = 1 (grapheme offset)', async () => {
    await expectBehavior(script, inp('3', '@gtIdx'), out('3', 'Integer', 1));
  });
});

describe('slice — three levels', () => {
  // "e\u0301xyz" — slice(0, 1): first byte, first scalar, first grapheme
  const script = `
      @textSlice = -> result: Text.slice("e\u{0301}xyz", 0, 1) as Text
      @gtSlice = -> result: GraphemeText.slice("e\u{0301}xyz", 0, 1) as GraphemeText
  `;

  it('Text.slice(0,1) = "e" (first scalar only)', async () => {
    await expectBehavior(script, inp('1', '@textSlice'), out('1', 'Text', 'e'));
  });
  it('GraphemeText.slice(0,1) = "e\u0301" (full grapheme)', async () => {
    await expectBehavior(script, inp('2', '@gtSlice'), out('2', 'GraphemeText', 'e\u{0301}'));
  });
});

describe('first/last — three levels', () => {
  // "e\u0301x" — first: different per level
  const script = `
      @textFirst = -> result: Text.first("e\u{0301}x") as Text
      @gtFirst = -> result: GraphemeText.first("e\u{0301}x") as GraphemeText
      @textLast = -> result: Text.last("xe\u{0301}") as Text
      @gtLast = -> result: GraphemeText.last("xe\u{0301}") as GraphemeText
  `;

  it('Text.first = "e" (first scalar)', async () => {
    await expectBehavior(script, inp('1', '@textFirst'), out('1', 'Text', 'e'));
  });
  it('GraphemeText.first = "e\u0301" (full grapheme)', async () => {
    await expectBehavior(script, inp('2', '@gtFirst'), out('2', 'GraphemeText', 'e\u{0301}'));
  });
  it('Text.last = combining acute (U+0301)', async () => {
    await expectBehavior(script, inp('3', '@textLast'), out('3', 'Text', '\u{0301}'));
  });
  it('GraphemeText.last = "e\u0301" (full grapheme)', async () => {
    await expectBehavior(script, inp('4', '@gtLast'), out('4', 'GraphemeText', 'e\u{0301}'));
  });
});

describe('reverse — three levels', () => {
  // "ae\u0301b" — reverse behavior differs
  const script = `
      @textReverse = -> result: Text.reverse("ae\u{0301}b") as Text
      @gtReverse = -> result: GraphemeText.reverse("ae\u{0301}b") as GraphemeText
  `;

  it('Text.reverse — reverses scalars (breaks combining)', async () => {
    // "ae\u0301b" reversed as scalars: "b\u0301ea" — combining attaches to b
    await expectBehavior(script, inp('1', '@textReverse'), out('1', 'Text', 'b\u{0301}ea'));
  });
  it('GraphemeText.reverse — preserves grapheme clusters', async () => {
    // "ae\u0301b" reversed as graphemes: "be\u0301a"
    await expectBehavior(script, inp('2', '@gtReverse'), out('2', 'GraphemeText', 'be\u{0301}a'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Casting chain — Blob ↔ Text ↔ GraphemeText
// ═══════════════════════════════════════════════════════════════════════════════

describe('Casting chain', () => {
  const script = `
      @blobToTextToGT
        =
        b Blob = "hello"
        t Text = b as Text
        g GraphemeText = t as GraphemeText
        -> result: GraphemeText.size(g) as Integer

      @gtToTextToBlob
        =
        g GraphemeText = "hello"
        t Text = g as Text
        b Blob = t as Blob
        -> result: Blob.size(b) as Integer

      @roundTrip
        =
        original Text = "e\u{0301}"
        g GraphemeText = original as GraphemeText
        back Text = g as Text
        -> result: Text.size(back) as Integer
  `;

  it('Blob → Text → GraphemeText', async () => {
    await expectBehavior(script, inp('1', '@blobToTextToGT'), out('1', 'Integer', 5));
  });
  it('GraphemeText → Text → Blob', async () => {
    await expectBehavior(script, inp('2', '@gtToTextToBlob'), out('2', 'Integer', 5));
  });
  it('Text → GraphemeText → Text preserves content', async () => {
    await expectBehavior(script, inp('3', '@roundTrip'), out('3', 'Integer', 2));
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
