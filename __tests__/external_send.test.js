import { runActor } from './helpers.js';

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
    const outputs = await runActor({
      source,
      receive: [
        { id: '42', op: [{ url: 'http://example.com' }, 'call_remote'], from: 'caller', 'bv-a': [{ url: 'Text' }] },
      ],
    });
    expect(outputs[0]).toEqual({
      id: '1', op: [{ url: 'http://example.com' }, 'get'], to: 'Remote', 'bv-a': [{ url: 'Text' }],
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
    const posts = await runActor({
      source,
      receive: [
        { id: '42', op: [{ url: 'http://example.com' }, 'call_remote'], from: 'caller', 'bv-a': [{ url: 'Text' }] },
        { id: '1', re: { response: 'hello' } },
      ],
    });
    expect(posts[0]).toEqual(expect.objectContaining({
      op: [{ url: 'http://example.com' }, 'get'], to: 'Remote',
    }));
    expect(posts[1]).toEqual({
      id: '42', re: { response: 'hello' }, to: 'caller', 'bv-a': { response: 'Text' },
    });
  });
});
