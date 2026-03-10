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
      receive: { id: 'someid', op: { inc: { x: 5 } }, 'bv-a': { inc: { x: 'Integer' } }, from: 'caller' },
      reply: {
        id: 'someid',
        'bv-a': { inc: { bigger: 'Integer' } },
        re: { inc: { bigger: 6 } },
        to: 'caller',
      },
    });
  });
});
