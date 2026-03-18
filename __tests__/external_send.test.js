import { expectReply, runActor } from './helpers.js';

describe('external send', () => {
  it('fires outgoing message for DotCallExpr', async () => {
    const source = `
      use Remote

      @call_remote
        =
        :url : Text
        =
        spawn Remote.get(:url : Text) .
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

  it('receives response message for DotCallExpr', async () => {
    const source = `
      use Remote

      @call_remote
        =
        :url : Text
        =
        :response : Text = Remote.get(:url : Text)
        -> :response : Text
    `;

    // 1. Send call_remote — actor posts outgoing get and suspends
    // 2. Feed response from Remote back — actor resumes and replies
    const posts = await runActor({
      source,
      receive: [
        {
          id: '42', op: [{ url: 'http://example.com' }, 'call_remote'],
          from: 'caller', 'bv-a': [{ url: 'Text' }],
        },
        // Response from Remote (id matches outgoing message id)
        { id: '1', re: { response: 'hello' } },
      ],
    });

    // First post: outgoing request to Remote
    expect(posts[0]).toEqual(expect.objectContaining({
      op: [{ url: 'http://example.com' }, 'get'], to: 'Remote',
    }));
    // Second post: -> to original caller
    expect(posts[1]).toEqual({
      id: '42', re: { response: 'hello' }, to: 'caller', 'bv-a': { response: 'Text' },
    });
  });
});
