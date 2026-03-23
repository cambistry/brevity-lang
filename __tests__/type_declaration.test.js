import compile from '../index.js';
import { expectReply } from './helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Declarations and typed RHS
// ═══════════════════════════════════════════════════════════════════════════════

describe('type declarations + typed RHS', () => {
  const script = `
      @declThenUse
        =
        x : Integer
        x = 1 as Integer
        -> result: x

      @typedInt = { x = 1 as Integer; -> result: x }
      @typedText = { x = "hello" as Text; -> result: x }

      @typedExpr
        =
        :a : Integer
        :b : Integer
        =
        x = (a + b) as Integer
        -> result: x

      @bothSides = { x : Integer = 2 : Integer; -> result: x }
      @hoisting = {
        x = 1 as Integer
        x : Integer
        -> result: x
      }
      @tripleDecl = {
        x : Integer
        x : Integer = 5 : Integer
        -> result: x
      }
  `;

  it('x : Integer before assignment — decl then use', async () => {
    await expectReply({
      script, receive: { id: '1', op: '@declThenUse', from: 'c' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' },
    });
  });

  it('x = 1 as Integer — typed RHS', async () => {
    await expectReply({
      script, receive: { id: '2', op: '@typedInt', from: 'c' },
      reply: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' },
    });
  });

  it('x = "hello" as Text — typed RHS string', async () => {
    await expectReply({
      script, receive: { id: '3', op: '@typedText', from: 'c' },
      reply: { id: '3', 'bv-a': { result: 'Text' }, re: { result: 'hello' }, to: 'c' },
    });
  });

  it('x = (a + b) as Integer — typed RHS expression', async () => {
    await expectReply({
      script, receive: { id: '4', op: [{ a: 3, b: 4 }, '@typedExpr'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'c' },
      reply: { id: '4', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'c' },
    });
  });

  it('x : Integer = 2 : Integer — type on both sides', async () => {
    await expectReply({
      script, receive: { id: '5', op: '@bothSides', from: 'c' },
      reply: { id: '5', 'bv-a': { result: 'Integer' }, re: { result: 2 }, to: 'c' },
    });
  });

  it('x = 1 as Integer then x : Integer — hoisting', async () => {
    await expectReply({
      script, receive: { id: '6', op: '@hoisting', from: 'c' },
      reply: { id: '6', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' },
    });
  });

  it('x : Integer declared three times — all legal', async () => {
    await expectReply({
      script, receive: { id: '7', op: '@tripleDecl', from: 'c' },
      reply: { id: '7', 'bv-a': { result: 'Integer' }, re: { result: 5 }, to: 'c' },
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Compile checks
// ═══════════════════════════════════════════════════════════════════════════════

describe('type declarations — compile checks', () => {
  it('x : Integer — bare decl compiles without error', () => {
    expect(() => compile(`@go = { x : Integer; -> result: 0 as Integer }\n`)).not.toThrow();
  });
});

describe('conflicting type declarations — compile errors', () => {
  it('bare decl then conflicting TypedAssign → error', () => {
    expect(() => compile(`@go = { x : Integer; x : Text = "hello"; -> result: x }\n`))
      .toThrow(/Conflicting type declarations for 'x'/);
  });

  it('TypedAssign then conflicting bare decl', () => {
    expect(() => compile(`@go = { x : Text = "hello"; x : Integer; -> result: x }\n`))
      .toThrow(/Conflicting type declarations for 'x'/);
  });

  it('x : Integer = "hello" as Text — same-line conflict', () => {
    expect(() => compile(`@go = { x : Integer = "hello" as Text; -> result: x }\n`))
      .toThrow(/Conflicting type declarations for 'x'/);
  });

  it('two conflicting bare decls', () => {
    expect(() => compile(`@go = { x : Integer; x : Text; -> result: x }\n`))
      .toThrow(/Conflicting type declarations for 'x'/);
  });
});
