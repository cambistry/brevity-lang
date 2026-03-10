import { jest } from '@jest/globals';
import compile from '../index.js';
import { evaluate } from './helpers.js';

describe('arguments', () => {
  it('positional args — explicit inline', async () => {
    const source = `
      on mult(a : Integer, b : Integer)
        x : Integer = a * b
        reply(x : Integer)
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { mult: [3, 5] }, 'bv-a': { mult: ['Integer', 'Integer'] }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', 'bv-a': { mult: ['Integer'] }, re: { mult: [15] }, to: 'caller' });
  });

  it('positional args — open form', async () => {
    const source = `
      on mult
        a : Integer
        b : Integer

        x : Integer = a * b
        reply
          x : Integer
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { mult: [3, 5] }, 'bv-a': { mult: ['Integer', 'Integer'] }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', 'bv-a': { mult: ['Integer'] }, re: { mult: [15] }, to: 'caller' });
  });

  it('key-mapped arg — outer: inner : Text', async () => {
    const source = `
      on get(outer: inner : Text)
        reply(result: inner : Text)
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: 'x', op: { get: { outer: 'hello' } }, 'bv-a': { get: { outer: 'Text' } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: 'x', 'bv-a': { get: { result: 'Text' } }, re: { get: { result: 'hello' } }, to: 'caller' });
  });

  it('key-mapped arg — open form', async () => {
    const source = `
      on get
        outer: inner : Text

        reply(result: inner : Text)
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: 'x', op: { get: { outer: 'hello' } }, 'bv-a': { get: { outer: 'Text' } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: 'x', 'bv-a': { get: { result: 'Text' } }, re: { get: { result: 'hello' } }, to: 'caller' });
  });

  it('mixed positional + named args', async () => {
    const source = `
      on mash
        a : Integer
        b : Integer
        :message : Text

        result : Integer = a + b
        reply
          result : Integer
          comment: message : Text
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { mash: [1, 2, { message: 'add this' }] }, 'bv-a': { mash: ['Integer', 'Integer', { message: 'Text' }] }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({
      id: '1',
      'bv-a': { mash: ['Integer', { comment: 'Text' }] },
      re: { mash: [3, { comment: 'add this' }] },
      to: 'caller',
    });
  });
});
