import { expectReply } from './helpers.js';

describe('math', () => {
  it('integer math — bigger = x + 1', async () => {
    const source = `
      on inc(:x : Integer)
        bigger : Integer = x + 1
        reply :bigger : Integer
    `;
    await expectReply({
      source,
      receive: { id: 'someid', op: [{ x: 5 }, 'inc'], 'bv-a': [{ x: 'Integer' }, 'inc'], from: 'caller' },
      reply: {
        id: 'someid',
        'bv-a': [{ bigger: 'Integer' }, 'inc'],
        re: [{ bigger: 6 }, 'inc'],
        to: 'caller',
      },
    });
  });
});
