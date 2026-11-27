import { expectBehavior } from '../helpers.js';

describe('size — runtime', () => {
  const script = `
    // size — literals
      @ascii
        =
        return result: size("hello")

      @empty
        =
        return result: size("")

      @singleChar
        =
        return result: size("x")

      @spaces
        =
        return result: size("a b c")

    // size — constants and refs
      @fromConst
        =
        greeting Text = "hello"
        return result: size(greeting)

      @fromRef
        =
        a *Text = "hello"
        return result: size(a)

      @afterMutate
        =
        a *Text = "hi"
        a <- "goodbye"
        return result: size(a)

    // size — Text.size() form
      @dotLiteral
        =
        return result: Text.size("world")

      @dotConst
        =
        name Text = "brevity"
        return result: Text.size(name)

      @dotRef
        =
        a *Text = "ok"
        return result: Text.size(a)

    // size — BMP scalars
      @cjk
        =
        return result: size("\u{4F60}\u{597D}")

      @precomposedAccent
        =
        return result: size("\u{00E9}")

      @currencySymbol
        =
        return result: size("\u{20AC}")

    // size — supplementary plane (astral) scalars
      @singleEmoji
        =
        return result: size("\u{1F600}")

      @musicalSymbol
        =
        return result: size("\u{1D11E}")

      @mixedAsciiEmoji
        =
        return result: size("hi\u{1F600}")

    // size — combining sequences (scalar != grapheme)
      @combiningAcute
        =
        return result: size("e\u{0301}")

      @doubleCombining
        =
        return result: size("a\u{0308}\u{0301}")

      @hangulJamo
        =
        return result: size("\u{1100}\u{1161}\u{11A8}")

    // size — multi-scalar emoji sequences
      @flag
        =
        return result: size("\u{1F1FA}\u{1F1F8}")

      @familyEmoji
        =
        return result: size("\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466}")

      @skinTone
        =
        return result: size("\u{1F44B}\u{1F3FD}")

    // size — concatenation result
      @concatSize
        =
        a Text = "hello"
        b Text = " world"
        return result: size(a + b)

      @concatLiteralSize
        =
        return result: size("ab" + "cd")
  `;

  // ═══════════════════════════════════════════════════════════════════════════════
  // size — Unicode scalar value count
  // ═══════════════════════════════════════════════════════════════════════════════

  it('size — literals — ascii string', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'ascii', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 5 }], to: 'c' } });
  });

  it('size — literals — empty string', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'empty', from: 'c' } }, { output: { id: '2', 'ty': [{ result: 'Integer' }], re: [{ result: 0 }], to: 'c' } });
  });

  it('size — literals — single character', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'singleChar', from: 'c' } }, { output: { id: '3', 'ty': [{ result: 'Integer' }], re: [{ result: 1 }], to: 'c' } });
  });

  it('size — literals — string with spaces', async () => {
    await expectBehavior(script, { input: { id: '4', op: 'spaces', from: 'c' } }, { output: { id: '4', 'ty': [{ result: 'Integer' }], re: [{ result: 5 }], to: 'c' } });
  });

  it('size — constants and refs — constant', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'fromConst', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 5 }], to: 'c' } });
  });

  it('size — constants and refs — ref', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'fromRef', from: 'c' } }, { output: { id: '2', 'ty': [{ result: 'Integer' }], re: [{ result: 5 }], to: 'c' } });
  });

  it('size — constants and refs — ref after mutation', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'afterMutate', from: 'c' } }, { output: { id: '3', 'ty': [{ result: 'Integer' }], re: [{ result: 7 }], to: 'c' } });
  });

  it('size — Text.size() form — Text.size(literal)', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'dotLiteral', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 5 }], to: 'c' } });
  });

  it('size — Text.size() form — Text.size(constant)', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'dotConst', from: 'c' } }, { output: { id: '2', 'ty': [{ result: 'Integer' }], re: [{ result: 7 }], to: 'c' } });
  });

  it('size — Text.size() form — Text.size(ref)', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'dotRef', from: 'c' } }, { output: { id: '3', 'ty': [{ result: 'Integer' }], re: [{ result: 2 }], to: 'c' } });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // Unicode scalar value semantics
  //
  // size counts Unicode scalar values — code points minus surrogates.
  // This is NOT grapheme clusters (user-perceived characters) and NOT
  // UTF-16 code units (JavaScript .length).
  // ═══════════════════════════════════════════════════════════════════════════════

  it('size — BMP scalars — CJK ideographs — each is 1 scalar', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'cjk', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 2 }], to: 'c' } });
  });

  it('size — BMP scalars — precomposed e-acute (U+00E9) — 1 scalar', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'precomposedAccent', from: 'c' } }, { output: { id: '2', 'ty': [{ result: 'Integer' }], re: [{ result: 1 }], to: 'c' } });
  });

  it('size — BMP scalars — euro sign (U+20AC) — 1 scalar', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'currencySymbol', from: 'c' } }, { output: { id: '3', 'ty': [{ result: 'Integer' }], re: [{ result: 1 }], to: 'c' } });
  });

  it('size — supplementary plane (astral) scalars — single emoji (U+1F600) — 1 scalar, not 2 code units', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'singleEmoji', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 1 }], to: 'c' } });
  });

  it('size — supplementary plane (astral) scalars — musical symbol (U+1D11E) — 1 scalar', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'musicalSymbol', from: 'c' } }, { output: { id: '2', 'ty': [{ result: 'Integer' }], re: [{ result: 1 }], to: 'c' } });
  });

  it('size — supplementary plane (astral) scalars — ascii + emoji — 3 scalars', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'mixedAsciiEmoji', from: 'c' } }, { output: { id: '3', 'ty': [{ result: 'Integer' }], re: [{ result: 3 }], to: 'c' } });
  });

  it('size — combining sequences (scalar != grapheme) — e + combining acute — 2 scalars (1 grapheme)', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'combiningAcute', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 2 }], to: 'c' } });
  });

  it('size — combining sequences (scalar != grapheme) — a + diaeresis + acute — 3 scalars (1 grapheme)', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'doubleCombining', from: 'c' } }, { output: { id: '2', 'ty': [{ result: 'Integer' }], re: [{ result: 3 }], to: 'c' } });
  });

  it('size — combining sequences (scalar != grapheme) — Hangul jamo sequence — 3 scalars (1 grapheme)', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'hangulJamo', from: 'c' } }, { output: { id: '3', 'ty': [{ result: 'Integer' }], re: [{ result: 3 }], to: 'c' } });
  });

  it('size — multi-scalar emoji sequences — flag emoji (2 regional indicators) — 2 scalars', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'flag', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 2 }], to: 'c' } });
  });

  it('size — multi-scalar emoji sequences — family ZWJ sequence — 7 scalars (4 people + 3 ZWJs)', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'familyEmoji', from: 'c' } }, { output: { id: '2', 'ty': [{ result: 'Integer' }], re: [{ result: 7 }], to: 'c' } });
  });

  it('size — multi-scalar emoji sequences — waving hand + skin tone modifier — 2 scalars', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'skinTone', from: 'c' } }, { output: { id: '3', 'ty': [{ result: 'Integer' }], re: [{ result: 2 }], to: 'c' } });
  });

  it('size — concatenation result — size of concatenated constants', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'concatSize', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 11 }], to: 'c' } });
  });

  it('size — concatenation result — size of concatenated literals', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'concatLiteralSize', from: 'c' } }, { output: { id: '2', 'ty': [{ result: 'Integer' }], re: [{ result: 4 }], to: 'c' } });
  });
});
