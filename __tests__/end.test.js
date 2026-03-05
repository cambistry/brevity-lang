import { jest } from '@jest/globals';
import compile from '../index.js';
import { evaluate } from './helpers.js';

describe('silent handler (end, no reply)', () => {
  it('inline form — no post fired', async () => {
    const { output } = compile('on notify(:msg : Text) end\n');
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '123', op: { notify: { msg: 'attention' } }, 'bv-a': { notify: { msg: 'Text' } }, from: 'caller' });
    expect(binding.post).not.toHaveBeenCalled();
  });

  it('open form — no post fired', async () => {
    const source = [
      'on log',
      '  :info : Text',
      '',
      '  end',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { log: { info: 'hello' } }, 'bv-a': { log: { info: 'Text' } }, from: 'caller' });
    expect(binding.post).not.toHaveBeenCalled();
  });

  it('multi-handler — silent handler still suppresses post', async () => {
    const source = [
      'on notify(:msg : Text) end',
      'on add(:a : Integer, :b : Integer) reply sum: a + b',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { notify: { msg: 'hi' } }, 'bv-a': { notify: { msg: 'Text' } }, from: 'caller' });
    expect(binding.post).not.toHaveBeenCalled();
  });

  it('multi-handler — replying handler still works alongside silent handler', async () => {
    const source = [
      'on notify(:msg : Text) end',
      'on add(:a : Integer, :b : Integer) reply sum: a + b',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '2', op: { add: { a: 3, b: 4 } }, 'bv-a': { add: { a: 'Integer', b: 'Integer' } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({
      id: '2', re: { add: { sum: 7 } }, to: 'caller',
    });
  });

  it('unhandled op is still distinguished from silent handler', async () => {
    const { output } = compile('on notify(:msg : Text) end\n');
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '9', op: 'unknown', from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({
      id: '9', ex: { unknown: 'unhandled' }, to: 'caller',
    });
  });
});
