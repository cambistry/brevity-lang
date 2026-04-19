import { expectBehavior } from '../helpers.js';

const out = (id, type, value) => ({ output: { id, 'bv-a': { result: type }, re: { result: value }, to: 'c' } });
const inp = (id, op) => ({ input: { id, op, from: 'c' } });

// ═══════════════════════════════════════════════════════════════════════════════
// GraphemeText — basic type, casting, grapheme-indexed size
// ═══════════════════════════════════════════════════════════════════════════════

describe('GraphemeText — declaration and casting', () => {
  const script = `
      @constGT
        =
        g GraphemeText = "hello"
        -> result: g as GraphemeText

      @refGT
        =
        g *GraphemeText = "hello"
        -> result: g as GraphemeText

      @textToGT
        =
        t Text = "hello"
        g GraphemeText = t as GraphemeText
        -> result: g as GraphemeText

      @gtToText
        =
        g GraphemeText = "hello"
        t Text = g as Text
        -> result: Text.upper(t) as Text
  `;

  it('GraphemeText constant', async () => {
    await expectBehavior(script, inp('1', '@constGT'), out('1', 'GraphemeText', 'hello'));
  });
  it('GraphemeText ref', async () => {
    await expectBehavior(script, inp('2', '@refGT'), out('2', 'GraphemeText', 'hello'));
  });
  it('Text as GraphemeText', async () => {
    await expectBehavior(script, inp('3', '@textToGT'), out('3', 'GraphemeText', 'hello'));
  });
  it('GraphemeText as Text — Unicode ops available', async () => {
    await expectBehavior(script, inp('4', '@gtToText'), out('4', 'Text', 'HELLO'));
  });
});

describe('GraphemeText — size (grapheme count)', () => {
  const script = `
      @ascii
        =
        -> result: GraphemeText.size("hello") as Integer

      @emoji
        =
        -> result: GraphemeText.size("\u{1F600}") as Integer

      @combiningAccent
        =
        -> result: GraphemeText.size("e\u{0301}") as Integer

      @flag
        =
        -> result: GraphemeText.size("\u{1F1FA}\u{1F1F8}") as Integer

      @familyEmoji
        =
        -> result: GraphemeText.size("\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466}") as Integer

      @mixed
        =
        -> result: GraphemeText.size("hi\u{1F600}") as Integer

      @refSize
        =
        g *GraphemeText = "e\u{0301}"
        -> result: g.size as Integer

      @empty
        =
        -> result: GraphemeText.size("") as Integer
  `;

  it('ascii — 1 grapheme per char', async () => {
    await expectBehavior(script, inp('1', '@ascii'), out('1', 'Integer', 5));
  });
  it('single emoji — 1 grapheme', async () => {
    await expectBehavior(script, inp('2', '@emoji'), out('2', 'Integer', 1));
  });
  it('combining accent (e + acute) — 1 grapheme, not 2', async () => {
    await expectBehavior(script, inp('3', '@combiningAccent'), out('3', 'Integer', 1));
  });
  it('flag emoji — 1 grapheme', async () => {
    await expectBehavior(script, inp('4', '@flag'), out('4', 'Integer', 1));
  });
  it('family ZWJ — 1 grapheme', async () => {
    await expectBehavior(script, inp('5', '@familyEmoji'), out('5', 'Integer', 1));
  });
  it('ascii + emoji — 3 graphemes', async () => {
    await expectBehavior(script, inp('6', '@mixed'), out('6', 'Integer', 3));
  });
  it('ref.size — grapheme count', async () => {
    await expectBehavior(script, inp('7', '@refSize'), out('7', 'Integer', 1));
  });
  it('empty — 0 graphemes', async () => {
    await expectBehavior(script, inp('8', '@empty'), out('8', 'Integer', 0));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GraphemeText — size differs from Text and Blob
// ═══════════════════════════════════════════════════════════════════════════════

describe('GraphemeText vs Text vs Blob — size comparison', () => {
  const script = `
      @gtSizeCombining
        =
        -> result: GraphemeText.size("e\u{0301}") as Integer

      @textSizeCombining
        =
        -> result: Text.size("e\u{0301}") as Integer

      @blobSizeCombining
        =
        -> result: Blob.size("e\u{0301}") as Integer
  `;

  it('GraphemeText.size combining = 1 grapheme', async () => {
    await expectBehavior(script, inp('1', '@gtSizeCombining'), out('1', 'Integer', 1));
  });
  it('Text.size combining = 2 scalars', async () => {
    await expectBehavior(script, inp('2', '@textSizeCombining'), out('2', 'Integer', 2));
  });
  it('Blob.size combining = 3 bytes', async () => {
    await expectBehavior(script, inp('3', '@blobSizeCombining'), out('3', 'Integer', 3));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GraphemeText — grapheme-indexed operations
// ═══════════════════════════════════════════════════════════════════════════════

describe('GraphemeText.first / GraphemeText.last', () => {
  const script = `
      @firstCombining
        =
        -> result: GraphemeText.first("e\u{0301}bc") as GraphemeText

      @lastCombining
        =
        -> result: GraphemeText.last("abe\u{0301}") as GraphemeText

      @firstEmpty
        =
        -> result: GraphemeText.first("") as GraphemeText

      @firstRef
        =
        g *GraphemeText = "\u{1F600}abc"
        -> result: g.first as GraphemeText
  `;

  it('first of combining — returns full grapheme cluster', async () => {
    await expectBehavior(script, inp('1', '@firstCombining'), out('1', 'GraphemeText', 'e\u{0301}'));
  });
  it('last of combining — returns full grapheme cluster', async () => {
    await expectBehavior(script, inp('2', '@lastCombining'), out('2', 'GraphemeText', 'e\u{0301}'));
  });
  it('first of empty', async () => {
    await expectBehavior(script, inp('3', '@firstEmpty'), out('3', 'GraphemeText', ''));
  });
  it('ref.first — emoji', async () => {
    await expectBehavior(script, inp('4', '@firstRef'), out('4', 'GraphemeText', '\u{1F600}'));
  });
});

describe('GraphemeText.slice', () => {
  const script = `
      @sliceCombining
        =
        -> result: GraphemeText.slice("ae\u{0301}b", 1, 2) as GraphemeText

      @sliceFrom
        =
        -> result: GraphemeText.slice("ae\u{0301}b", 1) as GraphemeText

      @sliceRef
        =
        g *GraphemeText = "\u{1F600}hello"
        -> result: g.slice(1, 3) as GraphemeText
  `;

  it('slice around combining — grapheme indexed', async () => {
    await expectBehavior(script, inp('1', '@sliceCombining'), out('1', 'GraphemeText', 'e\u{0301}'));
  });
  it('slice from index', async () => {
    await expectBehavior(script, inp('2', '@sliceFrom'), out('2', 'GraphemeText', 'e\u{0301}b'));
  });
  it('ref.slice', async () => {
    await expectBehavior(script, inp('3', '@sliceRef'), out('3', 'GraphemeText', 'he'));
  });
});

describe('GraphemeText.reverse', () => {
  const script = `
      @reverseCombining
        =
        -> result: GraphemeText.reverse("ae\u{0301}b") as GraphemeText

      @reverseRef
        =
        g *GraphemeText = "abc"
        -> result: g.reverse as GraphemeText
  `;

  it('reverse preserves combining sequences', async () => {
    await expectBehavior(script, inp('1', '@reverseCombining'), out('1', 'GraphemeText', 'be\u{0301}a'));
  });
  it('ref.reverse', async () => {
    await expectBehavior(script, inp('2', '@reverseRef'), out('2', 'GraphemeText', 'cba'));
  });
});

describe('GraphemeText.index_of', () => {
  const script = `
      @indexCombining
        =
        -> result: GraphemeText.index_of("ae\u{0301}bcd", "b") as Integer

      @indexRef
        =
        g *GraphemeText = "\u{1F600}hello"
        -> result: g.index_of("hello") as Integer
  `;

  it('index_of after combining — grapheme position', async () => {
    await expectBehavior(script, inp('1', '@indexCombining'), out('1', 'Integer', 2));
  });
  it('ref.index_of after emoji', async () => {
    await expectBehavior(script, inp('2', '@indexRef'), out('2', 'Integer', 1));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GraphemeText — content operations (delegated to Text)
// ═══════════════════════════════════════════════════════════════════════════════

describe('GraphemeText — content operations', () => {
  const script = `
      @contains = -> result: GraphemeText.contains("hello world", "world") as Boolean
      @startsWith = -> result: GraphemeText.starts_with("hello", "hel") as Boolean
      @endsWith = -> result: GraphemeText.ends_with("hello", "llo") as Boolean
      @trim = -> result: GraphemeText.trim("  hi  ") as GraphemeText
      @replace = -> result: GraphemeText.replace("aabaa", "a", "x") as GraphemeText
      @empty = -> result: GraphemeText.empty?("") as Boolean
      @repeat = -> result: GraphemeText.repeat("ab", 3) as GraphemeText
      @before = -> result: GraphemeText.before("hello-world", "-") as GraphemeText
      @after = -> result: GraphemeText.after("hello-world", "-") as GraphemeText
  `;

  it('contains', async () => {
    await expectBehavior(script, inp('1', '@contains'), out('1', 'Boolean', true));
  });
  it('starts_with', async () => {
    await expectBehavior(script, inp('2', '@startsWith'), out('2', 'Boolean', true));
  });
  it('ends_with', async () => {
    await expectBehavior(script, inp('3', '@endsWith'), out('3', 'Boolean', true));
  });
  it('trim', async () => {
    await expectBehavior(script, inp('4', '@trim'), out('4', 'GraphemeText', 'hi'));
  });
  it('replace', async () => {
    await expectBehavior(script, inp('5', '@replace'), out('5', 'GraphemeText', 'xxbxx'));
  });
  it('empty?', async () => {
    await expectBehavior(script, inp('6', '@empty'), out('6', 'Boolean', true));
  });
  it('repeat', async () => {
    await expectBehavior(script, inp('7', '@repeat'), out('7', 'GraphemeText', 'ababab'));
  });
  it('before', async () => {
    await expectBehavior(script, inp('8', '@before'), out('8', 'GraphemeText', 'hello'));
  });
  it('after', async () => {
    await expectBehavior(script, inp('9', '@after'), out('9', 'GraphemeText', 'world'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GraphemeText — bang methods
// ═══════════════════════════════════════════════════════════════════════════════

describe('GraphemeText — bang methods', () => {
  const script = `
      @bangReverse
        =
        g *GraphemeText = "ae\u{0301}b"
        g.reverse!
        -> result: g as GraphemeText

      @bangSlice
        =
        g *GraphemeText = "hello world"
        g.slice!(0, 5)
        -> result: g as GraphemeText

      @bangTrim
        =
        g *GraphemeText = "  hi  "
        g.trim!
        -> result: g as GraphemeText
  `;

  it('g.reverse! — preserves combining', async () => {
    await expectBehavior(script, inp('1', '@bangReverse'), out('1', 'GraphemeText', 'be\u{0301}a'));
  });
  it('g.slice!(0, 5)', async () => {
    await expectBehavior(script, inp('2', '@bangSlice'), out('2', 'GraphemeText', 'hello'));
  });
  it('g.trim!', async () => {
    await expectBehavior(script, inp('3', '@bangTrim'), out('3', 'GraphemeText', 'hi'));
  });
});
