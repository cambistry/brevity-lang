import { expectReply } from './helpers.js';

describe('intercom', () => {
  it('parses use declaration', async () => {
    const source = `
      use Remote

      on test(:msg : Text)
        reply :msg
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{ msg: 'hello' }, 'test'], from: 'caller', 'bv-a': [{ msg: 'Text' }] },
      reply: { id: '1', 'bv-a': { msg: 'Text' }, re: { msg: 'hello' }, to: 'caller' },
    });
  });
});
