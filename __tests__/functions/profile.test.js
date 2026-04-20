import { expectBehavior } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Reply forms
// ═══════════════════════════════════════════════════════════════════════════════

describe('reply forms', () => {
  const script = `
    @inlineParen
      =
      ->(answer: "world")

    @openBody
      =
      ->
        answer: "world"

    @multilineParen
      =
      ->(
        answer: "world"
      )
  `;

  it('->(answer: "world" as Text) — inline parens', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@inlineParen', from: 'c' } },
      { output: { id: '1', 'bv-a': { answer: 'Text' }, re: { answer: 'world' }, to: 'c' } },
    );
  });

  it('-> \\n answer: "world" as Text — open body', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@openBody', from: 'c' } },
      { output: { id: '2', 'bv-a': { answer: 'Text' }, re: { answer: 'world' }, to: 'c' } },
    );
  });

  it('->( \\n answer: "world" as Text \\n ) — multiline parens', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: '@multilineParen', from: 'c' } },
      { output: { id: '3', 'bv-a': { answer: 'Text' }, re: { answer: 'world' }, to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Multi-param forms
// ═══════════════════════════════════════════════════════════════════════════════

describe('multi-param forms', () => {
  const script = `
    @inlineComma
      =
      :a Integer
      :b Integer
      =
      c Integer = a + b
      ->(:c)

    @sameLine
      =
      :a Integer
      :b Integer
      =
      c Integer = a + b
      -> :c

    @openForm
      =
      :a Integer
      :b Integer
      =
      c Integer = a + b
      ->
        :c
  `;

  it('explicit inline with commas', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [{ a: 3, b: 4 }, '@inlineComma'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'c' } },
      { output: { id: '1', 'bv-a': { c: 'Integer' }, re: { c: 7 }, to: 'c' } },
    );
  });

  it('explicit same-line', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: [{ a: 3, b: 4 }, '@sameLine'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'c' } },
      { output: { id: '2', 'bv-a': { c: 'Integer' }, re: { c: 7 }, to: 'c' } },
    );
  });

  it('lineal form, no commas', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: [{ a: 3, b: 4 }, '@openForm'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'c' } },
      { output: { id: '3', 'bv-a': { c: 'Integer' }, re: { c: 7 }, to: 'c' } },
    );
  });
});
