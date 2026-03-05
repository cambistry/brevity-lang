import { jest } from '@jest/globals';
import compile from '../index.js';
import { evaluate } from './helpers.js';

describe('math', () => {
  it('integer math — bigger = x + 1', async () => {
    const source = [
      'on inc(:x : Integer)',
      '  bigger = x + 1',
      '  reply :bigger : Integer',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    const actor = new Actor(binding);
    actor.receive({ id: 'someid', op: { inc: { x: 5 } }, 'bv-a': { inc: { x: 'Integer' } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({
      id: 'someid',
      re: { inc: { bigger: 6 } },
      to: 'caller',
    });
  });
});
