import { expectReply } from './helpers.js';

describe('external send', () => {
  it('fires outgoing message for DotCallExpr', async () => {
    const source = `
      use Remote

      on call_remote(:url : Text)
        spawn Remote.get(:url : Text)
        end
    `;
    await expectReply({
      source,
      receive: {
        id: '42', op: [{ url: 'http://example.com' }, 'call_remote'], from: 'caller', 'bv-a': [{ url: 'Text' }],
      },
      reply: {
        id: '1', op: [{ url: 'http://example.com' }, 'get'], to: 'Remote', 'bv-a': [{ url: 'Text' }],
      },
    });
  });
});
