import { runActor } from './helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture — Reply forms
// ═══════════════════════════════════════════════════════════════════════════════

describe('reply forms', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      @inlineParen()
        ->(answer: "world" : Text)

      @openBody()
        ->
          answer: "world" : Text

      @multilineParen()
        ->(
          answer: "world" : Text
        )
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: 'inlineParen', from: 'c' },
        { id: '2', op: 'openBody', from: 'c' },
        { id: '3', op: 'multilineParen', from: 'c' },
      ],
    });
  });

  it('->(answer: "world" : Text) — inline parens', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { answer: 'Text' }, re: { answer: 'world' }, to: 'c' });
  });

  it('-> \\n answer: "world" : Text — open body', () => {
    expect(outputs[1]).toEqual({ id: '2', 'bv-a': { answer: 'Text' }, re: { answer: 'world' }, to: 'c' });
  });

  it('->( \\n answer: "world" : Text \\n ) — multiline parens', () => {
    expect(outputs[2]).toEqual({ id: '3', 'bv-a': { answer: 'Text' }, re: { answer: 'world' }, to: 'c' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture — Multi-param forms
// ═══════════════════════════════════════════════════════════════════════════════

describe('multi-param forms', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      @inlineComma
        =
        :a : Integer
        :b : Integer
        =
        c : Integer = a + b
        ->(:c : Integer)

      @sameLine
        =
        :a : Integer
        :b : Integer
        =
        c : Integer = a + b
        -> :c : Integer

      @openForm
        =
        :a : Integer
        :b : Integer
        =
        c : Integer = a + b
        ->
          :c : Integer
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: [{ a: 3, b: 4 }, 'inlineComma'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'c' },
        { id: '2', op: [{ a: 3, b: 4 }, 'sameLine'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'c' },
        { id: '3', op: [{ a: 3, b: 4 }, 'openForm'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'c' },
      ],
    });
  });

  it('explicit inline with commas', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { c: 'Integer' }, re: { c: 7 }, to: 'c' });
  });

  it('explicit same-line', () => {
    expect(outputs[1]).toEqual({ id: '2', 'bv-a': { c: 'Integer' }, re: { c: 7 }, to: 'c' });
  });

  it('open form, no commas', () => {
    expect(outputs[2]).toEqual({ id: '3', 'bv-a': { c: 'Integer' }, re: { c: 7 }, to: 'c' });
  });
});
