import { jest } from '@jest/globals';
import compile from '../index.js';
import { evaluate, expectReply } from './helpers.js';

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

  it('receives response message for DotCallExpr', async () => {
    const source = `
      use Remote

      on call_remote(:url : Text)
        :response : Text = Remote.get(:url : Text)
        reply :response : Text
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    const actor = new Actor(binding);

    // 1. Send call_remote — actor will post outgoing get and suspend
    actor.receive({
      id: '42', op: [{ url: 'http://example.com' }, 'call_remote'],
      from: 'caller', 'bv-a': [{ url: 'Text' }],
    });
    await new Promise(r => setTimeout(r, 0));

    // 2. Capture outgoing message to Remote
    const outgoing = binding.post.mock.calls[0][0];
    expect(outgoing).toEqual(expect.objectContaining({
      op: [{ url: 'http://example.com' }, 'get'], to: 'Remote',
    }));

    // 3. Feed response from Remote back into actor
    actor.receive({ id: outgoing.id, re: { response: 'hello' } });
    await new Promise(r => setTimeout(r, 0));

    // 4. Actor resumes and replies to original caller
    expect(binding.post).toHaveBeenNthCalledWith(2, {
      id: '42', re: { response: 'hello' }, to: 'caller', 'bv-a': { response: 'Text' },
    });
  });
});
