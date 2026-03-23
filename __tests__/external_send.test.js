import { createActor } from './helpers.js';

describe('external send', () => {
  it('fires outgoing message for DotCallExpr', async () => {
    const actor = await createActor(`
      uses Remote

      @call_remote
        =
        :url : Text
        =
        spawn Remote.get(:url : Text) .
    `);
    await actor.sendAsync({ id: '42', op: [{ url: 'http://example.com' }, '@call_remote'], from: 'caller', 'bv-a': [{ url: 'Text' }] });
    expect(actor.posts[0]).toEqual({
      id: '1', op: [{ url: 'http://example.com' }, '@get'], to: 'Remote', 'bv-a': [{ url: 'Text' }],
    });
  });

  it('receives response message for DotCallExpr', async () => {
    const actor = await createActor(`
      uses Remote

      @call_remote
        =
        :url : Text
        =
        :response : Text = Remote.get(:url : Text)
        -> :response : Text
    `);
    await actor.sendAsync({ id: '42', op: [{ url: 'http://example.com' }, '@call_remote'], from: 'caller', 'bv-a': [{ url: 'Text' }] });
    await actor.sendAsync({ id: '1', re: { response: 'hello' } });
    expect(actor.posts[0]).toEqual(expect.objectContaining({
      op: [{ url: 'http://example.com' }, '@get'], to: 'Remote',
    }));
    expect(actor.posts[1]).toEqual({
      id: '42', re: { response: 'hello' }, to: 'caller', 'bv-a': { response: 'Text' },
    });
  });
});
