import { expectBehavior } from '../helpers.js';

const out = (id, type, value) => ({ output: { id, 'ty': [{ result: type }], re: [{ result: value }], to: 'c' } });
const inp = (id, op) => ({ input: { id, op, from: 'c' } });

describe('type indexing — runtime', () => {
  const script = `
    // size — Blob vs Text
      @blobSize = () -> result: Blob.size("caf\u{00E9}")
      @textSize = () -> result: Text.size("caf\u{00E9}")

    // size — Blob vs Text with combining chars
      @blobSize2 = () -> result: Blob.size("e\u{0301}")
      @textSize2 = () -> result: Text.size("e\u{0301}")

    // index_of — Blob vs Text
      @blobIdx = () -> result: Blob.index_of("e\u{0301}x", "x")
      @textIdx = () -> result: Text.index_of("e\u{0301}x", "x")

    // slice — Blob vs Text
      @textSlice = () -> result: Text.slice("e\u{0301}xyz", 0, 1)

    // first/last — Text
      @textFirst = () -> result: Text.first("e\u{0301}x")
      @textLast = () -> result: Text.last("xe\u{0301}")

    // reverse — Text
      @textReverse = () -> result: Text.reverse("ae\u{0301}b")

    // Casting — Blob ↔ Text
      @blobToText
        =
        b Blob = "hello"
        t Text = b as Text
        return result: Text.size(t)

      @textToBlob
        =
        t Text = "hello"
        b Blob = t as Blob
        return result: Blob.size(b)

    // Regex edge cases
      @reContainsDigits = () -> result: Text.contains("abc 123 def", /\\d+/)
      @reContainsNoMatch = () -> result: Text.contains("no digits here", /\\d+/)
      @reReplaceAll = () -> result: Text.replace("abc 123 def 456", /\\d+/, "NUM")
      @reReplaceFirst = () -> result: Text.replace_first("abc 123 def 456", /\\d+/, "NUM")
      @reCaseInsensitive = () -> result: Text.contains("Hello World", /hello/i)
      @reStartsWithDigits = () -> result: Text.starts_with("123abc", /\\d+/)
      @reStartsWithNoMatch = () -> result: Text.starts_with("abc123", /\\d+/)
      @reEndsWithDigits = () -> result: Text.ends_with("abc123", /\\d+/)
      @reBeforePattern = () -> result: Text.before("price: $42.00", /\\d/)
      @reAfterPattern = () -> result: Text.after("price: $42.00", /\\$/)
      @reIndexOfPattern = () -> result: Text.index_of("abc 42 def", /\\d+/)
  `;

  // ═══════════════════════════════════════════════════════════════════════════════
  // Indexing correctness — verify Blob (byte) and Text (scalar)
  // return different values for the same input
  // ═══════════════════════════════════════════════════════════════════════════════

  it('size — Blob vs Text — Blob.size "café" = 5 bytes (é is 2 bytes)', async () => {
    await expectBehavior(script, inp('1', 'blobSize'), out('1', 'Integer', 5));
  });
  it('size — Blob vs Text — Text.size "café" = 4 scalars (precomposed é)', async () => {
    await expectBehavior(script, inp('2', 'textSize'), out('2', 'Integer', 4));
  });

  it('size — Blob vs Text with combining chars — Blob.size = 3 bytes', async () => {
    await expectBehavior(script, inp('1', 'blobSize2'), out('1', 'Integer', 3));
  });
  it('size — Blob vs Text with combining chars — Text.size = 2 scalars', async () => {
    await expectBehavior(script, inp('2', 'textSize2'), out('2', 'Integer', 2));
  });

  it('index_of — Blob vs Text — Blob.index_of = 3 (byte offset)', async () => {
    await expectBehavior(script, inp('1', 'blobIdx'), out('1', 'Integer', 3));
  });
  it('index_of — Blob vs Text — Text.index_of = 2 (scalar offset)', async () => {
    await expectBehavior(script, inp('2', 'textIdx'), out('2', 'Integer', 2));
  });

  it('slice — Blob vs Text — Text.slice(0,1) = "e" (first scalar only)', async () => {
    await expectBehavior(script, inp('1', 'textSlice'), out('1', 'Text', 'e'));
  });

  it('first/last — Text — Text.first = "e" (first scalar)', async () => {
    await expectBehavior(script, inp('1', 'textFirst'), out('1', 'Text', 'e'));
  });
  it('first/last — Text — Text.last = combining acute (U+0301)', async () => {
    await expectBehavior(script, inp('2', 'textLast'), out('2', 'Text', '\u{0301}'));
  });

  it('reverse — Text — Text.reverse — reverses scalars (breaks combining)', async () => {
    await expectBehavior(script, inp('1', 'textReverse'), out('1', 'Text', 'b\u{0301}ea'));
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // Casting — Blob ↔ Text
  // ═══════════════════════════════════════════════════════════════════════════════

  it('Casting — Blob ↔ Text — Blob → Text', async () => {
    await expectBehavior(script, inp('1', 'blobToText'), out('1', 'Integer', 5));
  });
  it('Casting — Blob ↔ Text — Text → Blob', async () => {
    await expectBehavior(script, inp('2', 'textToBlob'), out('2', 'Integer', 5));
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // Regex edge cases on Text
  // ═══════════════════════════════════════════════════════════════════════════════

  it('Regex edge cases — regex contains — digits', async () => {
    await expectBehavior(script, inp('1', 'reContainsDigits'), out('1', 'Boolean', true));
  });
  it('Regex edge cases — regex contains — no match', async () => {
    await expectBehavior(script, inp('2', 'reContainsNoMatch'), out('2', 'Boolean', false));
  });
  it('Regex edge cases — regex replace all', async () => {
    await expectBehavior(script, inp('3', 'reReplaceAll'), out('3', 'Text', 'abc NUM def NUM'));
  });
  it('Regex edge cases — regex replace first', async () => {
    await expectBehavior(script, inp('4', 'reReplaceFirst'), out('4', 'Text', 'abc NUM def 456'));
  });
  it('Regex edge cases — regex case insensitive flag', async () => {
    await expectBehavior(script, inp('5', 'reCaseInsensitive'), out('5', 'Boolean', true));
  });
  it('Regex edge cases — regex starts_with — match at start', async () => {
    await expectBehavior(script, inp('6', 'reStartsWithDigits'), out('6', 'Boolean', true));
  });
  it('Regex edge cases — regex starts_with — no match at start', async () => {
    await expectBehavior(script, inp('7', 'reStartsWithNoMatch'), out('7', 'Boolean', false));
  });
  it('Regex edge cases — regex ends_with', async () => {
    await expectBehavior(script, inp('8', 'reEndsWithDigits'), out('8', 'Boolean', true));
  });
  it('Regex edge cases — regex before pattern', async () => {
    await expectBehavior(script, inp('9', 'reBeforePattern'), out('9', 'Text', 'price: $'));
  });
  it('Regex edge cases — regex after pattern', async () => {
    await expectBehavior(script, inp('10', 'reAfterPattern'), out('10', 'Text', '42.00'));
  });
  it('Regex edge cases — regex index_of — scalar position', async () => {
    await expectBehavior(script, inp('11', 'reIndexOfPattern'), out('11', 'Integer', 4));
  });
});
