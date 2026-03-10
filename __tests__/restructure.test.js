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
      receive: { id: 'someid', op: [{ x: 42 }, 'echo2'], 'bv-a': [{ x: 'Integer' }, 'echo2'], from: 'caller' },
      reply: {
        id: 'someid',
        'bv-a': [{ a: 'Integer' }, 'echo2'],
        re: [{ a: 42 }, 'echo2'],
        to: 'caller',
      },
    });
  });
});
