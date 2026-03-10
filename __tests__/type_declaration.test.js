import { jest } from '@jest/globals';
import compile from '../index.js';
import { evaluate } from './helpers.js';

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
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'go', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', 'bv-a': { go: { result: 'Integer' } }, re: { go: { result: 1 } }, to: 'caller' });
  });
});

describe('typed RHS assignment (x = value : Type)', () => {
  it('x = 1 : Integer — typed RHS', async () => {
    const source = `
      on go()
        x = 1 : Integer
        reply result: x
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'go', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', 'bv-a': { go: { result: 'Integer' } }, re: { go: { result: 1 } }, to: 'caller' });
  });

  it('x = "hello" : Text — typed RHS string', async () => {
    const source = `
      on go()
        x = "hello" : Text
        reply result: x
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'go', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', 'bv-a': { go: { result: 'Text' } }, re: { go: { result: 'hello' } }, to: 'caller' });
  });

  it('x = a + b : Integer — typed RHS expression', async () => {
    const source = `
      on go(:a : Integer, :b : Integer)
        x = a + b : Integer
        reply result: x
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { go: { a: 3, b: 4 } }, 'bv-a': { go: { a: 'Integer', b: 'Integer' } }, from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', 'bv-a': { go: { result: 'Integer' } }, re: { go: { result: 7 } }, to: 'caller' });
  });
});

describe('redundant type annotations', () => {
  it('x : Integer = 2 : Integer — type on both sides', async () => {
    const source = `
      on go()
        x : Integer = 2 : Integer
        reply result: x
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'go', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', 'bv-a': { go: { result: 'Integer' } }, re: { go: { result: 2 } }, to: 'caller' });
  });

  it('x = 1 : Integer then x : Integer — hoisting', async () => {
    const source = `
      on go()
        x = 1 : Integer
        x : Integer
        reply result: x
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'go', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', 'bv-a': { go: { result: 'Integer' } }, re: { go: { result: 1 } }, to: 'caller' });
  });

  it('x : Integer declared three times — all legal', async () => {
    const source = `
      on go()
        x : Integer
        x : Integer = 5 : Integer
        reply result: x
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'go', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', 'bv-a': { go: { result: 'Integer' } }, re: { go: { result: 5 } }, to: 'caller' });
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
