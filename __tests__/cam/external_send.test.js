import { createActor, expectActorBehavior } from '../helpers.js';

describe('external send', () => {
  it('fires outgoing message for DotCallExpr', async () => {
    const actor = await createActor(`
      uses Remote {
        get: (url: Text) -> (response: Text)
      }

      @call_remote
        =
        url: Text
        =
        spawn Remote.get(:url) .
    `);
    await expectActorBehavior(actor,
      { input: { id: '42', op: [{ url: 'http://example.com' }, '@call_remote'], from: 'caller', 'bv-a': [{ url: 'Text' }] } },
      { output: { id: '1', op: [{ url: 'http://example.com' }, '@get'], to: 'Remote', 'bv-a': [{ url: null }] } },
    );
  });

  it('receives response message for DotCallExpr', async () => {
    const actor = await createActor(`
      uses Remote {
        get: (url: Text) -> (response: Text)
      }

      @call_remote
        =
        url: Text
        =
        response: Text = Remote.get(:url)
        -> :response as Text
    `);
    await expectActorBehavior(actor,
      { input: { id: '42', op: [{ url: 'http://example.com' }, '@call_remote'], from: 'caller', 'bv-a': [{ url: 'Text' }] } },
      { output: expect.objectContaining({ op: [{ url: 'http://example.com' }, '@get'], to: 'Remote' }) },
      { input: { id: '1', re: { response: 'hello' } } },
      { output: { id: '42', re: { response: 'hello' }, to: 'caller', 'bv-a': { response: 'Text' } } },
    );
  });
});
