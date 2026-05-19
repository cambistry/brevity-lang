import { createActor, expectActorBehavior, expectBehavior } from '../helpers.js';

const out = (id, type, value) => ({ output: { id, 'bv-a': { result: type }, re: { result: value }, to: 'c' } });
const inp = (id, op) => ({ input: { id, op, from: 'c' } });

// ═══════════════════════════════════════════════════════════════════════════════
// GraphemeText — injected dependency via # form
//
// GraphemeText is NOT a built-in type. It's an external actor injected via DI.
// The actor wraps a Text and provides grapheme-indexed operations.
// Supports all Text functions except upper/lower (cast to Text for those).
//
// Usage:
//   *( "GraphemeText": (GT) # )
//   g = GT(text: "café")
//   sz Integer = g.size()
// ═══════════════════════════════════════════════════════════════════════════════

const GT_MANIFEST = `*(text Text) -> {
  size: () -> Integer
  empty?: () -> Boolean
  first: () -> Text
  last: () -> Text
  reverse: () -> Text
  repeat: (Integer) -> Text
  slice: (Integer) -> Text | (Integer, Integer) -> Text
  trim: () -> Text
  trim_start: () -> Text
  trim_end: () -> Text
  contains: (Text) -> Boolean
  starts_with: (Text) -> Boolean
  ends_with: (Text) -> Boolean
  index_of: (Text) -> Integer
  before: (Text) -> Text
  after: (Text) -> Text
  replace: (Text, Text) -> Text
  replace_first: (Text, Text) -> Text
  split: (Text) -> List
  lines: () -> List
}`;

describe('GraphemeText via DI — # class', () => {
  const source = `
    *( "GraphemeText": (GT) # )
    =

    g = GT(text: "e\u{0301}")

    @getSize = { :result Integer = g.size(); -> :result }
    @getFirst = { :result Text = g.first(); -> :result }
  `;

  it('constructs GT and calls size()', async () => {
    const actor = await createActor(source, {
      compileOptions: { remotes: { GT: GT_MANIFEST } },
      expects: [
        { output: expect.objectContaining({ op: expect.arrayContaining(['#new']), to: 'GT' }) },
      ],
    });

    await expectActorBehavior(actor,
      { input: { id: '1', re: '#<GT/1>', 'bv-a': '#<GT>', from: 'GT' } },
      { input: { id: '99', op: '@getSize', from: 'caller' } },
      { output: expect.objectContaining({ op: '@size', to: 'GT/1' }) },
      { input: { id: '2', re: { result: 1 } } },
      { output: expect.objectContaining({ id: '99', re: { result: 1 }, to: 'caller' }) },
    );
  });

  it('calls first() — full grapheme cluster', async () => {
    const actor = await createActor(source, {
      compileOptions: { remotes: { GT: GT_MANIFEST } },
      expects: [
        { output: expect.objectContaining({ op: expect.arrayContaining(['#new']), to: 'GT' }) },
      ],
    });

    await expectActorBehavior(actor,
      { input: { id: '1', re: '#<GT/1>', 'bv-a': '#<GT>', from: 'GT' } },
      { input: { id: '99', op: '@getFirst', from: 'caller' } },
      { output: expect.objectContaining({ op: '@first', to: 'GT/1' }) },
      { input: { id: '2', re: { result: 'e\u{0301}' } } },
      { output: expect.objectContaining({ id: '99', re: { result: 'e\u{0301}' }, to: 'caller' }) },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GraphemeText — concat / append! / at on refs
// ═══════════════════════════════════════════════════════════════════════════════

describe('GraphemeText concat/append!/at', () => {
  const script = `
      @concatRef = { g *GraphemeText = "hello"; -> result: g.concat(" world") }
      @appendBang
        =
        g *GraphemeText = "hello"
        g.append!(" world")
        -> result: g
      @atRef = { g *GraphemeText = "a\u{1F600}b"; -> result: g.at(1) }
  `;

  it('gt.concat(b)', async () => {
    await expectBehavior(script, inp('1', '@concatRef'), out('1', 'GraphemeText', 'hello world'));
  });
  it('gt.append!(b) mutates ref', async () => {
    await expectBehavior(script, inp('2', '@appendBang'), out('2', 'GraphemeText', 'hello world'));
  });
  it('gt.at(1) — grapheme indexed', async () => {
    await expectBehavior(script, inp('3', '@atRef'), out('3', 'Text', '\u{1F600}'));
  });
});
