import { jest } from '@jest/globals';
import compile from '../index.js';
import { evaluate } from './helpers.js';

describe('parallel assign — positional inline structure', () => {
  it('a, b = 1 : Integer, 2 : Integer binds both positionals', async () => {
    const source = `
      on foo()
        a, b = 1 : Integer, 2 : Integer
        reply x: a, y: b
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'foo', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', 'bv-a': { foo: { x: 'Integer', y: 'Integer' } }, re: { foo: { x: 1, y: 2 } }, to: 'caller' });
  });

  it('a, b = 10 : Integer, 20 : Integer arithmetic on results', async () => {
    const source = `
      on foo()
        a, b = 10 : Integer, 20 : Integer
        reply sum: a + b : Integer
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'foo', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', 'bv-a': { foo: { sum: 'Integer' } }, re: { foo: { sum: 30 } }, to: 'caller' });
  });
});

describe('parallel assign — named inline structure', () => {
  it(':x, :y = x: 5 : Integer, y: 7 : Integer binds named fields', async () => {
    const source = `
      on foo()
        :x, :y = x: 5 : Integer, y: 7 : Integer
        reply a: x, b: y
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'foo', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', 'bv-a': { foo: { a: 'Integer', b: 'Integer' } }, re: { foo: { a: 5, b: 7 } }, to: 'caller' });
  });
});

describe('parallel assign — string literals', () => {
  it('a, b = "hello" : Text, "world" : Text binds both strings', async () => {
    const source = `
      on foo()
        a, b = "hello" : Text, "world" : Text
        reply first: a, second: b
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'foo', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', 'bv-a': { foo: { first: 'Text', second: 'Text' } }, re: { foo: { first: 'hello', second: 'world' } }, to: 'caller' });
  });
});
