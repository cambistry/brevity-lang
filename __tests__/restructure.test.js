import { expectReply } from './helpers.js';

describe('restructure', () => {
  it('local var assignment and restructure — a = x, reply(:a)', async () => {
    const source = `
      on echo2(:x : Integer)
        a : Integer = x
        reply(:a : Integer)
    `;
    await expectReply({
      source,
      receive: { id: 'someid', op: { echo2: { x: 42 } }, 'bv-a': { echo2: { x: 'Integer' } }, from: 'caller' },
      reply: {
        id: 'someid',
        'bv-a': { echo2: { a: 'Integer' } },
        re: { echo2: { a: 42 } },
        to: 'caller',
      },
    });
  });
});
