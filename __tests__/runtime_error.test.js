import { jest } from '@jest/globals';
import compile from '../index.js';
import { evaluate } from './helpers.js';

// All runtime errors produce: ex: { <op>: 'error' }

describe('Runtime errors', () => {
  it('list arity mismatch — [a, b] = [1, 2, 3] without discard', async () => {
    const source = `
      on test()
        nums : List of Integers = [1, 2, 3] : List of Integers
        [a : Integer, b : Integer] = nums
        reply result: 0 : Integer
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'test', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({
      id: '1',
      ex: { test: 'error' },
      to: 'caller',
    });
  });

  it('head of empty list — [h] = []', async () => {
    const source = `
      on test()
        nums : List of Integers = [] : List of Integers
        [h : Integer] = nums
        reply result: h
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'test', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({
      id: '1',
      ex: { test: 'error' },
      to: 'caller',
    });
  });

  it('head of too-short list — [a, b] = [1]', async () => {
    const source = `
      on test()
        nums : List of Integers = [1] : List of Integers
        [a : Integer, b : Integer] = nums
        reply result: 0 : Integer
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'test', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({
      id: '1',
      ex: { test: 'error' },
      to: 'caller',
    });
  });
});
