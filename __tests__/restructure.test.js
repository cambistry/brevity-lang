import { expectReply } from './helpers.js';

describe('restructure', () => {
  it('local var assignment and restructure — a = x, ->(:a)', async () => {
    const source = `
      @echo2
        =
        :x : Integer
        =
        a : Integer = x
        ->(:a : Integer)
    `;
    await expectReply({
      source,
      receive: { id: 'someid', op: [{ x: 42 }, 'echo2'], 'bv-a': [{ x: 'Integer' }], from: 'caller' },
      reply: {
        id: 'someid',
        'bv-a': { a: 'Integer' },
        re: { a: 42 },
        to: 'caller',
      },
    });
  });
});
