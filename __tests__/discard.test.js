import { jest } from '@jest/globals';
import compile from '../index.js';
import { evaluate } from './helpers.js';

describe('underscore discard — positional destructure', () => {
  it('_, b = args — discard first positional, bind second', async () => {
    const source = [
      'on test(...args)',
      '  _, b = args',
      '  reply result: b',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { test: [99, 42] }, 'bv-a': { test: ['Integer', 'Integer'] }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { test: { result: 42 } }, to: 'caller' });
  });

  it('a, _, b = args — discard middle positional, bind first and third', async () => {
    const source = [
      'on test(...args)',
      '  a, _, b = args',
      '  reply sum: a + b',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { test: [10, 99, 20] }, 'bv-a': { test: ['Integer', 'Integer', 'Integer'] }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { test: { sum: 30 } }, to: 'caller' });
  });

  it('_, _ = args — multiple underscores in one pattern, no bindings generated', async () => {
    const source = [
      'on test(...args)',
      '  _, _ = args',
      '  reply result: 0',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { test: [1, 2] }, 'bv-a': { test: ['Integer', 'Integer'] }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { test: { result: 0 } }, to: 'caller' });
  });

  it('(a, _, b) = args — paren form with discard', async () => {
    const source = [
      'on test(...args)',
      '  (a, _, b) = args',
      '  reply sum: a + b',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { test: [5, 77, 6] }, 'bv-a': { test: ['Integer', 'Integer', 'Integer'] }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { test: { sum: 11 } }, to: 'caller' });
  });

  it('a, _, _, d = args — two consecutive discards', async () => {
    const source = [
      'on test(...args)',
      '  a, _, _, d = args',
      '  reply sum: a + d',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { test: [1, 0, 0, 4] }, 'bv-a': { test: ['Integer', 'Integer', 'Integer', 'Integer'] }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { test: { sum: 5 } }, to: 'caller' });
  });
});
