import { jest } from '@jest/globals';
import compile from '../index.js';
import { evaluate } from './helpers.js';

describe('assignment', () => {
  it.todo('plain local var used in expression before reply');

  it('typed assign as last block statement evaluates to assigned value', async () => {
    const source = [
      'on test()',
      '  result : Integer = if true {',
      '    x : Integer = 42 : Integer',
      '  } else {',
      '    0 : Integer',
      '  }',
      '  reply :result',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'test', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({
      id: '1',
      'bv-a': { test: { result: 'Integer' } },
      re: { test: { result: 42 } },
      to: 'caller',
    });
  });
});
