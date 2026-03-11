import { expectReply } from './helpers.js';

describe('destructure', () => {
  it('on echo(:text : Text) — destructures and reflects arg', async () => {
    const source = `on echo(:text : Text) reply(:text : Text)\n`;
    await expectReply({
      source,
      receive: { id: 'someid', op: [{ text: 'abc' }, 'echo'], 'bv-a': [{ text: 'Text' }], from: 'caller' },
      reply: {
        id: 'someid',
        'bv-a': { text: 'Text' },
        re: { text: 'abc' },
        to: 'caller',
      },
    });
  });
});
