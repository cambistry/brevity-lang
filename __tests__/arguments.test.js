import { jest } from '@jest/globals';
import compile from '../index.js';
import { evaluate } from './helpers.js';

describe('arguments', () => {
  it('positional args — explicit inline', async () => {
    const source = [
      'on mult(a : Integer, b : Integer)',
      '  x = a * b',
      '  reply(x : Integer)',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { mult: [3, 5] }, 'bv-a': { mult: ['Integer', 'Integer'] }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { mult: [15] }, to: 'caller' });
  });

  it('positional args — open form', async () => {
    const source = [
      'on mult',
      '  a : Integer',
      '  b : Integer',
      '',
      '  x = a * b',
      '  reply',
      '    x : Integer',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { mult: [3, 5] }, 'bv-a': { mult: ['Integer', 'Integer'] }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { mult: [15] }, to: 'caller' });
  });

  it('key-mapped arg — outer: inner : String', async () => {
    const source = [
      'on get(outer: inner : String)',
      '  reply(result: inner : String)',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: 'x', op: { get: { outer: 'hello' } }, 'bv-a': { get: { outer: 'Text' } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: 'x', re: { get: { result: 'hello' } }, to: 'caller' });
  });

  it('key-mapped arg — open form', async () => {
    const source = [
      'on get',
      '  outer: inner : String',
      '',
      '  reply(result: inner : String)',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: 'x', op: { get: { outer: 'hello' } }, 'bv-a': { get: { outer: 'Text' } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: 'x', re: { get: { result: 'hello' } }, to: 'caller' });
  });

  it('mixed positional + named args', async () => {
    const source = [
      'on mash',
      '  a : Integer',
      '  b : Integer',
      '  :message : Text',
      '',
      '  result = a + b',
      '  reply',
      '    result : Integer',
      '    comment: message : Text',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { mash: [1, 2, { message: 'add this' }] }, 'bv-a': { mash: ['Integer', 'Integer', { message: 'Text' }] }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({
      id: '1',
      re: { mash: [3, { comment: 'add this' }] },
      to: 'caller',
    });
  });
});
