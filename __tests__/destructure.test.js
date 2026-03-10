import { expectReply } from './helpers.js';

describe('destructure', () => {
  it('on echo(:text : Text) — destructures and reflects arg', async () => {
    const source = `on echo(:text : Text) reply(:text : Text)\n`;
    await expectReply({
      source,
      receive: { id: 'someid', op: { echo: { text: 'abc' } }, 'bv-a': { echo: { text: 'Text' } }, from: 'caller' },
      reply: {
        id: 'someid',
        'bv-a': { echo: { text: 'Text' } },
        re: { echo: { text: 'abc' } },
        to: 'caller',
      },
    });
  });
});
