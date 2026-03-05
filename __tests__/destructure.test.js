import { jest } from '@jest/globals';
import compile from '../index.js';
import { evaluate } from './helpers.js';

describe('destructure', () => {
  it('on echo(:text : Text) — destructures and reflects arg', async () => {
    const { output } = compile(`on echo(:text : Text) reply(:text : Text)\n`);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    const actor = new Actor(binding);
    actor.receive({ id: 'someid', op: { echo: { text: 'abc' } }, 'bv-a': { echo: { text: 'Text' } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({
      id: 'someid',
      re: { echo: { text: 'abc' } },
      to: 'caller',
    });
  });
});
