import { jest } from '@jest/globals';
import compile from '../index.js';
import { evaluate } from './helpers.js';

describe('reply', () => {
  it('computed reply field — reply(c: a + b : Integer)', async () => {
    const source = 'on add(:a : Integer, :b : Integer)\n  reply(c: a + b : Integer)\n';
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: 'x', op: { add: { a: 3, b: 4 } }, 'bv-a': { add: { a: 'Integer', b: 'Integer' } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: 'x', re: { add: { c: 7 } }, to: 'caller' });
  });
});
