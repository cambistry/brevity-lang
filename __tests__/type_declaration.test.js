import compile from '../index.js';
import { expectReply } from './helpers.js';

describe('bare type declaration', () => {
  it('x : Integer — bare decl, no assignment (compiles without error)', () => {
    expect(() => compile([
      'on go()',
      '  x : Integer',
      '  reply result: 0 : Integer',
    ].join('\n'))).not.toThrow();
  });

  it('x : Integer before assignment — decl then use', async () => {
    const source = `
      on go()
        x : Integer
        x = 1 : Integer
        reply result: x
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': [{ result: 'Integer' }, 'go'], re: [{ result: 1 }, 'go'], to: 'caller' },
    });
  });
});

describe('typed RHS assignment (x = value : Type)', () => {
  it('x = 1 : Integer — typed RHS', async () => {
    const source = `
      on go()
        x = 1 : Integer
        reply result: x
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': [{ result: 'Integer' }, 'go'], re: [{ result: 1 }, 'go'], to: 'caller' },
    });
  });

  it('x = "hello" : Text — typed RHS string', async () => {
    const source = `
      on go()
        x = "hello" : Text
        reply result: x
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': [{ result: 'Text' }, 'go'], re: [{ result: 'hello' }, 'go'], to: 'caller' },
    });
  });

  it('x = a + b : Integer — typed RHS expression', async () => {
    const source = `
      on go(:a : Integer, :b : Integer)
        x = a + b : Integer
        reply result: x
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{ a: 3, b: 4 }, 'go'], 'bv-a': [{ a: 'Integer', b: 'Integer' }, 'go'], from: 'caller' },
      reply: { id: '1', 'bv-a': [{ result: 'Integer' }, 'go'], re: [{ result: 7 }, 'go'], to: 'caller' },
    });
  });
});

describe('redundant type annotations', () => {
  it('x : Integer = 2 : Integer — type on both sides', async () => {
    const source = `
      on go()
        x : Integer = 2 : Integer
        reply result: x
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': [{ result: 'Integer' }, 'go'], re: [{ result: 2 }, 'go'], to: 'caller' },
    });
  });

  it('x = 1 : Integer then x : Integer — hoisting', async () => {
    const source = `
      on go()
        x = 1 : Integer
        x : Integer
        reply result: x
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': [{ result: 'Integer' }, 'go'], re: [{ result: 1 }, 'go'], to: 'caller' },
    });
  });

  it('x : Integer declared three times — all legal', async () => {
    const source = `
      on go()
        x : Integer
        x : Integer = 5 : Integer
        reply result: x
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', 'bv-a': [{ result: 'Integer' }, 'go'], re: [{ result: 5 }, 'go'], to: 'caller' },
    });
  });
});

describe('conflicting type declarations — compile errors', () => {
  it('bare decl then conflicting TypedAssign → error', () => {
    const source = `
      on go()
        x : Integer
        x : Text = "hello"
        reply result: x
    `;
    expect(() => compile(source)).toThrow(/Conflicting type declarations for 'x'/);
  });

  it('conflicting order reversed — TypedAssign then bare decl', () => {
    const source = `
      on go()
        x : Text = "hello"
        x : Integer
        reply result: x
    `;
    expect(() => compile(source)).toThrow(/Conflicting type declarations for 'x'/);
  });

  it('x : Integer = "hello" : Text — same-line conflict', () => {
    const source = `
      on go()
        x : Integer = "hello" : Text
        reply result: x
    `;
    expect(() => compile(source)).toThrow(/Conflicting type declarations for 'x'/);
  });

  it('two conflicting bare decls', () => {
    const source = `
      on go()
        x : Integer
        x : Text
        reply result: x
    `;
    expect(() => compile(source)).toThrow(/Conflicting type declarations for 'x'/);
  });
});
