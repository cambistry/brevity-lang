import { expectBehavior } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// take, from, prepend — index-based and head-based companions to existing
// slice/append. Defined on Text, GraphemeText, and Blob with parallel semantics:
//
//   take(s, n)    →  prefix of length n  (≡ slice(s, 0, n))
//   from(s, n)    →  suffix from index n (≡ slice(s, n))
//   prepend(s, t) →  t + s                (mirror of append: s + t)
//
// All three exist in pure form (Type.fn / *ref.method) and bang form
// (*ref.method!). Out-of-range n clamps silently to match slice.
// ═══════════════════════════════════════════════════════════════════════════════

const out = (id, type, value) => ({ output: { id, 'bv-a': { result: type }, re: { result: value }, to: 'c' } });
const inp = (id, op) => ({ input: { id, op, from: 'c' } });

describe('Text.take / Text.from', () => {
  const script = `
      @takeFunc = -> result: Text.take("hello", 3)
      @fromFunc = -> result: Text.from("hello", 2)
      @takeRef = { t *Text = "hello"; -> result: t.take(3) }
      @fromRef = { t *Text = "hello"; -> result: t.from(2) }
      @takeOver = -> result: Text.take("hi", 99)
      @fromOver = -> result: Text.from("hi", 99)
      @takeZero = -> result: Text.take("hello", 0)
      @fromZero = -> result: Text.from("hello", 0)
      @takeEmoji = -> result: Text.take("a\u{1F600}b", 2)
      @fromEmoji = -> result: Text.from("a\u{1F600}b", 1)
  `;

  it('Text.take(s, n) — first n chars', async () => {
    await expectBehavior(script, inp('1', '@takeFunc'), out('1', 'Text', 'hel'));
  });
  it('Text.from(s, n) — from index n to end', async () => {
    await expectBehavior(script, inp('2', '@fromFunc'), out('2', 'Text', 'llo'));
  });
  it('ref.take(n)', async () => {
    await expectBehavior(script, inp('3', '@takeRef'), out('3', 'Text', 'hel'));
  });
  it('ref.from(n)', async () => {
    await expectBehavior(script, inp('4', '@fromRef'), out('4', 'Text', 'llo'));
  });
  it('take overflow clamps to whole string', async () => {
    await expectBehavior(script, inp('5', '@takeOver'), out('5', 'Text', 'hi'));
  });
  it('from overflow clamps to empty', async () => {
    await expectBehavior(script, inp('6', '@fromOver'), out('6', 'Text', ''));
  });
  it('take 0 — empty', async () => {
    await expectBehavior(script, inp('7', '@takeZero'), out('7', 'Text', ''));
  });
  it('from 0 — whole string', async () => {
    await expectBehavior(script, inp('8', '@fromZero'), out('8', 'Text', 'hello'));
  });
  it('take is scalar-aware (emoji is one unit)', async () => {
    await expectBehavior(script, inp('9', '@takeEmoji'), out('9', 'Text', 'a\u{1F600}'));
  });
  it('from is scalar-aware (emoji is one unit)', async () => {
    await expectBehavior(script, inp('10', '@fromEmoji'), out('10', 'Text', '\u{1F600}b'));
  });
});

describe('Text.take! / Text.from! / Text.prepend! (mutating bang forms)', () => {
  const script = `
      @takeBang
        =
        t *Text = "hello"
        t.take!(3)
        -> result: t

      @fromBang
        =
        t *Text = "hello"
        t.from!(2)
        -> result: t

      @prependBang
        =
        t *Text = "world"
        t.prepend!("hello ")
        -> result: t
  `;

  it('t.take!(n) trims t to first n', async () => {
    await expectBehavior(script, inp('1', '@takeBang'), out('1', 'Text', 'hel'));
  });
  it('t.from!(n) trims t to suffix at n', async () => {
    await expectBehavior(script, inp('2', '@fromBang'), out('2', 'Text', 'llo'));
  });
  it('t.prepend!(s) prepends s to t', async () => {
    await expectBehavior(script, inp('3', '@prependBang'), out('3', 'Text', 'hello world'));
  });
});

describe('Text.prepend', () => {
  const script = `
      @prependFunc = -> result: Text.prepend("world", "hello ")
      @prependRef = { t *Text = "world"; -> result: t.prepend("hello ") }
      @prependEmpty = -> result: Text.prepend("x", "")
  `;

  it('Text.prepend(s, t) → t + s', async () => {
    await expectBehavior(script, inp('1', '@prependFunc'), out('1', 'Text', 'hello world'));
  });
  it('ref.prepend(t)', async () => {
    await expectBehavior(script, inp('2', '@prependRef'), out('2', 'Text', 'hello world'));
  });
  it('prepend with empty prefix is unchanged', async () => {
    await expectBehavior(script, inp('3', '@prependEmpty'), out('3', 'Text', 'x'));
  });
});

// ─── Blob ──────────────────────────────────────────────────────────────────────

describe('Blob.take / Blob.from / Blob.prepend', () => {
  const script = `
      @takeFunc = -> result: Blob.take("hello", 3)
      @fromFunc = -> result: Blob.from("hello", 2)
      @prependFunc = -> result: Blob.prepend("world", "hello ")
      @takeBang = { b *Blob = "hello"; b.take!(3); -> result: b }
      @fromBang = { b *Blob = "hello"; b.from!(2); -> result: b }
      @prependBang = { b *Blob = "world"; b.prepend!("hello "); -> result: b }
      @takeOver = -> result: Blob.take("hi", 99)
      @fromOver = -> result: Blob.from("hi", 99)
  `;

  it('Blob.take(b, n) — first n bytes', async () => {
    await expectBehavior(script, inp('1', '@takeFunc'), out('1', 'Blob', 'hel'));
  });
  it('Blob.from(b, n) — from byte n', async () => {
    await expectBehavior(script, inp('2', '@fromFunc'), out('2', 'Blob', 'llo'));
  });
  it('Blob.prepend(b, prefix)', async () => {
    await expectBehavior(script, inp('3', '@prependFunc'), out('3', 'Blob', 'hello world'));
  });
  it('Blob.take! mutates ref', async () => {
    await expectBehavior(script, inp('4', '@takeBang'), out('4', 'Blob', 'hel'));
  });
  it('Blob.from! mutates ref', async () => {
    await expectBehavior(script, inp('5', '@fromBang'), out('5', 'Blob', 'llo'));
  });
  it('Blob.prepend! mutates ref', async () => {
    await expectBehavior(script, inp('6', '@prependBang'), out('6', 'Blob', 'hello world'));
  });
  it('Blob.take overflow clamps', async () => {
    await expectBehavior(script, inp('7', '@takeOver'), out('7', 'Blob', 'hi'));
  });
  it('Blob.from overflow clamps to empty', async () => {
    await expectBehavior(script, inp('8', '@fromOver'), out('8', 'Blob', ''));
  });
});

// ─── GraphemeText ──────────────────────────────────────────────────────────────

describe('GraphemeText.take / GraphemeText.from / GraphemeText.prepend', () => {
  const script = `
      @takeRef = { g *GraphemeText = "hello"; -> result: g.take(3) }
      @fromRef = { g *GraphemeText = "hello"; -> result: g.from(2) }
      @prependRef = { g *GraphemeText = "world"; -> result: g.prepend("hello ") }
      @takeBang = { g *GraphemeText = "hello"; g.take!(3); -> result: g }
      @fromBang = { g *GraphemeText = "hello"; g.from!(2); -> result: g }
      @prependBang = { g *GraphemeText = "world"; g.prepend!("hello "); -> result: g }
      @takeOver = { g *GraphemeText = "hi"; -> result: g.take(99) }
      @fromOver = { g *GraphemeText = "hi"; -> result: g.from(99) }
  `;

  it('g.take(n)', async () => {
    await expectBehavior(script, inp('1', '@takeRef'), out('1', 'GraphemeText', 'hel'));
  });
  it('g.from(n)', async () => {
    await expectBehavior(script, inp('2', '@fromRef'), out('2', 'GraphemeText', 'llo'));
  });
  it('g.prepend(other)', async () => {
    await expectBehavior(script, inp('3', '@prependRef'), out('3', 'GraphemeText', 'hello world'));
  });
  it('g.take! mutates ref', async () => {
    await expectBehavior(script, inp('4', '@takeBang'), out('4', 'GraphemeText', 'hel'));
  });
  it('g.from! mutates ref', async () => {
    await expectBehavior(script, inp('5', '@fromBang'), out('5', 'GraphemeText', 'llo'));
  });
  it('g.prepend! mutates ref', async () => {
    await expectBehavior(script, inp('6', '@prependBang'), out('6', 'GraphemeText', 'hello world'));
  });
  it('GraphemeText.take overflow clamps', async () => {
    await expectBehavior(script, inp('7', '@takeOver'), out('7', 'GraphemeText', 'hi'));
  });
  it('GraphemeText.from overflow clamps to empty', async () => {
    await expectBehavior(script, inp('8', '@fromOver'), out('8', 'GraphemeText', ''));
  });
});
