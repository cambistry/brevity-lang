import compile from '../index.js';
import { expectReply } from './helpers.js';

describe('bare type declaration', () => {
  it('x : Integer — bare decl, no assignment (compiles without error)', () => {
    expect(() => compile(`
      @go()
        x : Integer
        -> result: 0 : Integer
    `)).not.toThrow();
  });

  it('x : Integer before assignment — decl then use', async () => {
    const source = `
      @go()
        x : Integer
        x = 1 : Integer
        -> result: x
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'caller' },
    });
  });
});

describe('typed RHS assignment (x = value : Type)', () => {
  it('x = 1 : Integer — typed RHS', async () => {
    const source = `
      @go()
        x = 1 : Integer
        -> result: x
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'caller' },
    });
  });

  it('x = "hello" : Text — typed RHS string', async () => {
    const source = `
      @go()
        x = "hello" : Text
        -> result: x
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { result: 'Text' }, re: { result: 'hello' }, to: 'caller' },
    });
  });

  it('x = a + b : Integer — typed RHS expression', async () => {
    const source = `
      @go(:a : Integer, :b : Integer)
        x = a + b : Integer
        -> result: x
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{ a: 3, b: 4 }, 'go'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'caller' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'caller' },
    });
  });
});

describe('redundant type annotations', () => {
  it('x : Integer = 2 : Integer — type @both sides', async () => {
    const source = `
      @go()
        x : Integer = 2 : Integer
        -> result: x
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 2 }, to: 'caller' },
    });
  });

  it('x = 1 : Integer then x : Integer — hoisting', async () => {
    const source = `
      @go()
        x = 1 : Integer
        x : Integer
        -> result: x
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'caller' },
    });
  });

  it('x : Integer declared three times — all legal', async () => {
    const source = `
      @go()
        x : Integer
        x : Integer = 5 : Integer
        -> result: x
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 5 }, to: 'caller' },
    });
  });
});

describe('conflicting type declarations — compile errors', () => {
  it('bare decl then conflicting TypedAssign → error', () => {
    const source = `
      @go()
        x : Integer
        x : Text = "hello"
        -> result: x
    `;
    expect(() => compile(source)).toThrow(/Conflicting type declarations for 'x'/);
  });

  it('conflicting order reversed — TypedAssign then bare decl', () => {
    const source = `
      @go()
        x : Text = "hello"
        x : Integer
        -> result: x
    `;
    expect(() => compile(source)).toThrow(/Conflicting type declarations for 'x'/);
  });

  it('x : Integer = "hello" : Text — same-line conflict', () => {
    const source = `
      @go()
        x : Integer = "hello" : Text
        -> result: x
    `;
    expect(() => compile(source)).toThrow(/Conflicting type declarations for 'x'/);
  });

  it('two conflicting bare decls', () => {
    const source = `
      @go()
        x : Integer
        x : Text
        -> result: x
    `;
    expect(() => compile(source)).toThrow(/Conflicting type declarations for 'x'/);
  });
});
