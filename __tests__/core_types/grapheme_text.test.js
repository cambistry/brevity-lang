import { createActor, expectActorBehavior, expectBehavior } from '../helpers.js';

const out = (id, type, value) => ({ output: { id, 'ty': [{ result: type }], re: [{ result: value }], to: 'c' } });
const inp = (id, op) => ({ input: { id, op, from: 'c' } });

// ═══════════════════════════════════════════════════════════════════════════════
// GraphemeText — an injected dependency
//
// GraphemeText is NOT a built-in type. It's an external actor injected via DI.
// The actor wraps a Text and provides grapheme-indexed operations.
// Supports all Text functions except upper/lower (cast to Text for those).
//
// Usage:
//   use GT = "GraphemeText"
//   g = GT(text: "café")
//   sz Integer = g.size()
// ═══════════════════════════════════════════════════════════════════════════════

const GT_MANIFEST = {
  public: { $new: [{ args: [{ text: 'Text' }], re: [':*'], writes: false }] },
  ':*': {
    public: {
      size: [{ re: [{ result: 'Integer' }], writes: false }],
      'empty?': [{ re: ['Boolean'], writes: false }],
      first: [{ re: [{ result: 'Text' }], writes: false }],
      last: [{ re: ['Text'], writes: false }],
      reverse: [{ re: ['Text'], writes: false }],
      repeat: [{ args: ['Integer'], re: ['Text'], writes: false }],
      slice: [
        { args: ['Integer'], re: ['Text'], writes: false },
        { args: ['Integer', 'Integer'], re: ['Text'], writes: false },
      ],
      trim: [{ re: ['Text'], writes: false }],
      trim_start: [{ re: ['Text'], writes: false }],
      trim_end: [{ re: ['Text'], writes: false }],
      contains: [{ args: ['Text'], re: ['Boolean'], writes: false }],
      starts_with: [{ args: ['Text'], re: ['Boolean'], writes: false }],
      ends_with: [{ args: ['Text'], re: ['Boolean'], writes: false }],
      index_of: [{ args: ['Text'], re: ['Integer'], writes: false }],
      before: [{ args: ['Text'], re: ['Text'], writes: false }],
      after: [{ args: ['Text'], re: ['Text'], writes: false }],
      replace: [{ args: ['Text', 'Text'], re: ['Text'], writes: false }],
      replace_first: [{ args: ['Text', 'Text'], re: ['Text'], writes: false }],
      split: [{ args: ['Text'], re: [[['Anything'], { '%t': 'List' }]], writes: false }],
      lines: [{ re: [[['Anything'], { '%t': 'List' }]], writes: false }],
    },
  },
};

describe('GraphemeText via DI — a constructor document', () => {
  const source = `
    use GT = "GraphemeText"

    g = GT(text: "e\u{0301}")

    @getSize = { :result Integer = g.size(); return :result }
    @getFirst = { :result Text = g.first(); return :result }
  `;

  it('constructs GT and calls size()', async () => {
    const actor = await createActor(source, {
      compileOptions: { remotes: { GT: GT_MANIFEST } },
      expects: [
        { output: expect.objectContaining({ op: expect.arrayContaining(['$new']), to: 'GraphemeText' }) },
      ],
    });

    await expectActorBehavior(actor,
      { input: { id: '1', re: ['#<GT/1>'], 'ty': ['GraphemeText'], from: 'GraphemeText' } },
      { input: { id: '99', op: 'getSize', from: 'caller' } },
      { output: expect.objectContaining({ op: 'size', to: 'GT/1' }) },
      { input: { id: '2', re: [{ result: 1 }] } },
      { output: expect.objectContaining({ id: '99', re: [{ result: 1 }], to: 'caller' }) },
    );
  });

  it('calls first() — full grapheme cluster', async () => {
    const actor = await createActor(source, {
      compileOptions: { remotes: { GT: GT_MANIFEST } },
      expects: [
        { output: expect.objectContaining({ op: expect.arrayContaining(['$new']), to: 'GraphemeText' }) },
      ],
    });

    await expectActorBehavior(actor,
      { input: { id: '1', re: ['#<GT/1>'], 'ty': ['GraphemeText'], from: 'GraphemeText' } },
      { input: { id: '99', op: 'getFirst', from: 'caller' } },
      { output: expect.objectContaining({ op: 'first', to: 'GT/1' }) },
      { input: { id: '2', re: [{ result: 'e\u{0301}' }] } },
      { output: expect.objectContaining({ id: '99', re: [{ result: 'e\u{0301}' }], to: 'caller' }) },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GraphemeText — concat / append! / at on refs
// ═══════════════════════════════════════════════════════════════════════════════

describe('GraphemeText concat/append!/at', () => {
  const script = `
      @concatRef = { g *GraphemeText = "hello"; return result: g.concat(" world") }
      @appendBang
        =
        g *GraphemeText = "hello"
        g.append!(" world")
        return result: g
      @atRef = { g *GraphemeText = "a\u{1F600}b"; return result: g.at(1) }
  `;

  it('gt.concat(b)', async () => {
    await expectBehavior(script, inp('1', 'concatRef'), out('1', 'GraphemeText', 'hello world'));
  });
  it('gt.append!(b) mutates ref', async () => {
    await expectBehavior(script, inp('2', 'appendBang'), out('2', 'GraphemeText', 'hello world'));
  });
  it('gt.at(1) — grapheme indexed', async () => {
    await expectBehavior(script, inp('3', 'atRef'), out('3', 'Text', '\u{1F600}'));
  });
});
