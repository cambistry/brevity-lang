import { expectBehavior } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// size — Unicode scalar value count
// ═══════════════════════════════════════════════════════════════════════════════

describe('size — literals', () => {
  const script = `
      @ascii
        =
        -> result: size("hello")

      @empty
        =
        -> result: size("")

      @singleChar
        =
        -> result: size("x")

      @spaces
        =
        -> result: size("a b c")
  `;

  it('ascii string', async () => {
    await expectBehavior(script, { input: { id: '1', op: '@ascii', from: 'c' } }, { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 5 }, to: 'c' } });
  });

  it('empty string', async () => {
    await expectBehavior(script, { input: { id: '2', op: '@empty', from: 'c' } }, { output: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 0 }, to: 'c' } });
  });

  it('single character', async () => {
    await expectBehavior(script, { input: { id: '3', op: '@singleChar', from: 'c' } }, { output: { id: '3', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' } });
  });

  it('string with spaces', async () => {
    await expectBehavior(script, { input: { id: '4', op: '@spaces', from: 'c' } }, { output: { id: '4', 'bv-a': { result: 'Integer' }, re: { result: 5 }, to: 'c' } });
  });
});

describe('size — constants and refs', () => {
  const script = `
      @fromConst
        =
        greeting Text = "hello"
        -> result: size(greeting)

      @fromRef
        =
        a *Text = "hello"
        -> result: size(a)

      @afterMutate
        =
        a *Text = "hi"
        a <- "goodbye"
        -> result: size(a)
  `;

  it('constant', async () => {
    await expectBehavior(script, { input: { id: '1', op: '@fromConst', from: 'c' } }, { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 5 }, to: 'c' } });
  });

  it('ref', async () => {
    await expectBehavior(script, { input: { id: '2', op: '@fromRef', from: 'c' } }, { output: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 5 }, to: 'c' } });
  });

  it('ref after mutation', async () => {
    await expectBehavior(script, { input: { id: '3', op: '@afterMutate', from: 'c' } }, { output: { id: '3', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'c' } });
  });
});

describe('size — Text.size() form', () => {
  const script = `
      @dotLiteral
        =
        -> result: Text.size("world")

      @dotConst
        =
        name Text = "brevity"
        -> result: Text.size(name)

      @dotRef
        =
        a *Text = "ok"
        -> result: Text.size(a)
  `;

  it('Text.size(literal)', async () => {
    await expectBehavior(script, { input: { id: '1', op: '@dotLiteral', from: 'c' } }, { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 5 }, to: 'c' } });
  });

  it('Text.size(constant)', async () => {
    await expectBehavior(script, { input: { id: '2', op: '@dotConst', from: 'c' } }, { output: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'c' } });
  });

  it('Text.size(ref)', async () => {
    await expectBehavior(script, { input: { id: '3', op: '@dotRef', from: 'c' } }, { output: { id: '3', 'bv-a': { result: 'Integer' }, re: { result: 2 }, to: 'c' } });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Unicode scalar value semantics
//
// size counts Unicode scalar values — code points minus surrogates.
// This is NOT grapheme clusters (user-perceived characters) and NOT
// UTF-16 code units (JavaScript .length).
// ═══════════════════════════════════════════════════════════════════════════════

describe('size — BMP scalars', () => {
  const script = `
      @cjk
        =
        -> result: size("\u{4F60}\u{597D}")

      @precomposedAccent
        =
        -> result: size("\u{00E9}")

      @currencySymbol
        =
        -> result: size("\u{20AC}")
  `;

  it('CJK ideographs — each is 1 scalar', async () => {
    await expectBehavior(script, { input: { id: '1', op: '@cjk', from: 'c' } }, { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 2 }, to: 'c' } });
  });

  it('precomposed e-acute (U+00E9) — 1 scalar', async () => {
    await expectBehavior(script, { input: { id: '2', op: '@precomposedAccent', from: 'c' } }, { output: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' } });
  });

  it('euro sign (U+20AC) — 1 scalar', async () => {
    await expectBehavior(script, { input: { id: '3', op: '@currencySymbol', from: 'c' } }, { output: { id: '3', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' } });
  });
});

describe('size — supplementary plane (astral) scalars', () => {
  const script = `
      @singleEmoji
        =
        -> result: size("\u{1F600}")

      @musicalSymbol
        =
        -> result: size("\u{1D11E}")

      @mixedAsciiEmoji
        =
        -> result: size("hi\u{1F600}")
  `;

  it('single emoji (U+1F600) — 1 scalar, not 2 code units', async () => {
    await expectBehavior(script, { input: { id: '1', op: '@singleEmoji', from: 'c' } }, { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' } });
  });

  it('musical symbol (U+1D11E) — 1 scalar', async () => {
    await expectBehavior(script, { input: { id: '2', op: '@musicalSymbol', from: 'c' } }, { output: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' } });
  });

  it('ascii + emoji — 3 scalars', async () => {
    await expectBehavior(script, { input: { id: '3', op: '@mixedAsciiEmoji', from: 'c' } }, { output: { id: '3', 'bv-a': { result: 'Integer' }, re: { result: 3 }, to: 'c' } });
  });
});

describe('size — combining sequences (scalar != grapheme)', () => {
  const script = `
      @combiningAcute
        =
        -> result: size("e\u{0301}")

      @doubleCombining
        =
        -> result: size("a\u{0308}\u{0301}")

      @hangulJamo
        =
        -> result: size("\u{1100}\u{1161}\u{11A8}")
  `;

  it('e + combining acute — 2 scalars (1 grapheme)', async () => {
    await expectBehavior(script, { input: { id: '1', op: '@combiningAcute', from: 'c' } }, { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 2 }, to: 'c' } });
  });

  it('a + diaeresis + acute — 3 scalars (1 grapheme)', async () => {
    await expectBehavior(script, { input: { id: '2', op: '@doubleCombining', from: 'c' } }, { output: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 3 }, to: 'c' } });
  });

  it('Hangul jamo sequence — 3 scalars (1 grapheme)', async () => {
    await expectBehavior(script, { input: { id: '3', op: '@hangulJamo', from: 'c' } }, { output: { id: '3', 'bv-a': { result: 'Integer' }, re: { result: 3 }, to: 'c' } });
  });
});

describe('size — multi-scalar emoji sequences', () => {
  const script = `
      @flag
        =
        -> result: size("\u{1F1FA}\u{1F1F8}")

      @familyEmoji
        =
        -> result: size("\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466}")

      @skinTone
        =
        -> result: size("\u{1F44B}\u{1F3FD}")
  `;

  it('flag emoji (2 regional indicators) — 2 scalars', async () => {
    await expectBehavior(script, { input: { id: '1', op: '@flag', from: 'c' } }, { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 2 }, to: 'c' } });
  });

  it('family ZWJ sequence — 7 scalars (4 people + 3 ZWJs)', async () => {
    await expectBehavior(script, { input: { id: '2', op: '@familyEmoji', from: 'c' } }, { output: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'c' } });
  });

  it('waving hand + skin tone modifier — 2 scalars', async () => {
    await expectBehavior(script, { input: { id: '3', op: '@skinTone', from: 'c' } }, { output: { id: '3', 'bv-a': { result: 'Integer' }, re: { result: 2 }, to: 'c' } });
  });
});

describe('size — concatenation result', () => {
  const script = `
      @concatSize
        =
        a Text = "hello"
        b Text = " world"
        -> result: size(a + b)

      @concatLiteralSize
        =
        -> result: size("ab" + "cd")
  `;

  it('size of concatenated constants', async () => {
    await expectBehavior(script, { input: { id: '1', op: '@concatSize', from: 'c' } }, { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 11 }, to: 'c' } });
  });

  it('size of concatenated literals', async () => {
    await expectBehavior(script, { input: { id: '2', op: '@concatLiteralSize', from: 'c' } }, { output: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 4 }, to: 'c' } });
  });
});
