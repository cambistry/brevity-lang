import { jest } from '@jest/globals';
import compile from '../index.js';
import { evaluate } from './helpers.js';

describe('over — map', () => {
  it('maps integers: adds 1 to each element', async () => {
    const source = [
      'on test()',
      '  nums : List of Integers = [1, 2, 3] : List of Integers',
      '  result : List of Integers = over nums (item : Integer) { item + 1 } : Integer',
      '  reply :result',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'test', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({
      id: '1',
      'bv-a': { test: { result: 'List of Integers' } },
      re: { test: { result: [2, 3, 4] } },
      to: 'caller',
    });
  });

  it('identity map over texts', async () => {
    const source = [
      'on test()',
      '  words : List of Texts = ["hello", "world"] : List of Texts',
      '  result : List of Texts = over words (w : Text) { w } : Text',
      '  reply :result',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'test', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({
      id: '1',
      'bv-a': { test: { result: 'List of Texts' } },
      re: { test: { result: ['hello', 'world'] } },
      to: 'caller',
    });
  });

  it('untyped fn body → List of Anything — bv-a emits component types array', async () => {
    const source = [
      'on test()',
      '  nums : List of Integers = [10, 20] : List of Integers',
      '  result : List = over nums (item) { item }',
      '  reply :result',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'test', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith(
      expect.objectContaining({
        'bv-a': { test: { result: ['Integer', 'Integer'] } },
        re: { test: { result: [10, 20] } },
      })
    );
  });

  it('over empty list → reply is null', async () => {
    const source = [
      'on test()',
      '  nums : List of Integers = []',
      '  result : List of Integers = over nums (item : Integer) { item + 1 } : Integer',
      '  reply :result',
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

  it('over with proc call inside fn body (async callback)', async () => {
    const source = [
      'on test()',
      '  nums : List of Integers = [3, 4] : List of Integers',
      '  result : List of Integers = over nums (item : Integer) {',
      '    result: sq : Integer = square(item)',
      '    sq',
      '  } : Integer',
      '  reply :result',
      '',
      'proc square(num : Integer)',
      '  sq : Integer = num * num',
      '  reply(result: sq : Integer)',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'test', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({
      id: '1',
      'bv-a': { test: { result: 'List of Integers' } },
      re: { test: { result: [9, 16] } },
      to: 'caller',
    });
  });

  it.todo('standalone over (side-effect only) — requires actor state, not yet implemented');
});
