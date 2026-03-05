import { jest } from '@jest/globals';
import compile from '../index.js';
import { evaluate } from './helpers.js';

describe('restructure', () => {
  it('local var assignment and restructure — a = x, reply(:a)', async () => {
    const source = [
      'on echo2(:x : Integer)',
      '  a = x',
      '  reply(:a : Integer)',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    const actor = new Actor(binding);
    actor.receive({ id: 'someid', op: { echo2: { x: 42 } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({
      id: 'someid',
      re: { echo2: { a: 42 } },
      to: 'caller',
    });
  });
});
