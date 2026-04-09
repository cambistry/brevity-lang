import { expectBehavior } from '../helpers.js';

describe('external send', () => {
  const script = `
    <
      "Remote": (Remote) {
        get: (:url Text) -> (:response Text)
      }
    >

    @call_remote_fire
      =
      :url Text
      =
      spawn Remote.get(:url) .

    @call_remote_receive
      =
      :url Text
      =
      :response Text = Remote.get(:url)
      -> :response as Text
  `;

  it('fires outgoing message for DotCallExpr', async () => {
    await expectBehavior(script,
      { input: { id: '42', op: [{ url: 'http://example.com' }, '@call_remote_fire'], from: 'caller', 'bv-a': [{ url: 'Text' }] } },
      { output: { id: '1', op: [{ url: 'http://example.com' }, '@get'], to: 'Remote', 'bv-a': [{ url: null }] } },
    );
  });

  it('receives response message for DotCallExpr', async () => {
    await expectBehavior(script,
      { input: { id: '42', op: [{ url: 'http://example.com' }, '@call_remote_receive'], from: 'caller', 'bv-a': [{ url: 'Text' }] } },
      { output: expect.objectContaining({ op: [{ url: 'http://example.com' }, '@get'], to: 'Remote' }) },
      { input: { id: '1', re: { response: 'hello' } } },
      { output: { id: '42', re: { response: 'hello' }, to: 'caller', 'bv-a': { response: 'Text' } } },
    );
  });
});
