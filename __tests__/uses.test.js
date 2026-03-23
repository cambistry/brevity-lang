import { expectActorReply } from './helpers.js';

describe('intercom', () => {
  const script = `
    uses Remote

    @test
      =
      :msg : Text
      =
      -> :msg
  `;

  it('parses use declaration', async () => {
    await expectActorReply({
      script, receive: { id: '1', op: [{ msg: 'hello' }, '@test'], from: 'c', 'bv-a': [{ msg: 'Text' }] },
      reply: { id: '1', 'bv-a': { msg: 'Text' }, re: { msg: 'hello' }, to: 'c' },
    });
  });
});
