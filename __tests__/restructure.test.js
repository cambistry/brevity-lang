import { expectReply } from './helpers.js';

describe('restructure', () => {
  const script = `
    @echo2
      =
      :x : Integer
      =
      a : Integer = x
      ->(:a)
  `;

  it('local var assignment and restructure — a = x, ->(:a)', async () => {
    await expectReply({
      script, receive: { id: '1', op: [{ x: 42 }, '@echo2'], 'bv-a': [{ x: 'Integer' }], from: 'c' },
      reply: { id: '1', 'bv-a': { a: 'Integer' }, re: { a: 42 }, to: 'c' },
    });
  });
});
