import compile from '../index.js';
import { runActor } from './helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture — Declarations and typed RHS
// ═══════════════════════════════════════════════════════════════════════════════

describe('type declarations + typed RHS', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      --- bare declaration then use ---

      @declThenUse
        =
        x : Integer
        x = 1 : Integer
        -> result: x

      --- typed RHS ---

      @typedInt
        =
        x = 1 : Integer
        -> result: x

      @typedText
        =
        x = "hello" : Text
        -> result: x

      @typedExpr
        =
        :a : Integer
        :b : Integer
        =
        x = a + b : Integer
        -> result: x

      --- redundant annotations ---

      @bothSides
        =
        x : Integer = 2 : Integer
        -> result: x

      @hoisting
        =
        x = 1 : Integer
        x : Integer
        -> result: x

      @tripleDecl
        =
        x : Integer
        x : Integer = 5 : Integer
        -> result: x
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: 'declThenUse', from: 'c' },
        { id: '2', op: 'typedInt', from: 'c' },
        { id: '3', op: 'typedText', from: 'c' },
        { id: '4', op: [{ a: 3, b: 4 }, 'typedExpr'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'c' },
        { id: '5', op: 'bothSides', from: 'c' },
        { id: '6', op: 'hoisting', from: 'c' },
        { id: '7', op: 'tripleDecl', from: 'c' },
      ],
    });
  });

  it('x : Integer before assignment — decl then use', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' });
  });

  it('x = 1 : Integer — typed RHS', () => {
    expect(outputs[1]).toEqual({ id: '2', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' });
  });

  it('x = "hello" : Text — typed RHS string', () => {
    expect(outputs[2]).toEqual({ id: '3', 'bv-a': { result: 'Text' }, re: { result: 'hello' }, to: 'c' });
  });

  it('x = a + b : Integer — typed RHS expression', () => {
    expect(outputs[3]).toEqual({ id: '4', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'c' });
  });

  it('x : Integer = 2 : Integer — type on both sides', () => {
    expect(outputs[4]).toEqual({ id: '5', 'bv-a': { result: 'Integer' }, re: { result: 2 }, to: 'c' });
  });

  it('x = 1 : Integer then x : Integer — hoisting', () => {
    expect(outputs[5]).toEqual({ id: '6', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' });
  });

  it('x : Integer declared three times — all legal', () => {
    expect(outputs[6]).toEqual({ id: '7', 'bv-a': { result: 'Integer' }, re: { result: 5 }, to: 'c' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Compile checks
// ═══════════════════════════════════════════════════════════════════════════════

describe('type declarations — compile checks', () => {
  it('x : Integer — bare decl compiles without error', () => {
    expect(() => compile(`@go = x : Integer\n  -> result: 0 : Integer\n`)).not.toThrow();
  });
});

describe('conflicting type declarations — compile errors', () => {
  it('bare decl then conflicting TypedAssign → error', () => {
    expect(() => compile(`@go = x : Integer\n  x : Text = "hello"\n  -> result: x\n`))
      .toThrow(/Conflicting type declarations for 'x'/);
  });

  it('TypedAssign then conflicting bare decl', () => {
    expect(() => compile(`@go = x : Text = "hello"\n  x : Integer\n  -> result: x\n`))
      .toThrow(/Conflicting type declarations for 'x'/);
  });

  it('x : Integer = "hello" : Text — same-line conflict', () => {
    expect(() => compile(`@go = x : Integer = "hello" : Text\n  -> result: x\n`))
      .toThrow(/Conflicting type declarations for 'x'/);
  });

  it('two conflicting bare decls', () => {
    expect(() => compile(`@go = x : Integer\n  x : Text\n  -> result: x\n`))
      .toThrow(/Conflicting type declarations for 'x'/);
  });
});
