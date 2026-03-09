import { jest } from '@jest/globals';
import compile from '../index.js';
import { evaluate } from './helpers.js';

describe('null literal', () => {
  it('null assigned to Integer | null var → reply is null at runtime', async () => {
    const source = [
      'on test()',
      '  x : Integer | null = null',
      '  reply result: x',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'test', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({
      id: '1',
      'bv-a': { test: { result: 'Integer | null' } },
      re: { test: { result: null } },
      to: 'caller',
    });
  });

  it('Integer | null var with non-null value → runtime value correct, bv-a emits type string', async () => {
    const source = [
      'on test()',
      '  x : Integer | null = 42 : Integer',
      '  reply result: x',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'test', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({
      id: '1',
      'bv-a': { test: { result: 'Integer | null' } },
      re: { test: { result: 42 } },
      to: 'caller',
    });
  });

  it('null replied directly as key-value → reply field is null', async () => {
    const source = [
      'on test()',
      '  reply result: null',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'test', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith(
      expect.objectContaining({
        re: { test: { result: null } },
      })
    );
  });
});
