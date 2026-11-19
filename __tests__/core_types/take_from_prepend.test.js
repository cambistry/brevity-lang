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

const out = (id, type, value) => ({ output: { id, 'ty': [{ result: type }], re: [{ result: value }], to: 'c' } });
const inp = (id, op) => ({ input: { id, op, from: 'c' } });

describe('take / from / prepend — runtime', () => {
  const script = `
    // Text.take / Text.from
      @takeFunc = -> result: Text.take("hello", 3)
      @fromFunc = -> result: Text.from("hello", 2)
      @takeRef = { t *Text = "hello"; return result: t.take(3) }
      @fromRef = { t *Text = "hello"; return result: t.from(2) }
      @takeOver = -> result: Text.take("hi", 99)
      @fromOver = -> result: Text.from("hi", 99)
      @takeZero = -> result: Text.take("hello", 0)
      @fromZero = -> result: Text.from("hello", 0)
      @takeEmoji = -> result: Text.take("a\u{1F600}b", 2)
      @fromEmoji = -> result: Text.from("a\u{1F600}b", 1)

    // Text.take! / Text.from! / Text.prepend! (mutating bang forms)
      @takeBang
        =
        t *Text = "hello"
        t.take!(3)
        return result: t

      @fromBang
        =
        t *Text = "hello"
        t.from!(2)
        return result: t

      @prependBang
        =
        t *Text = "world"
        t.prepend!("hello ")
        return result: t

    // Text.prepend
      @prependFunc = -> result: Text.prepend("world", "hello ")
      @prependRef = { t *Text = "world"; return result: t.prepend("hello ") }
      @prependEmpty = -> result: Text.prepend("x", "")

    // Blob.take / Blob.from / Blob.prepend
      @takeFunc4 = -> result: Blob.take("hello", 3)
      @fromFunc4 = -> result: Blob.from("hello", 2)
      @prependFunc4 = -> result: Blob.prepend("world", "hello ")
      @takeBang4 = { b *Blob = "hello"; b.take!(3); return result: b }
      @fromBang4 = { b *Blob = "hello"; b.from!(2); return result: b }
      @prependBang4 = { b *Blob = "world"; b.prepend!("hello "); return result: b }
      @takeOver4 = -> result: Blob.take("hi", 99)
      @fromOver4 = -> result: Blob.from("hi", 99)

    // GraphemeText.take / GraphemeText.from / GraphemeText.prepend
      @takeRef5 = { g *GraphemeText = "hello"; return result: g.take(3) }
      @fromRef5 = { g *GraphemeText = "hello"; return result: g.from(2) }
      @prependRef5 = { g *GraphemeText = "world"; return result: g.prepend("hello ") }
      @takeBang5 = { g *GraphemeText = "hello"; g.take!(3); return result: g }
      @fromBang5 = { g *GraphemeText = "hello"; g.from!(2); return result: g }
      @prependBang5 = { g *GraphemeText = "world"; g.prepend!("hello "); return result: g }
      @takeOver5 = { g *GraphemeText = "hi"; return result: g.take(99) }
      @fromOver5 = { g *GraphemeText = "hi"; return result: g.from(99) }
  `;

  it('Text.take / Text.from — Text.take(s, n) — first n chars', async () => {
    await expectBehavior(script, inp('1', 'takeFunc'), out('1', 'Text', 'hel'));
  });
  it('Text.take / Text.from — Text.from(s, n) — from index n to end', async () => {
    await expectBehavior(script, inp('2', 'fromFunc'), out('2', 'Text', 'llo'));
  });
  it('Text.take / Text.from — ref.take(n)', async () => {
    await expectBehavior(script, inp('3', 'takeRef'), out('3', 'Text', 'hel'));
  });
  it('Text.take / Text.from — ref.from(n)', async () => {
    await expectBehavior(script, inp('4', 'fromRef'), out('4', 'Text', 'llo'));
  });
  it('Text.take / Text.from — take overflow clamps to whole string', async () => {
    await expectBehavior(script, inp('5', 'takeOver'), out('5', 'Text', 'hi'));
  });
  it('Text.take / Text.from — from overflow clamps to empty', async () => {
    await expectBehavior(script, inp('6', 'fromOver'), out('6', 'Text', ''));
  });
  it('Text.take / Text.from — take 0 — empty', async () => {
    await expectBehavior(script, inp('7', 'takeZero'), out('7', 'Text', ''));
  });
  it('Text.take / Text.from — from 0 — whole string', async () => {
    await expectBehavior(script, inp('8', 'fromZero'), out('8', 'Text', 'hello'));
  });
  it('Text.take / Text.from — take is scalar-aware (emoji is one unit)', async () => {
    await expectBehavior(script, inp('9', 'takeEmoji'), out('9', 'Text', 'a\u{1F600}'));
  });
  it('Text.take / Text.from — from is scalar-aware (emoji is one unit)', async () => {
    await expectBehavior(script, inp('10', 'fromEmoji'), out('10', 'Text', '\u{1F600}b'));
  });

  it('Text.take! / Text.from! / Text.prepend! (mutating bang forms) — t.take!(n) trims t to first n', async () => {
    await expectBehavior(script, inp('1', 'takeBang'), out('1', 'Text', 'hel'));
  });
  it('Text.take! / Text.from! / Text.prepend! (mutating bang forms) — t.from!(n) trims t to suffix at n', async () => {
    await expectBehavior(script, inp('2', 'fromBang'), out('2', 'Text', 'llo'));
  });
  it('Text.take! / Text.from! / Text.prepend! (mutating bang forms) — t.prepend!(s) prepends s to t', async () => {
    await expectBehavior(script, inp('3', 'prependBang'), out('3', 'Text', 'hello world'));
  });

  it('Text.prepend — Text.prepend(s, t) → t + s', async () => {
    await expectBehavior(script, inp('1', 'prependFunc'), out('1', 'Text', 'hello world'));
  });
  it('Text.prepend — ref.prepend(t)', async () => {
    await expectBehavior(script, inp('2', 'prependRef'), out('2', 'Text', 'hello world'));
  });
  it('Text.prepend — prepend with empty prefix is unchanged', async () => {
    await expectBehavior(script, inp('3', 'prependEmpty'), out('3', 'Text', 'x'));
  });

  // ─── Blob ──────────────────────────────────────────────────────────────────────

  it('Blob.take / Blob.from / Blob.prepend — Blob.take(b, n) — first n bytes', async () => {
    await expectBehavior(script, inp('1', 'takeFunc4'), out('1', 'Blob', 'hel'));
  });
  it('Blob.take / Blob.from / Blob.prepend — Blob.from(b, n) — from byte n', async () => {
    await expectBehavior(script, inp('2', 'fromFunc4'), out('2', 'Blob', 'llo'));
  });
  it('Blob.take / Blob.from / Blob.prepend — Blob.prepend(b, prefix)', async () => {
    await expectBehavior(script, inp('3', 'prependFunc4'), out('3', 'Blob', 'hello world'));
  });
  it('Blob.take / Blob.from / Blob.prepend — Blob.take! mutates ref', async () => {
    await expectBehavior(script, inp('4', 'takeBang4'), out('4', 'Blob', 'hel'));
  });
  it('Blob.take / Blob.from / Blob.prepend — Blob.from! mutates ref', async () => {
    await expectBehavior(script, inp('5', 'fromBang4'), out('5', 'Blob', 'llo'));
  });
  it('Blob.take / Blob.from / Blob.prepend — Blob.prepend! mutates ref', async () => {
    await expectBehavior(script, inp('6', 'prependBang4'), out('6', 'Blob', 'hello world'));
  });
  it('Blob.take / Blob.from / Blob.prepend — Blob.take overflow clamps', async () => {
    await expectBehavior(script, inp('7', 'takeOver4'), out('7', 'Blob', 'hi'));
  });
  it('Blob.take / Blob.from / Blob.prepend — Blob.from overflow clamps to empty', async () => {
    await expectBehavior(script, inp('8', 'fromOver4'), out('8', 'Blob', ''));
  });

  // ─── GraphemeText ──────────────────────────────────────────────────────────────

  it('GraphemeText.take / GraphemeText.from / GraphemeText.prepend — g.take(n)', async () => {
    await expectBehavior(script, inp('1', 'takeRef5'), out('1', 'GraphemeText', 'hel'));
  });
  it('GraphemeText.take / GraphemeText.from / GraphemeText.prepend — g.from(n)', async () => {
    await expectBehavior(script, inp('2', 'fromRef5'), out('2', 'GraphemeText', 'llo'));
  });
  it('GraphemeText.take / GraphemeText.from / GraphemeText.prepend — g.prepend(other)', async () => {
    await expectBehavior(script, inp('3', 'prependRef5'), out('3', 'GraphemeText', 'hello world'));
  });
  it('GraphemeText.take / GraphemeText.from / GraphemeText.prepend — g.take! mutates ref', async () => {
    await expectBehavior(script, inp('4', 'takeBang5'), out('4', 'GraphemeText', 'hel'));
  });
  it('GraphemeText.take / GraphemeText.from / GraphemeText.prepend — g.from! mutates ref', async () => {
    await expectBehavior(script, inp('5', 'fromBang5'), out('5', 'GraphemeText', 'llo'));
  });
  it('GraphemeText.take / GraphemeText.from / GraphemeText.prepend — g.prepend! mutates ref', async () => {
    await expectBehavior(script, inp('6', 'prependBang5'), out('6', 'GraphemeText', 'hello world'));
  });
  it('GraphemeText.take / GraphemeText.from / GraphemeText.prepend — GraphemeText.take overflow clamps', async () => {
    await expectBehavior(script, inp('7', 'takeOver5'), out('7', 'GraphemeText', 'hi'));
  });
  it('GraphemeText.take / GraphemeText.from / GraphemeText.prepend — GraphemeText.from overflow clamps to empty', async () => {
    await expectBehavior(script, inp('8', 'fromOver5'), out('8', 'GraphemeText', ''));
  });
});
