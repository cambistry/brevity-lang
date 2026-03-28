import { expectReply } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Variable assignment — x = literal  →  type inferred; bv-a reflects it.
// ═══════════════════════════════════════════════════════════════════════════════

describe('literal type inference — variable assignment', () => {
  const script = `
      @text = { x = "hello"; -> :x }
      @integer = { x = 42; -> :x }
      @decimal = { x = 3.14; -> :x }
      @float = { x = 1.23E+2; -> :x }
      @boolTrue = { x = true; -> :x }
      @boolFalse = { x = false; -> :x }
      @nullLit = { x = null; -> :x }
  `;

  it('string literal inferred as Text', async () => {
    await expectReply({
      script,
      receive: { id: '1', op: '@text', from: 'c' },
      reply: { id: '1', 'bv-a': { x: 'Text' }, re: { x: 'hello' }, to: 'c' },
    });
  });

  it('integer literal inferred as Integer', async () => {
    await expectReply({
      script,
      receive: { id: '2', op: '@integer', from: 'c' },
      reply: { id: '2', 'bv-a': { x: 'Integer' }, re: { x: 42 }, to: 'c' },
    });
  });

  it('decimal literal inferred as Decimal', async () => {
    await expectReply({
      script,
      receive: { id: '3', op: '@decimal', from: 'c' },
      reply: { id: '3', 'bv-a': { x: 'Decimal' }, re: { x: 3.14 }, to: 'c' },
    });
  });

  it('scientific notation literal inferred as Float', async () => {
    await expectReply({
      script,
      receive: { id: '4', op: '@float', from: 'c' },
      reply: { id: '4', 'bv-a': { x: 'Float' }, re: { x: 123 }, to: 'c' },
    });
  });

  it('true inferred as Boolean', async () => {
    await expectReply({
      script,
      receive: { id: '5', op: '@boolTrue', from: 'c' },
      reply: { id: '5', 'bv-a': { x: 'Boolean' }, re: { x: true }, to: 'c' },
    });
  });

  it('false inferred as Boolean', async () => {
    await expectReply({
      script,
      receive: { id: '6', op: '@boolFalse', from: 'c' },
      reply: { id: '6', 'bv-a': { x: 'Boolean' }, re: { x: false }, to: 'c' },
    });
  });

  it('null literal inferred as null', async () => {
    await expectReply({
      script,
      receive: { id: '7', op: '@nullLit', from: 'c' },
      reply: { id: '7', 'bv-a': { x: 'null' }, re: { x: null }, to: 'c' },
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Reply fields — -> literal  →  type inferred in positional and named returns.
// ═══════════════════════════════════════════════════════════════════════════════

describe('literal type inference — reply fields', () => {
  const script = `
      @intPos    = -> 99
      @strNamed  = -> msg: "hi"
      @boolNamed = -> ok: true
      @decNamed  = -> pi: 3.14
      @nullNamed = -> value: null
  `;

  it('integer in positional reply', async () => {
    await expectReply({
      script,
      receive: { id: '1', op: '@intPos', from: 'c' },
      reply: { id: '1', 'bv-a': ['Integer'], re: [99], to: 'c' },
    });
  });

  it('string in named reply field', async () => {
    await expectReply({
      script,
      receive: { id: '2', op: '@strNamed', from: 'c' },
      reply: { id: '2', 'bv-a': { msg: 'Text' }, re: { msg: 'hi' }, to: 'c' },
    });
  });

  it('boolean in named reply field', async () => {
    await expectReply({
      script,
      receive: { id: '3', op: '@boolNamed', from: 'c' },
      reply: { id: '3', 'bv-a': { ok: 'Boolean' }, re: { ok: true }, to: 'c' },
    });
  });

  it('decimal in named reply field', async () => {
    await expectReply({
      script,
      receive: { id: '4', op: '@decNamed', from: 'c' },
      reply: { id: '4', 'bv-a': { pi: 'Decimal' }, re: { pi: 3.14 }, to: 'c' },
    });
  });

  it('null in named reply field', async () => {
    await expectReply({
      script,
      receive: { id: '5', op: '@nullNamed', from: 'c' },
      reply: { id: '5', 'bv-a': { value: 'null' }, re: { value: null }, to: 'c' },
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Function arguments — fn(literal)  →  no type annotation needed.
// ═══════════════════════════════════════════════════════════════════════════════

describe('literal type inference — function arguments', () => {
  const script = `
      @intArg
        =
        fn = |a| a + 1
        result Integer = fn(10)
        -> :result

      @strArg
        =
        fn = |s| s
        result Text = fn("world")
        -> :result

      @boolArg
        =
        fn = |b| b
        result Boolean = fn(true)
        -> :result
  `;

  it('integer passed without annotation', async () => {
    await expectReply({
      script,
      receive: { id: '1', op: '@intArg', from: 'c' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 11 }, to: 'c' },
    });
  });

  it('string passed without annotation', async () => {
    await expectReply({
      script,
      receive: { id: '2', op: '@strArg', from: 'c' },
      reply: { id: '2', 'bv-a': { result: 'Text' }, re: { result: 'world' }, to: 'c' },
    });
  });

  it('boolean passed without annotation', async () => {
    await expectReply({
      script,
      receive: { id: '3', op: '@boolArg', from: 'c' },
      reply: { id: '3', 'bv-a': { result: 'Boolean' }, re: { result: true }, to: 'c' },
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Structure fields — Structure(key: literal)  →  no type annotation needed.
// ═══════════════════════════════════════════════════════════════════════════════

describe('literal type inference — structure fields', () => {
  const script = `
      @intField
        =
        s Structure = Structure(count: 7)
        count: Integer = s
        -> :count

      @strField
        =
        s Structure = Structure(label: "hello")
        label: Text = s
        -> :label
  `;

  it('integer field without annotation', async () => {
    await expectReply({
      script,
      receive: { id: '1', op: '@intField', from: 'c' },
      reply: { id: '1', 'bv-a': { count: 'Integer' }, re: { count: 7 }, to: 'c' },
    });
  });

  it('string field without annotation', async () => {
    await expectReply({
      script,
      receive: { id: '2', op: '@strField', from: 'c' },
      reply: { id: '2', 'bv-a': { label: 'Text' }, re: { label: 'hello' }, to: 'c' },
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Explicit annotation coexists — x Type = v still compiles.
// ═══════════════════════════════════════════════════════════════════════════════

describe('literal type inference — explicit annotation coexists', () => {
  const script = `
      @explicitInt = { x Integer = 5; -> :x }
      @explicitStr = { x Text = "hi"; -> :x }
  `;

  it('integer with explicit annotation still works', async () => {
    await expectReply({
      script,
      receive: { id: '1', op: '@explicitInt', from: 'c' },
      reply: { id: '1', 'bv-a': { x: 'Integer' }, re: { x: 5 }, to: 'c' },
    });
  });

  it('string with explicit annotation still works', async () => {
    await expectReply({
      script,
      receive: { id: '2', op: '@explicitStr', from: 'c' },
      reply: { id: '2', 'bv-a': { x: 'Text' }, re: { x: 'hi' }, to: 'c' },
    });
  });
});
